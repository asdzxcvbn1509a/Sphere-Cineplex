# Architecture and design notes

How CineBook is put together, and why the booking, payment and refund rules work the way they do.
For setup see the [README](../README.md); for endpoints see the [API reference](api.md); for status transitions see [State machines](state-machines.md)

## Contents

- [System overview](#system-overview)
- [Server layers](#server-layers)
- [Shared server modules](#shared-server-modules)
- [Client structure](#client-structure)
- [Background jobs](#background-jobs)
- [Main flow](#main-flow)
- [Design notes](#design-notes)

---

## System overview

```
Browser (React SPA) ──/api/*──► Express API ──Prisma──► PostgreSQL
                                     │
                                     ├── slip storage: disk (dev) or Supabase Storage (production)
                                     ├── SMTP (password reset links, receipts) — printed to the console when unset
                                     └── background jobs (expired holds, showtime reminders)
```

- `client/` and `server/` are separate npm projects; there is no root workspace
- The web app always calls the API on its own origin (`/api/...`): Vite proxies it in development and Vercel rewrites it in production, so the `SameSite=lax` refresh cookie is always sent (see [DEPLOY.md](../DEPLOY.md))
- All money is stored as whole baht (integers) and all times are stored in UTC; the UI shows Thai time (UTC+7)

## Server layers

```
routes/        URL → middleware chain → controller; zod schemas for body/query live here
controllers/   read req, call one service, shape the HTTP response — never touch Prisma
services/      business rules + database access (the only layer that uses Prisma)
utils/         pure helpers (pricing, seat-change pricing, PromptPay payload, dates, receipts, access errors…)
lib/           Prisma client, slip storage driver
middleware/    authenticate, requireRole, validate, upload (+ file-content check), errorHandler
jobs/          interval jobs started by src/index.js
emails/        outgoing email content, kept separate from the sender (utils/mailer.js)
```

| Concern | Where |
|---|---|
| Request validation | `validate({ body, query })` in each route file. A failed parse becomes 422 `VALIDATION_ERROR` with `details: [{ field, message }]` |
| Errors | Services throw `ApiError` (`utils/ApiError.js`) with a stable `code`; `middleware/errorHandler.js` turns it into `{ error: { code, message, details } }`. Prisma unique violations, missing rows and PostgreSQL deadlocks are mapped to 409 / 404 / 409 `WRITE_CONFLICT` |
| Authentication | `middleware/authenticate.js` verifies the Bearer token and re-reads the user on every request, so role changes and `tokenVersion` revocations apply immediately |
| Error messages | Server messages are Thai and are shown as-is by the web app; `code` is the stable contract |

## Shared server modules

The booking, payment and seat-change services share these modules. None of them imports `bookings.js`, `payments.js` or `seatChanges.js`, which keeps the import graph free of cycles

| Module | What it holds |
|---|---|
| `services/locks.js` | The system-wide lock order, `lockShowtime(tx, id)` (`FOR SHARE`), `lockBooking(tx, id)` (`FOR UPDATE`), seat-conflict detection (`isSeatConflict`, `seatTakenError`) and the shared 409 errors `BOOKING_STATE_CHANGED` / `PAYMENT_NOT_PENDING` |
| `services/slips.js` | Everything a hold-with-slip has in common, for both a booking (ticket payment) and a seat change (difference payment): `holdSecondsLeft`, `slipUploadWindow` (on-time and late-slip rules), `queueSlipForReview` (the compare-and-set that moves a holder to `PENDING_VERIFICATION`, with the fallback to the late-slip path when it races the expiry job), `discardSlipOnError` (removes an uploaded file when the request fails) and the payment verdict builders |
| `services/seatChangeRules.js` | Seat-change rules and response shapes used by bookings (booking card, cancel guard), seat changes and payments (queue summaries). No database access |
| `utils/bookingAccess.js` | `BOOKING_NOT_FOUND`, `SEAT_CHANGE_NOT_FOUND`, `NOT_BOOKING_OWNER` and `canAccessBooking(requester, ownerId)` (owner or admin) |
| `utils/pagination.js` | `paginationQuery` for route schemas and `findPage()`, which runs `findMany` + `count` in parallel for the admin lists |
| `utils/seatChange.js` | Pure seat-change pricing (`planSeatChange`). The web app keeps a copy of the same rules in `client/src/utils/seatChange.js` to preview the difference — change both together |

## Client structure

```
api/          one module per endpoint group + client.js (axios instance, token refresh) and refresh.js (cross-tab refresh lock)
store/        zustand: authStore (in-memory access token), notificationStore, adminQueueStore
context/      I18nContext (t, pick, lang) and ToastContext
hooks/        useApi / usePagedApi (loading + error state), usePolling, useCountdown, useSeatSelection
components/   ui kit (Button, Modal, ConfirmModal, Chip, …), layout, seat map, payment, booking, admin
pages/        customer pages; pages/admin/ for the back office
i18n/         th.json and en.json — every key must exist in both
```

- **Loading data** — pages call `useApi(fetcher, deps)`, which returns `{ data, loading, error, reload }`. `reload({ silent: true })` refetches without the loading state (polling, after an action), and a response that arrives after a newer request is discarded. Paginated admin lists use `usePagedApi`, which also jumps back to the last page that has data when the requested page is out of range
- **Confirmations** — two-button dialogs use `ConfirmModal`; dialogs that are forms or offer more than one action use `Modal` directly
- **Data from the database in two languages** — `pick(movie, 'title')` returns `titleTh` or `titleEn` for the current language

## Background jobs

Started by `src/index.js` (`jobs/index.js`). Each job skips a tick while the previous run is still going, and errors are logged without stopping the process

| Job | Interval | What it does |
|---|---|---|
| Release expired holds | 30 s | `PENDING_PAYMENT` bookings past `holdExpiresAt` become `EXPIRED`, their seats are released and the customer is notified |
| Release expired seat changes | 30 s | Seat-change requests still waiting for the difference payment past their hold become `EXPIRED`; only the new seats are released |
| Showtime reminders | 60 s | Notifies paid bookings about one hour before the showtime (never for cancelled showtimes, never twice) |

On a host that sleeps when idle (Render's free plan) these jobs pause too — see [DEPLOY.md](../DEPLOY.md#8-keep-the-server-awake-render-free-plan)

---

## Main flow

```
Pick movie → pick date/showtime → pick seats ─┐
                                              │ (no login needed yet)
                               Confirm ───────┴─→ Log in / Sign up
                                                         │
                        PENDING_PAYMENT ←────────────────┘  seats held for 10 minutes
                               │
                      User uploads a slip
                               ↓
                     PENDING_VERIFICATION   ← countdown stops, seats stay held
                                              the user can't cancel until the result is in
                       ┌───────┴───────┐
                Admin approves   Admin rejects
                       ↓               ↓
                      PAID      PENDING_PAYMENT (another 10 minutes)
                       ↓
     E-Ticket + receipt no. RC-2026-000123 issued (receipt also emailed)
                       ↓
     Free cancellation if ≥ 3 hours before the showtime → seats released back to the system
                       ↓  user gives bank + account number when cancelling
                       ↓
     payment: APPROVED → REFUND_PENDING, queued at /admin/refunds
                       ↓
     Admin refunds by transfer in their own banking app, then records it (slip can be attached)
                       ↓
     payment: REFUNDED + user notified
```

**Expired holds:** a background job checks every 30 seconds; once a booking is past its payment deadline it becomes `EXPIRED`, its seats are released and the user is notified
Anyone who already transferred the money but didn't upload the slip in time can still upload it for another 30 minutes (see [Late slip submission](#late-slip-submission))

**Slip rejected after the showtime starts:** the booking doesn't go back to `PENDING_PAYMENT`; it's closed as `EXPIRED` and the seats are released — there's no point giving another 10 minutes to pay for a showtime that's already playing

**Cancelling a whole showtime:** an admin can cancel a showtime that has bookings in a single action. Every booking is closed, and paid ones go to the refund queue (see [Cancelling a whole showtime](#cancelling-a-whole-showtime))

**Changing seats:** paid bookings can change their own seats until 30 minutes before the showtime, across zones too — pricier seats mean transferring the difference, cheaper ones get the difference back (see [Seat changes](#seat-changes))

---

## Design notes

### Preventing double booking (race condition)

The `BookingSeat` table has `@@unique([showtimeId, seatId])` — PostgreSQL itself guarantees that a seat in a showtime can belong to only one booking. If two users confirm the same seat at the same time, the slower one gets HTTP 409 `SEAT_TAKEN` along with the list of seats that were taken first. This is not a `SELECT` check followed by an `INSERT`, which leaves a gap for another request to slip in

When a booking is cancelled or expires, its `BookingSeat` rows are **deleted** to release the seats. The seat details shown in booking history are kept separately in `Booking.seatSnapshot`

### Concurrent status changes

Every place that changes a booking/payment status (expiry, slip upload, approve, reject, cancel, record refund) is written as **compare-and-set**:
the expected status goes into the `WHERE` of the update, and the code checks that a row was actually hit — not reading and checking first, then overwriting
If another operation grabs the status change first in the same split second, the slower one gets 409 and its whole transaction is rolled back

| Scenario | Without this |
|---|---|
| The expiry job runs at the exact moment a customer uploads a slip | The booking is overwritten as `EXPIRED` and the seats are released, but the slip disappears from the review queue — money falls outside the system |
| One admin approves while another cancels at the same time | The booking becomes `PAID` even though its seats were already released for someone else to book |
| Recording a refund twice | The customer gets two notifications, and the first slip becomes an orphaned file |
| Submitting a seat change twice at once (two tabs) | The slower request deletes seats based on the old set, then books its new set on top — leaving held seats that nobody pays for (a seat change always locks the booking row and checks the seats are still the same set first) |

Every operation locks in the same order — `Showtime` (shared) → `Booking` → `SeatChange` → `BookingSeat` → `Payment` → `ReceiptCounter` — and writes seats sorted by id. With one order across the whole system, deadlocks can't happen
(The order and the row-lock helpers live in `server/src/services/locks.js`)
(The receipt number counter `ReceiptCounter` is always locked last, and nothing locks the counter before anything else)
(If PostgreSQL still has to pick a loser, the user gets 409 `WRITE_CONFLICT` to retry, not a 500)
Creating a booking holds a shared lock on the showtime row (`FOR SHARE`) while it writes, so a booking that arrives while an admin is cancelling the showtime can't slip through

Every one of these cases is covered by integration tests that fire truly concurrent requests at PostgreSQL (`server/test/integration/`)

### Seat hold limits

An unpaid booking holds its seats for 10 minutes. Without limits, a single account could keep booking to hold an entire theatre

- **An unpaid booking already exists for the same showtime** → the seat map shows a dialog offering "Pay for that booking" or "Cancel it"
  This mostly happens when someone presses back from the payment page to pick again — previously their first set of seats stayed held for 10 minutes without them realizing
  The page checks for the user's own pending booking as soon as it opens (from My bookings), so the dialog appears right away, before any new seats are picked
  The server is still the real gate, with 409 `PENDING_BOOKING_EXISTS` (e.g. closing the dialog and confirming anyway, or booking from another tab)
  (Bookings whose slip has been uploaded don't count, so booking extra seats for friends in the same showtime works as usual)
- **Holding pending bookings across all showtimes beyond `MAX_PENDING_BOOKINGS_PER_USER`** (default 3, counting both awaiting payment and awaiting slip review) → 409 `TOO_MANY_PENDING_BOOKINGS`
- `POST /api/bookings` allows 10 successful bookings per account per 10 minutes, stopping scripts that loop book-and-cancel to make seats flicker so nobody else can book them

### Late slip submission

A customer who scanned and paid in the final minute but came back too late to upload the slip used to get nothing but an "expired" message, even though the money had already arrived — that payment had no place in the system at all
Now the slip can still be uploaded for `LATE_SLIP_GRACE_MINUTES` minutes (default 30) after the hold expires, both from the original payment page and from the "Upload slip (already paid)" button on `/my-bookings`

| Situation at upload time | Result |
|---|---|
| The original seats are still free and the showtime hasn't started | The seats are restored and the slip enters the review queue as usual, as if the hold had never expired |
| The seats were booked by someone else / the showtime started or was cancelled | The booking stays `EXPIRED`, but the slip enters the review queue with a "Paid after the deadline" badge — for the admin, **approve = queue a refund** (no ticket is issued); reject = closed |
| Past the grace period | 409 `HOLD_EXPIRED`, telling the customer to contact staff with the booking code |

Restoring the seats relies on the same unique constraint as a normal booking, so there's no way to end up sharing seats with whoever booked them in the meantime
And the countdown on the payment page is computed from the `holdSecondsLeft` the server sends, not the customer's device clock — so a device whose clock runs behind won't show more time left than there really is

### User accounts and passwords

Signing up once at `/register` (name, email, phone, password) also logs the user in
with no need to enter anything a second time, so someone in the middle of picking seats can sign up and go straight back to booking

**Email is the primary username** (always stored in lowercase, so differences in case can't create duplicate accounts)
The **phone number is required and must be unique**, because it's the only channel admins use to get back to customers when a booking or refund has a problem
and it can also be used to log in instead of the email

**Changing your own password** is done at `/profile` and requires entering the current password first
so someone who steals a session can't take over the whole account by setting a new password
After a successful change, sessions on all other devices are revoked, leaving only the device that made the change
The main reason people change their password is suspecting a leak, so kicking out other devices is what should happen anyway

### Forgot password

Users can recover their account themselves: `/forgot-password` → enter the email they signed up with → the system sends a link to that email → open the link and set a new password at `/reset-password`

| Rule | Reason |
|---|---|
| Always responds `ok`, whether or not the email has an account | Otherwise this page becomes a tool for probing which emails belong to our customers |
| Links last 30 minutes and work only once | A link sitting in an inbox for a month shouldn't still open the account |
| Requesting a new link = the old one stops working immediately | Someone who clicks "Send again" doesn't have to guess which email to open — it's always the latest one |
| A successful reset = logged out on every device | Unlike changing the password on the profile page, which keeps the device that made the change signed in: the person resetting isn't logged in, and a reset is often needed because someone else may have access to the account |
| Only the sha256 of the token is stored, in the `PasswordResetToken` table | A leaked database can't be used to set anyone's password with these rows (same principle as refresh tokens) |
| A new password that fails the rules doesn't burn the link | Nobody would put up with requesting a whole new link because they typed a password that was too short once |
| Link requests are limited per (IP + email) | Stops the system from being used to flood someone else's inbox · It isn't per email alone, because an attacker could use up the quota so the real owner can't request a link — locking them out of recovering their own account |

The `token` is sent in the **body, not the URL path**, when calling the API, because `morgan` logs the method + path of every request
The link in the email itself uses `?token=`, the way most services do

**Sending email** uses `nodemailer` with the SMTP server configured in `.env`
If `SMTP_HOST` isn't set yet, the system **prints the email, link included, to the server console instead** and (only when `NODE_ENV=development`) also returns the link for the web page to show
so the whole flow can be tried without a mail server — the condition is tied to `NODE_ENV`, so even if SMTP is forgotten in production, the link never leaks out through the API

> If the user can't access their email either, an admin can set a temporary password on the [User management](#user-management) page as a fallback

### User management

The `/admin/users` page lets admins search customer accounts by name, email or phone in a single box
(customers who call in usually give just one of them), then do 3 things — edit contact details, set a new password and change the role

**Setting a new password for a customer** is the fallback for [Forgot password](#forgot-password), for people who can no longer access their email
The admin sets a temporary password and tells the owner to change it themselves on the profile page
Once it's set, that account is logged out of every device immediately, in case the reset is needed because the account was hijacked

**Rules the system enforces, not just hidden buttons**

| Not allowed | Reason |
|---|---|
| Changing your own role | So the last admin can't remove their own rights until nobody can reach the back office anymore — to hand over, make the new person an admin first, then have them remove your rights |
| Deleting your own account | Same reason |
| Deleting an account with booking history | `Booking` is tied to `User` with cascade, so deleting the account would silently take its sales out of the reports with it |
| Setting your own password from this page | That requires confirming the current password first, so it has to be done on the profile page |

Role changes take effect in the API **immediately**, without waiting for the token to expire, because the `authenticate` middleware
re-reads the role from the database on every request instead of trusting the value embedded in the JWT
(On the affected user's own screen, the admin menu appears/disappears after a page refresh, but even if the menu lingers, nothing in it can be used)

### Session security

- The access token is kept only in React's memory (never localStorage) — so XSS can't steal it for later use
- The refresh token is a random 64-byte string kept in an httpOnly cookie, and only its SHA-256 hash is stored in the database
- Every refresh **rotates** to a new token and revokes the old one. If a revoked token is used again (meaning a token has leaked), the system immediately revokes every session of that user
- **Multiple open tabs don't get kicked out** — every tab sends the same cookie to refresh. Previously the second tab was treated as token reuse and had every session revoked
  Now the web app queues refreshes across tabs with `navigator.locks` (see `client/src/api/refresh.js`), and if they still collide (older browsers),
  a token rotated less than 10 seconds ago gets 409 `REFRESH_RACE` to retry instead — no new session is issued for the old token, so a stolen token still gains nothing
- **No red errors in the console when logged out** — the web app calls `/api/auth/refresh` on every load to restore the session (it can't see the httpOnly cookie itself)
  With no cookie, the response is 204 instead of 401. A cookie that's no longer valid (e.g. after re-seeding the database) gets a single 401 and is deleted, so the bad cookie isn't sent again next time
- **After a password change/reset, old access tokens stop working immediately** instead of waiting out their 15 minutes — `User.tokenVersion` is embedded in the token and incremented on every password change (`authenticate` already reads the user row on every request, so the comparison costs next to nothing)
  The device that changed the password gets a new access token right in the response, so it never runs into a 401 first
- **Access tokens are refreshed ahead of time** — the request interceptor refreshes 30 seconds before the real expiry, measuring the token's lifetime (`exp − iat`) from the moment it was received rather than using the device clock
  So normal use never hits 401 `TOKEN_EXPIRED`; 401 → refresh → retry remains as a fallback (e.g. a password changed from another tab)
- `TRUST_PROXY` decides which proxies to trust `X-Forwarded-For` from (default `loopback`) — it used to be hard-coded to 1, so if the API was reachable directly, anyone could spoof their IP to dodge rate limits
- Slip files are checked by their **actual contents** (JPG/PNG/WEBP magic bytes), not just the Content-Type the sender claims. The check runs while the file is still in memory, so files that fail are never written to storage at all. Every response also carries security headers from `helmet` (including `X-Content-Type-Options: nosniff`)
- Slip images aren't served as static files — they must be fetched through `GET /api/payments/:bookingId/slip` (the slip of the customer's transfer) or `/refund-slip` (the slip of the admin's refund transfer), which only allow the booking's owner or an Admin (`?payment=` = the slip of a seat change difference payment, which must belong to that booking)
- Uploads are kept in separate piles by uploader: `payments/` for customers and `refunds/` for admins (folders under `uploads/slips/` or prefixes in the bucket, depending on the [slip storage](#slip-storage)), so audits and cleanups never grab from the wrong pile. File names are freshly randomized every time and can only be read from the pile of their own kind
- Passwords are stored only as bcrypt hashes — the real password is never stored or logged — and must be at least 8 characters long with both letters and digits
- A failed login always gets the same message, whether the account doesn't exist or the password is wrong, and even when no account is found the system still compares against a throwaway hash so response times are similar — so attackers can't work out which emails have accounts
- **Failed** logins are limited per (IP + account); successful ones aren't counted, so normal users never get blocked, and hammering someone else's account can't lock out the real owner on a different IP
- The number of accounts that can be registered per IP is limited, counting only **successful** sign-ups (all of these are adjustable in `.env`)

### Slip storage

Slip files can be stored in 2 ways, chosen by whether `SUPABASE_URL` is set (the code is in `server/src/lib/slipStorage.js`)

| | `SUPABASE_URL` not set | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` set |
|---|---|---|
| Stored in | Disk at `server/uploads/slips/` | Supabase Storage (private bucket) |
| Suited for | Development and running tests | Production |

- In both modes the DB stores only the file name, so switching storage needs no schema change
- In both modes slip images can only be opened through the permission-checked API (with Supabase, the server fetches the file from the bucket and passes it on), so no direct link to a file ever leaks out
- **Hosts without a persistent disk (e.g. Render) must use Supabase**: the disk is wiped on every deploy/restart, so slips vanish while the DB still refers to them
  If `NODE_ENV=production` but slips still go to disk, the server warns at startup, and opening a slip whose file is gone returns 404 `SLIP_FILE_MISSING`

Setting up Supabase Storage:

1. Supabase Dashboard → **Storage** → **New bucket**, name it `slips` (or whatever `SUPABASE_SLIP_BUCKET` is set to) and **turn off Public bucket**
   For an extra layer of protection, set the file size limit to `5 MB` and the allowed MIME types to `image/jpeg, image/png, image/webp`
2. No RLS policy is needed: the API uses the secret key, which bypasses RLS, and the public keys (publishable/anon) have no policy granting access, so they can't read anything in the bucket
3. Take the Project URL and secret key (`sb_secret_…`, or the legacy service_role) from Project Settings and set them as `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the API side (e.g. Render's Environment)
   **Never put the secret key on the client side** (Vercel or `VITE_*` variables), because it would be bundled and shipped to the browser
4. Start the server and check that the `ที่เก็บสลิป:` ("Slip storage:") line in the log shows `Supabase Storage (bucket slips)`

Existing slips on disk aren't moved to the bucket automatically. When migrating a database that already has slips, upload the files in `uploads/slips/payments/` and `refunds/` to the prefixes with the same names yourself

### When bookings can't be cancelled

While a slip is in the review queue (`PENDING_VERIFICATION`), users can't cancel by themselves, because the money may really have been transferred already. If cancelling were allowed here, the payment would be closed as `REJECTED` even though the money is in the account — money that falls outside the system with no refund queue to catch it

The API returns 409 `AWAITING_VERIFICATION` and also sends `canCancel: false`, so `/my-bookings` hides the cancel button and shows "Your slip is being reviewed — you can cancel once the result is in" instead. The button comes back once an admin approves or rejects — if rejected, the user can cancel right away; if approved, they can cancel under the 3-hour policy, and the booking then goes to the refund queue

Admins can still cancel on a customer's behalf in any status through `/admin/bookings`, for cases that need individual handling

### Cancelling a whole showtime

When a projector breaks or a theatre has to close, the admin clicks "Cancel showtime" on `/admin/showtimes` (a reason can be given, which customers see in their notification) and the system handles it all in one go

- Every booking for that showtime is closed and its seats released — paid ones go to the refund queue, unpaid ones are simply closed
- Every customer gets a `SHOWTIME_CANCELLED` notification; holders of paid bookings are asked to add a refund account at `/my-bookings` (so admins don't have to call everyone one by one)
- A cancelled showtime stays in the schedule with a "Cancelled" badge instead of silently disappearing, and no "Your movie starts soon" reminder is sent for it
- If the showtime still has slips awaiting review, the result is 409 `SHOWTIME_HAS_PENDING_SLIPS` — they must be approved/rejected first, because it isn't known yet whether the money really arrived
- It runs in a single transaction using bulk statements, with a fixed number of queries no matter how many bookings the showtime has

`PATCH /api/admin/showtimes/:id` no longer accepts `status` — cancelling must go through this route only
Previously the showtime status could be changed directly without touching the bookings at all, so paid tickets were left stranded in cancelled showtimes with nobody refunding them

### Deleting records still tied to money

| Can't delete | Do this instead |
|---|---|
| A showtime that has ever had bookings (even if all were cancelled) | "Cancel showtime" |
| A theatre that has ever had bookings | Deactivate the theatre (untick "Open for new showtimes") — deactivated theatres can't get new showtimes |
| A movie that still has tickets for future showtimes, slips awaiting review or refunds pending (even with "Delete permanently") | Cancel the showtimes and finish the refunds first, or archive it |
| A movie that has ever had a receipt issued (even if fully refunded — 409 `MOVIE_HAS_RECEIPTS`) | Archive it |

The reason is the same for all of them: `Booking` and `Payment` are tied to the showtime with cascade, so deleting a showtime or theatre would make the booking history, receipts and **refund queue silently disappear along with it**
(Once receipts are gone, the receipt numbers have gaps, and an audit can no longer tell where the missing ones went)
Previously only seats still held were checked — cancelled bookings have no seats left, so the delete went through and the pending refunds vanished entirely

### Pending-work badges on the admin menu

The **Slip review** and **Refunds** menu items have red badges showing how much work is outstanding (hidden when there's none). The numbers come from `/api/admin/queue-counts`, which is just two `COUNT`s, separate from the heavier `/overview` because the badges are fetched far more often. It uses the same counting conditions as the overview page so the numbers in the two places never drift apart

The numbers live in a shared zustand store (`store/adminQueueStore.js`), like the notification bell. Pages that change them (approving/rejecting slips, recording a refund as transferred) update the store as soon as the action completes, so the badge drops right away without a page refresh. Work arriving from the customer side (new slips, cancelled bookings) is re-fetched every 30 seconds and on every menu change

### Refunds

This system doesn't charge money itself (it takes payment by transfer + slip review), so it can't refund automatically either. When a paid booking is cancelled, its payment becomes `REFUND_PENDING` and enters the queue at `/admin/refunds` with the customer's name and phone number. The admin transfers the refund in their banking app and records it (a refund slip must be attached); the system then changes it to `REFUNDED` and notifies the user
Differences from [changing seats](#seat-changes) to cheaper ones go into this same queue. The amount to transfer for every item is in `refundAmount` (for a cancelled booking that had changed seats, the refund is the net amount, not what was paid at booking time)

**Destination account** — since transfers are manual, the system has to know which account to refund to. The cancel dialog for **paid bookings only** has fields to choose a bank (from a list of major banks, or typed in) and enter the account number. Without them the cancellation fails (400 `REFUND_ACCOUNT_REQUIRED`). Unpaid bookings aren't asked for this, since there's no money to return

Account numbers are accepted with dashes or spaces (`123-4-56789-0`); the system strips them down to 10-15 digits before storing. The account given is shown on the customer's own card, on the card in the refund queue, and once more in the confirmation dialog before the admin marks it as transferred

**Proof of refund** — the slip the admin attaches when recording the refund can be viewed by the customer at `/my-bookings` (the "Refund slip" button, with the note and the date and time of the transfer). It's the customer's own money, so letting them see the proof right there cuts out "have you refunded me yet?" questions. It uses the same permission-checked route as payment slips, so nobody else can open it (403). If the wrong slip was attached or the note has a typo, the admin can click "Edit record" in the "Refunded" tab to replace the slip or fix the note (`PATCH /api/admin/refunds/:id`); the status stays refunded and the customer isn't notified again

If the booking was cancelled by an admin (the customer phoned in, or the whole showtime was cancelled) or the money was transferred after the deadline, no account comes with it
The customer can add one at `/my-bookings` (the "Add refund account" button — editable for as long as the refund is pending). Meanwhile the refund queue shows "No account given — call the customer"

The reports page shows a separate "Cancelled after payment" total, so revenue doesn't quietly drop until the figures no longer match the money actually in the account

### Receipts (E-Receipt)

Once an admin approves the slip, the system issues a receipt immediately, at the same moment the booking becomes `PAID`
Customers can open it from the "Receipt" button on `/my-bookings`, the payment page and the E-Ticket page (`/booking/:id/receipt`), and also receive it by email
Admins can open any customer's receipt from `/admin/bookings` and can search bookings by receipt number (customers who contact us about money usually quote it)

| Topic | How | Why |
|---|---|---|
| Number `RC-2026-000123` | Sequential per year (Gregorian year, Thai time) from the `ReceiptCounter` table, in the same transaction as the approval | PostgreSQL's `SEQUENCE` doesn't roll back — every failed approval would lose a number, leaving gaps in the receipts that make audits impossible |
| Two admins approve the same slip | The slower one fails the status check before reaching the counter | No numbers wasted; exactly one receipt |
| Payer name | A copy is stored in `Payment.receiptName` when the receipt is issued | Users can edit their name in the profile later, but receipts already issued must not change with it |
| Late slips that go to the refund queue | No receipt is issued | No ticket was sold; that money is being refunded |
| Cancelled / refunded later | The receipt still opens, stamped "Refund pending" or "Refunded" | A receipt is proof that the money was really received; it shouldn't disappear because of a refund |
| Seats changed after the receipt was issued | The seats on the receipt are frozen in `Payment.receiptSeats`, with a note of the current seats · An extra difference payment gets its own new receipt number (`?payment=`) | The web version of a receipt must always match the one already emailed |

**Print / Save as PDF** uses the browser's print function (the button on the receipt page), producing a single A4 page without menus, buttons or the dark background, with the receipt number as the suggested file name
There's no server-side PDF, because that would mean embedding Thai fonts ourselves, where vowels and tone marks risk being placed wrongly, while browsers already lay out Thai correctly
On mobile screens the line-item table shrinks to just "Description | Amount" (quantity × unit price moves under the item name), so every amount is visible without scrolling the table

**The receipt email** is sent only after the approval transaction has finished, so an approval that collides with another admin can't send out an email for a receipt that doesn't exist
and it doesn't wait for SMTP — an admin working through the slip queue doesn't have to wait for each email to finish sending (a failed send is just logged; the customer can still open the receipt on the website)
It uses bilingual "ไทย / English" labels in a single version, because the system doesn't store the language the customer picked, and without SMTP configured it's printed to the console, like the password reset email

It's a plain **receipt**: VAT isn't broken out, and it isn't a tax invoice — the issuer name and address are set with `RECEIPT_ISSUER_NAME` / `RECEIPT_ISSUER_ADDRESS`
Payments made before this feature existed were numbered retroactively by the `receipts` migration, in order of actual payment time

### Seat changes

Paid bookings can change their own seats via the "Change seats" button on `/my-bookings` — previously customers had to cancel and wait for an admin to refund them before booking again, which was slow, lost the seats while waiting and created needless refund work
The seat change page starts with the current seats all selected (dashed outline). The customer taps current seats off and picks new ones instead; the count must stay the same, moving only some of the seats is fine, and moving across zones is allowed

| New seat price | Result |
|---|---|
| Same | Moved immediately |
| Cheaper | Moved immediately; the customer enters a refund account and the difference goes into the `/admin/refunds` queue as a separate item ("Seat change difference" badge) |
| Pricier | The new seats are held for `SEAT_HOLD_MINUTES` while the difference is transferred via PromptPay QR; meanwhile the current seats still belong to the customer → the slip enters the same `/admin/payments` queue as ticket payments → the move only happens once an admin approves, and a new difference receipt is issued (also emailed) |

Not transferring in time, a rejected slip, or the customer cancelling the request = the move just doesn't happen; the current seats aren't lost
A rejected slip gets a new `REJECTED_RETRY_MINUTES` window to transfer (unless the showtime has started), and late slips are accepted within `LATE_SLIP_GRACE_MINUTES`, just like ticket payments — if the new seats are still free the slip enters review as usual; if not, admin approval = refunding the difference
(Ticket payments and difference payments go through the same slip-submission code in `server/src/services/slips.js`)

**Pricing** — seats in zones the booking already has are priced at what was paid, while new zones use the showtime's current price. So moving within the same zone is always free, even if an admin changes the showtime's prices later
The web app shows the difference before confirming, using the same rules (`client/src/utils/seatChange.js`), but the actual amount is calculated by the server (`server/src/utils/seatChange.js`)

| Rule | Reason |
|---|---|
| Paid bookings only | Unpaid bookings can already use "Cancel it" and book again right away |
| At least `SEAT_CHANGE_CUTOFF_MINUTES` (30 minutes) before the showtime | Moving within a zone involves no money, so it's more lenient than cancelling (3 hours) |
| At most `MAX_SEAT_CHANGES_PER_BOOKING` (2) per booking — expired or cancelled requests don't count | Stops switching back and forth until seats flicker and others can't book them (with another layer on top: 10 requests per 10 minutes per account) |
| One pending request per booking at a time | The difference is calculated from the current seat set; if requests could overlap, the amount would be wrong |
| While a difference slip awaits review, neither the customer nor an admin can cancel the booking (409 `SEAT_CHANGE_AWAITING_VERIFICATION`), and the whole showtime can't be cancelled | Same reason as `AWAITING_VERIFICATION` — the difference may really have been paid already |
| Cancelling a booking that changed seats → refunds the **net amount** (`Booking.totalAmount`) as a single item | This amount includes the extra differences paid and subtracts the differences already refunded, so the admin makes one transfer without adding things up (the amount to transfer is stored in `Payment.refundAmount`, which the refund queue, notifications and reports all share) |
| Issued receipts don't change | The seats on the receipt are frozen in `Payment.receiptSeats` (same principle as `receiptName`) with the note "Seats later changed to …". The QR on the ticket doesn't change, because it uses the same booking code |

**Admins can move seats for a customer** (broken seat, customer phoned in) via the "Change seats" button on `/admin/bookings` — every seat must stay in its original zone, so there's never a difference (400 `SEAT_ZONE_MISMATCH`)
It isn't bound by the deadline (but must happen before the showtime ends), doesn't count toward the customer's quota, and the customer is notified with the reason the admin entered

**Data model** — `Payment` is no longer one-to-one with a booking; `kind` gives its type: `BOOKING` (the ticket payment at booking time) · `SEAT_CHANGE_TOPUP` (an extra difference paid) · `SEAT_CHANGE_REFUND` (a difference to be refunded)
So the slip review queue, the refund queue, receipt numbering and the reports can all use the same set. `booking.payment` still points one-to-one at the main payment through `mainBookingId`, and a CHECK constraint stops the kind and the columns from disagreeing
The history of every request is in the `SeatChange` table (who moved, from where to where, and the difference). The new seats held while awaiting the transfer are `BookingSeat` rows with a `seatChangeId` — so double booking is prevented by the same unique constraint as normal bookings

### Time and currency

- All times are stored in UTC in the database and displayed in Thai time (UTC+7) on both sides
- Amounts are stored as whole-baht integers, avoiding floating-point decimal problems

### Responsive layout

Designed mobile-first (usable from 360px wide), then scaled up with Tailwind breakpoints — `sm` 640 · `md` 768 · `lg` 1024
- **Seat map** — theatres with 12–16 seats per row are wider than a phone screen, and shrinking the map to fit makes seats too small to tap reliably, so it scrolls horizontally instead
  On load, the map scrolls by itself to the seats already selected (or the middle of the theatre), row letters stick to the left edge while scrolling, and a hint appears only when the map overflows the screen
- **Sticky summary bar** (`BottomBar`) — measures its own height and sets it as the CSS variable `--bottom-bar`
  The layout uses it to leave space at the bottom of the page, and toasts use it to float above the bar, so neither the content nor the confirm button is covered, however many lines tall the bar is
- **Admin tables** — on screens narrower than `lg`, each row is shown as a card using the shared `.stack-table` class in `index.css`
  Column names come from each `<td>`'s `data-label`, so the markup doesn't have to be written twice
- **Large screens** — the payment page puts the QR next to the slip upload, the profile page splits into two columns, and the admin sidebar stays in view while scrolling
