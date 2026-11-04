# Testing

- [Unit tests](#unit-tests)
- [Integration tests](#integration-tests)
- [Checking the web app in a browser](#checking-the-web-app-in-a-browser)
- [Manual test checklist](#manual-test-checklist)

---

## Unit tests

```bash
cd server && npm test
```

Node's built-in test runner over `server/src/**/*.test.js`. No database is needed, but `server/.env` must exist because some modules read the configuration when they load

| File | Covers |
|---|---|
| `utils/promptpay.test.js` | PromptPay payload: CRC16 and the EMVCo structure |
| `utils/pricing.test.js` | Per-zone prices derived from the base price |
| `utils/seatChange.test.js` | Seat-change pricing (kept seats, same zone, new zone, id ordering, invalid selections) |
| `utils/trustProxy.test.js` | Parsing `TRUST_PROXY` |
| `utils/proxySecret.test.js` | Comparing the `x-proxy-secret` header with `PROXY_SECRET` (nothing passes while it's unset) |
| `utils/loginIdentifier.test.js` | Login lookup and rate-limit key: every format of the same phone number, email case |
| `utils/bahtText.test.js` | Amounts in words (Thai and English) |
| `utils/receipt.test.js` | Receipt numbers, receipt lines and the receipt shape |
| `utils/bookingDisplayStatus.test.js` | Admin booking badges: every value, rule order (open items beat finished ones), the filter excluding earlier rules |
| `emails/receipt.test.js` | Receipt email content |

## Integration tests

Run against a real PostgreSQL database, because the cases that matter — two people booking the same seat at once, the expiry job colliding with a slip upload, two admins approving at once — only show up with real concurrent transactions

```bash
cd server
cp .env.test.example .env.test   # set <PASSWORD> to match your local PostgreSQL (Windows: copy)
npm run test:int                 # the first run creates the theatre_reservation_test database and migrates it automatically
```

> The tests **wipe every table** before each case, so the test helpers refuse to run if the database name doesn't end in `_test`
> or if `SMTP_HOST` is set (to avoid wiping the dev database by accident and sending real email during tests)
>
> Don't keep an API server running against the `_test` database while the tests run — its background jobs would act on the test data

Files run one at a time (`--test-concurrency=1`); cases inside a file fire truly concurrent requests where that's the point

| File | Covers |
|---|---|
| `admin-bookings.test.js` | Admin booking list `displayStatus`: one booking per badge built through the real services, each filter returns exactly the bookings with that badge, several badges at once (comma-separated over HTTP) return their union, `status` keeps its old meaning, filters combine, 422 for unknown values |
| `auth.test.js` | Refresh token rotation, reuse detection, multi-tab refresh races, one reset link used by two requests at once |
| `bookings.test.js` | Concurrent bookings of the same seat and of overlapping seat sets, seats from another theatre, the expiry job, double cancellation |
| `holds.test.js` | Seat hold limits (`PENDING_BOOKING_EXISTS`, `TOO_MANY_PENDING_BOOKINGS`) |
| `late-slip.test.js` | Late slips (seats restored or refund path), grace period, the expiry job racing a slip upload, rejecting after the showtime starts |
| `overview.test.js` | Admin overview: yesterday's revenue counted only up to the same time of day, refund rows telling a seat-change difference from a cancellation |
| `payments.test.js` | Concurrent approve / reject / cancel, recording a refund twice, slip queue order (`sort`) |
| `refunds.test.js` | Refund queue order (`sort`, both tabs), the refund account holder name (optional for older clients), editing a recorded refund (slip replacement, file clean-up), who may open payment and refund slips |
| `receipts.test.js` | Receipt numbering (sequential, concurrent, rolled back with a failed transaction), frozen payer names, who may open a receipt, refund stamps, admin search by receipt number |
| `seat-changes.test.js` | Same/cheaper/pricier seat changes, quotas and deadlines, concurrent changes, cancelling after a change, late difference slips, admin moves, HTTP |
| `showtimes.test.js` | Cancelling a whole showtime, customer refund accounts, delete guards, editing booked showtimes, inactive seats, reminders |
| `http.test.js` | Real HTTP: security headers, `PROXY_SECRET` checks and `/api/health` statuses, slip file checks and upload limits, missing slip files, pagination, query booleans, token revocation, `/auth/refresh` responses, login and sign-up rate limits, changing the email |

Test data comes from `server/test/helpers/fixtures.js` (`createUser`, `createShowtimeFixture`, `book`, `createPaidBooking`, `makeSlipFile`, `apiErrorWith`, …)

## Checking the web app in a browser

The web app has no automated tests; `cd client && npm run build` catches compile errors. To click through it without touching your development data, run everything against the `_test` database:

```bash
cd server
node --env-file=.env.test prisma/seed.js   # seed theatre_reservation_test (integration tests wipe it again)
node --env-file=.env.test src/index.js     # API on :4000 with NODE_ENV=test, slips in uploads-test/
cd ../client && npm start                  # web app on :5173
```

Log in with the [demo accounts](../README.md#demo-accounts) (`Password123`). Stop the API before running the integration tests again

## Manual test checklist

Key cases to try by hand:

1. **Sign up and keep booking right away** — pick seats without logging in and confirm → you're taken to the login page → click "Create one" on the card → after signing up you must land back on the same seat map with your selected seats still there
2. **Booking race** — open two browsers, pick the same seat and confirm at the same time → only one must succeed; the other gets a message that the seat is already taken
3. **Payment timeout** — set `SEAT_HOLD_MINUTES=1` in `.env` and leave the payment page open → the booking turns expired and the seats become free again within ~90 seconds
4. **Slip rejection** — an admin rejects with a reason → the user's page updates by itself with the reason and a new 10-minute payment window
5. **No cancelling while the slip is under review** — upload a slip, then go to `/my-bookings` → the cancel button must be gone, with a message saying to wait for the review result → the button comes back only after an admin approves or rejects
6. **Cancellation policy** — bookings less than 3 hours before the showtime can't be cancelled
7. **Refund** — book and pay → an admin approves → the user cancels, entering a bank, account number and account name (leaving the name empty must show an error) → the item must appear at `/admin/refunds` with the customer's phone and the destination account including the name → the admin attaches the refund slip and clicks "Confirm refund" (disabled until a slip is attached) → the item moves to the "Refunded" tab with the slip and its history → the user gets a notification and sees the "Refunded" status
8. **Profile and user management** — edit the name at `/profile` → the name in the top bar must change immediately · changing the password with a wrong current password must be rejected · at `/admin/users`, find a customer by phone → set a new password for them → the customer can log in with the new password, and their old sessions are cut off
9. **Forgot password** — at `/login` click "Forgot password?" → enter the registered email → open the link (find it in the server console, or click it in the blue box on screen when running in development mode) → set a new password → you must be taken back to the login page with the email pre-filled · opening the same link again must say the link is no longer valid
10. **Language switch** — click the EN / ไทย button in the top bar; every page must switch language, including movie titles from the database
11. **Cancelling a whole showtime** — a showtime with both paid and unpaid bookings → on `/admin/showtimes` click "Cancel showtime" → paid bookings must appear at `/admin/refunds`, and customers get a notification and can click "Add refund account" at `/my-bookings` · trying to delete that showtime must fail
12. **Late slip submission** — set `SEAT_HOLD_MINUTES=1`, book and let the hold expire → the payment page must still offer slip upload, and uploading must restore the original seats · repeat, but have another account book those seats before uploading → the slip must enter the queue with a "Paid after the deadline" badge, and approving it sends it to the refund queue
13. **Seat hold limits** — book, then press back from the payment page → the seat map must show the dialog to pay for or cancel the existing booking **immediately** (without picking new seats first, and with no 409 in the console)
14. **Multiple tabs** — while logged in, open the site in 3 tabs at once (or close and reopen a browser that restores its tabs) → every tab must still be logged in
15. **Editing the price of a booked showtime** — at `/admin/showtimes`, change the base price of a showtime that already has bookings without touching the time → it must save
16. **Receipt (E-Receipt)** — book and have an admin approve the slip → the server console must print the receipt email with number `RC-…`, and the notification must show the same number → click "Receipt" at `/my-bookings` → "Print / Save as PDF" must produce a single A4 page without menus or the dark background · after switching to EN, the amount in words must be in English · cancel that booking → the receipt still opens, stamped "Refund pending" · an admin searching for `RC-…` at `/admin/bookings` must find it, and permanently deleting that movie must fail
17. **Seat changes** — book and have an admin approve → at `/my-bookings` click "Change seats" → moving within the same zone must complete immediately, with the ticket showing the new seats while the original receipt keeps the old seats plus a note · moving to a pricier zone → you get the difference payment page, and the new seats must show as taken on another account's seat map → upload the slip → an admin approves it at `/admin/payments` ("Seat change difference" badge) → the seats change and a "Difference receipt" button appears · moving to cheaper seats → an account must be entered, then the item appears at `/admin/refunds` · an admin clicking "Change seats" at `/admin/bookings` and trying to move across zones → must not be allowed
18. **My bookings tabs** — book → opening `/my-bookings` from the top bar must land on "To pay" with the breadcrumb ending in that tab · upload the slip → the booking moves to "Processing" → an admin approves → "Confirmed" · a pricier seat change puts the booking back under "To pay" with an "Awaiting difference" badge · cancel a paid booking → it stays under "Processing" with "Refund pending" until an admin records the refund, then moves to "Cancelled" · a paid booking whose showtime has ended is under "History" · with nothing to pay or under review, the page opens on "Confirmed" · at phone width the tab bar scrolls sideways
19. **E-Ticket** — open the ticket of a paid two-seat booking (the seed creates some for the demo customer) → the card shows one seat with "Ticket 1 of 2" below it · the arrows sit beside the card, level with the notches, on desktop, and next to the counter at phone width · switching tickets changes only the seat, and each arrow is disabled at its end · click "Save e-ticket" → `TRS-XXXXXX-<seat>.png` downloads and shows the same card (Thai text in Noto Sans Thai, the poster, a dark frame), and a phone camera reads the booking code from its QR · a one-seat booking shows no arrows and no counter · a movie whose poster host doesn't allow CORS still saves, with an empty poster frame
20. **Admin bookings badges** — at `/admin/bookings`, a paid booking whose customer requested pricier seats without paying shows "Awaiting difference", and choosing "To pay" in the status filter lists it together with the unpaid bookings · the filter opens a list of four groups, each with a coloured dot and the badges it covers, and works from the keyboard (↓ opens, ↑↓ move, Enter picks, Esc closes) · moving a paid booking to cheaper seats shows "Difference to refund" → after the admin records that refund it shows "Refunded" and can still be cancelled · a cancelled paid booking shows "Cancelled · refund due" with no cancel button · the receipt and change-seats icons open their pages, and Back restores the filters and page · with more than 50 bookings, numbered page buttons (no item count) appear at the bottom of the table card
