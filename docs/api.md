# API reference

Every endpoint of the CineBook API (68 in total). The source of truth is `server/src/routes/*.js` (paths and zod schemas), `server/src/controllers/` (response envelopes) and `server/src/services/` (rules and error codes)
Ready-to-run request examples are in [server/api.http](../server/api.http) (VS Code REST Client)

- [Conventions](#conventions)
- [Objects](#objects)
- Endpoints: [Health](#health) · [Auth](#auth) · [Movies](#movies) · [Showtimes](#showtimes) · [Bookings](#bookings) · [Seat changes](#seat-changes) · [Payments](#payments) · [Notifications](#notifications) · [Admin](#admin)
- [Error codes](#error-codes)

---

## Conventions

### Base URL

| Environment | Base URL |
|---|---|
| Local API | `http://localhost:4000/api` |
| Local web app (Vite proxy) | `http://localhost:5173/api` |
| Production | `https://<web app domain>/api` — Vercel forwards `/api/*` to Render (see [DEPLOY.md](../DEPLOY.md)) |

Browsers should always call the API on the web app's own origin; the refresh cookie is `SameSite=lax` and isn't sent cross-site

When the API has `PROXY_SECRET` set (production), every request except `GET /api/health` must carry the matching `x-proxy-secret` header, which Vercel adds when it forwards `/api/*`. Anything else — such as a request sent straight to the Render URL — gets 403 `DIRECT_ACCESS_FORBIDDEN` before any route runs

### Authentication

| Level | Meaning |
|---|---|
| Public | No token needed |
| User | `Authorization: Bearer <accessToken>` — any signed-in account |
| Owner | User who owns the booking; admins pass the ownership check where noted |
| Admin | Account with role `ADMIN` — every `/api/admin/*` route |

- **Access token**: JWT (HS256) returned by register, login, refresh and password change. Lifetime `ACCESS_TOKEN_TTL` (15 minutes). Its payload holds only `sub`, `role` and `tv` (the user's `tokenVersion`), so a password change or reset invalidates every older token immediately
- **Refresh token**: httpOnly cookie `trs_refresh` (path `/api/auth`, `SameSite=lax`, `Secure` in production, `REFRESH_TOKEN_TTL_DAYS` days). Rotated on every refresh; only its SHA-256 hash is stored
- Token errors: 401 `NO_TOKEN`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` · wrong role: 403 `ROLE_REQUIRED`

### Requests

- Bodies are JSON (`Content-Type: application/json`, max 1 MB)
- Slip uploads are `multipart/form-data` with the file in the field `slip`: JPG, PNG or WEBP, at most `MAX_SLIP_SIZE_MB` (5). The server checks the file's magic bytes, not just its declared type. Besides the file, a request may carry at most 5 text fields of up to 4 KB each (400 `UPLOAD_ERROR` otherwise)
- Query booleans accept only `true` / `false`
- `:id` path parameters are opaque string ids (cuid)

### Responses and errors

- Success responses wrap the resource in a named key (`{ booking }`, `{ showtimes }`, …) unless noted
- Errors always use one envelope:

  ```json
  { "error": { "code": "SEAT_TAKEN", "message": "มีผู้อื่นจองที่นั่งนี้ไปก่อนแล้ว กรุณาเลือกที่นั่งใหม่", "details": { "seats": ["C5"] } } }
  ```

  `code` is the stable contract; `message` is Thai and meant for display; `details` is optional extra data
- Validation failures: 422 `VALIDATION_ERROR` with `details: [{ field, message }]`
- Two writes colliding on the same rows return 409 (`BOOKING_STATE_CHANGED`, `PAYMENT_NOT_PENDING`, `WRITE_CONFLICT`, …) — refresh and retry; nothing was half-written
- In development, 5xx errors also include `stack`

### Pagination

Admin lists (`/admin/bookings`, `/admin/payments`, `/admin/refunds`, `/admin/users`) accept `page` (from 1, default 1) and `pageSize` (default 50, max 100) and return `{ <items>, total, page, pageSize }`. A page past the end returns an empty list

### Rate limits

Limited requests get **429** with the code below. Limits come from [configuration](configuration.md) unless a number is given

| Endpoint | Limit | Counted per | Code |
|---|---|---|---|
| `POST /auth/login` | `LOGIN_LIMIT` per `LOGIN_WINDOW_MINUTES` — failed attempts only | IP + identifier, normalized like the account lookup (`081-234-5678` = `0812345678`) | `LOGIN_RATE_LIMITED` |
| `PATCH /auth/password`, `PATCH /auth/me` (one shared count) | `LOGIN_LIMIT` per `LOGIN_WINDOW_MINUTES` — failed attempts only | account | `LOGIN_RATE_LIMITED` |
| `POST /auth/register` | `REGISTER_LIMIT` per `REGISTER_WINDOW_MINUTES` — successful sign-ups only | IP | `REGISTER_RATE_LIMITED` |
| `POST /auth/register` | 30 per 15 minutes — failed attempts only | IP | `REGISTER_RATE_LIMITED` |
| `POST /auth/forgot-password` | `PASSWORD_RESET_LIMIT` per `PASSWORD_RESET_WINDOW_MINUTES` | IP + email | `RESET_RATE_LIMITED` |
| `POST /auth/reset-password`, `/auth/reset-password/check` | 60 per `PASSWORD_RESET_WINDOW_MINUTES` | IP | `RESET_RATE_LIMITED` |
| `POST /bookings` | 10 per 10 minutes — successful bookings only | account | `BOOKING_RATE_LIMITED` |
| `POST /bookings/:id/seat-changes` | 10 per 10 minutes — successful requests only | account | `SEAT_CHANGE_RATE_LIMITED` |
| `POST /payments/:bookingId/slip`, `POST /seat-changes/:id/slip` (one shared count) | 20 per hour — every request | account | `SLIP_RATE_LIMITED` |

Responses carry the `RateLimit` and `RateLimit-Policy` headers (IETF draft 7). The client IP comes from `TRUST_PROXY` — see [DEPLOY.md](../DEPLOY.md#7-lock-the-api-to-vercel-and-match-trust_proxy)

### Data conventions

- Timestamps are ISO 8601 in UTC; `date`, `from` and `to` filters are `YYYY-MM-DD` days in Thai time (UTC+7)
- Money is an integer number of baht
- Status values are the enums in [State machines](state-machines.md)

---

## Objects

Shapes shared by several endpoints. Fields marked † are only present in some responses

**User** — `{ id, name, email, phone, role }` (`role`: `USER` | `ADMIN`)

**Movie** — `{ id, titleTh, titleEn, synopsisTh, synopsisEn, posterUrl, backdropUrl, durationMin, rating, genres[], releaseDate, status, createdAt, updatedAt }` · `availableDates[]`† (days with upcoming showtimes, `GET /movies/:id` only) · `status`: `NOW_SHOWING` | `COMING_SOON` | `ARCHIVED`

**Showtime**
`{ id, movieId, movie: { id, titleTh, titleEn, posterUrl, durationMin }, theatre: { id, name, screenType }, startsAt, endsAt, basePrice, status, prices: { NORMAL, PREMIUM, SOFA }, totalSeats, availableSeats }`
`totalSeats` / `availableSeats` count active seats only. `status`: `SCHEDULED` | `CANCELLED`

**SeatMap**
`{ showtime: { id, startsAt, endsAt, basePrice, movie, theatre }, prices, rows: [{ rowLabel, seats: [{ id, seatNumber, zone, price, status }] }], stats: { total, available } }`
`status`: `AVAILABLE` | `HELD` (awaiting payment or slip review, or held for a seat-change request) | `BOOKED`. Inactive seats are omitted

**SeatSnapshot** — one seat as stored on a booking: `{ id, rowLabel, seatNumber, label, zone, price }` (`price` = what the customer paid)

**Booking**

| Field | Notes |
|---|---|
| `id`, `code`, `status` | `code` like `TRS-AB12CD`; status: `PENDING_PAYMENT` · `PENDING_VERIFICATION` · `PAID` · `CANCELLED` · `EXPIRED` |
| `totalAmount` | Net amount after seat changes |
| `holdExpiresAt`, `holdSecondsLeft` | Payment countdown, computed on the server; `null` when nothing is counting down |
| `seats` | SeatSnapshot[] |
| `createdAt`, `paidAt`, `cancelledAt`, `expiredAt`, `cancelReason` | |
| `canUploadSlip`, `lateSlipUntil` | Whether a slip can be sent now, and until when a late slip is accepted |
| `canCancel`, `cancelCutoffHours` | Whether the customer may cancel right now |
| `seatChange` | `{ canChange, blockedReason, changesLeft, maxChanges, cutoffMinutes, open: SeatChange \| null, history: SeatChange[] }` — `blockedReason`: `NOT_PAID` · `SHOWTIME_CANCELLED` · `WINDOW_CLOSED` · `PENDING` · `LIMIT` · `null` |
| `showtime` | `{ id, startsAt, endsAt, movie: { id, titleTh, titleEn, posterUrl, durationMin }, theatre: { id, name, screenType } }` |
| `payment` | Main (ticket) payment or `null`: `{ id, status, amount, reference, receiptNo, slipUploadedAt, hasSlip, rejectReason, refundBankName, refundAccountNo, refundedAt, refundNote, hasRefundSlip }` |
| `user`† | `{ id, name, phone }` — single-booking and admin responses |

**SeatChange**
`{ id, status, fromSeats[], toSeats[], fromAmount, toAmount, diffAmount, byAdmin, reason, closeReason, holdExpiresAt, holdSecondsLeft, createdAt, completedAt, payment }`
Seats are labels (`"C5"`). `diffAmount` > 0 = the customer pays more, < 0 = refunded. `payment` (or `null`): `{ id, kind, status, amount, refundAmount, receiptNo, rejectReason, refundBankName, refundAccountNo, refundedAt, refundNote, hasRefundSlip }`. Status: `PENDING_PAYMENT` · `PENDING_VERIFICATION` · `COMPLETED` · `CANCELLED` · `EXPIRED`

**SeatChangeDetail** — SeatChange plus `canUploadSlip`, `lateSlipUntil`, `lateSlipGraceMinutes`, `booking: { id, code, status, showtime }` and, in `payment`, `reference`, `qrPayload`, `promptPayId`, `merchantName`, `slipUploadedAt`, `hasSlip`

**PaymentPage** — what the payment screen needs:
`{ bookingId, bookingCode, bookingStatus, amount, reference, qrPayload, promptPayId, merchantName, status, slipUploadedAt, hasSlip, rejectReason, holdExpiresAt, holdSecondsLeft, canUploadSlip, lateSlipUntil, lateSlipGraceMinutes }`
`qrPayload` is a PromptPay (EMVCo) string for the amount; render it as a QR code

**Receipt**
`{ receiptNo, kind, issuedAt, issuer: { name, address }, customer: { name }, booking: { id, code, status, userId }, showtime: { startsAt, movie: { titleTh, titleEn }, theatre: { name } }, lines[], seatsChangedTo, totalAmount, amountTextTh, amountTextEn, payment: { method, reference }, refund }`
`lines` are `{ kind: 'SEATS', zone, unitPrice, quantity, amount, seats[] }` (ticket receipts, one line per zone and price) or a single `{ kind: 'SEAT_CHANGE', fromSeats[], toSeats[], quantity, unitPrice, amount }` (difference receipts). `seatsChangedTo` lists the current seats when they differ from the receipt. `refund` is `{ status, refundedAt }` once the money is being or has been refunded, otherwise `null`

**Notification** — `{ id, userId, type, titleTh, titleEn, bodyTh, bodyEn, data, readAt, createdAt }` · `data` usually holds `bookingId` (and `seatChangeId` / `showtimeId`) · types: `PAYMENT_APPROVED`, `PAYMENT_REJECTED`, `REFUND_COMPLETED`, `BOOKING_CANCELLED`, `BOOKING_EXPIRED`, `SHOWTIME_REMINDER`, `SHOWTIME_CANCELLED`, `LATE_PAYMENT_REFUND`, `SEATS_CHANGED`, `SEAT_CHANGE_REJECTED`, `SEAT_CHANGE_EXPIRED`, `SEAT_CHANGE_LATE_REFUND`

---

## Health

#### `GET /api/health` — Public

Liveness check that doesn't touch the database, and the only route open without `x-proxy-secret` when `PROXY_SECRET` is set. Returns `{ ok: true, service, time, ip, proxyHops, proxySecret }` — `ip` and `proxyHops` are used to set `TRUST_PROXY`, and `proxySecret` shows how this request's `x-proxy-secret` header compares (see [DEPLOY.md](../DEPLOY.md#7-lock-the-api-to-vercel-and-match-trust_proxy)):

| `proxySecret` | Meaning |
|---|---|
| `missing` | No header — the request didn't come through Vercel |
| `unresolved` | The header is the literal `$PROXY_SECRET`: the Vercel project has no `PROXY_SECRET` variable (or wasn't redeployed) |
| `unchecked` | A header arrived, but the API has no `PROXY_SECRET` to compare it with |
| `valid` · `invalid` | The header matches · doesn't match the API's `PROXY_SECRET` |

---

## Auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Sign up and sign in |
| `POST` | `/api/auth/login` | Public | Sign in with email or phone |
| `POST` | `/api/auth/refresh` | Cookie | Rotate the session |
| `POST` | `/api/auth/logout` | Cookie | Revoke this session |
| `GET` | `/api/auth/me` | User | Current user |
| `PATCH` | `/api/auth/me` | User | Edit own name / email (email needs the current password) |
| `PATCH` | `/api/auth/password` | User | Change own password |
| `POST` | `/api/auth/forgot-password` | Public | Email a reset link |
| `POST` | `/api/auth/reset-password/check` | Public | Validate a reset link |
| `POST` | `/api/auth/reset-password` | Public | Set a new password from a link |

#### `POST /api/auth/register`
- Body: `name` (2–60), `email` (≤120), `phone` (Thai mobile; `089-123-4567`, `+6689…` are normalized to 10 digits), `password` (8–72, letters and digits)
- **201** `{ user, accessToken, isNewUser: true }` and sets the refresh cookie
- Errors: 400 `INVALID_PHONE` · 409 `EMAIL_TAKEN`, `PHONE_TAKEN`, `DUPLICATE` · 429 `REGISTER_RATE_LIMITED` (too many sign-ups, or too many failed attempts, from this IP)

#### `POST /api/auth/login`
- Body: `identifier` (email if it contains `@`, otherwise phone), `password`
- **200** `{ user, accessToken }` and sets the refresh cookie
- Errors: 401 `INVALID_CREDENTIALS` (same answer whether the account exists or not) · 429 `LOGIN_RATE_LIMITED`

#### `POST /api/auth/refresh`
- Uses the refresh cookie; no body
- **204** when there is no cookie (not signed in — not an error) · **200** `{ user, accessToken }` with a rotated cookie
- Errors: 401 `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED` (every session of that user is revoked) — the cookie is cleared on any 401 · 409 `REFRESH_RACE` (another tab rotated the same cookie seconds ago; retry, the cookie is left alone)

#### `POST /api/auth/logout`
- Revokes the session in the cookie and clears it · **200** `{ ok: true }`

#### `GET /api/auth/me`
- **200** `{ user }`

#### `PATCH /api/auth/me`
- Body: `name` (1–60) and/or `email`, plus `currentPassword` when the email changes — the email is how the account is recovered, so a stolen session alone must not be able to redirect it
- **200** `{ user }` — changing the email also voids any password reset link sent to the old address
- Errors: 400 `CURRENT_PASSWORD_REQUIRED`, `WRONG_PASSWORD` · 409 `EMAIL_TAKEN`, `DUPLICATE` · 429 `LOGIN_RATE_LIMITED`

#### `PATCH /api/auth/password`
- Body: `currentPassword`, `newPassword` (8–72, letters and digits)
- **200** `{ ok: true, accessToken }` — every other session is revoked; this device keeps its refresh cookie and gets a new access token
- Errors: 400 `WRONG_PASSWORD` · 404 `USER_NOT_FOUND` · 429 `LOGIN_RATE_LIMITED`

#### `POST /api/auth/forgot-password`
- Body: `email`, `lang` (`th` | `en`, the email's language)
- **200** `{ ok: true, ttlMinutes }` whether or not the email has an account. `devResetUrl` is added only when `NODE_ENV=development` and SMTP isn't configured
- Errors: 429 `RESET_RATE_LIMITED`

#### `POST /api/auth/reset-password/check`
- Body: `token` (sent in the body, never the URL, so it stays out of access logs)
- **200** `{ email, name, expiresAt }` — `email` is masked (`so****@example.test`)
- Errors: 400 `RESET_LINK_INVALID`, `RESET_LINK_EXPIRED` · 429 `RESET_RATE_LIMITED`

#### `POST /api/auth/reset-password`
- Body: `token`, `password`
- **200** `{ ok: true, email }` — the link is used up and every session of the account is revoked. A password that fails validation (422) does not use up the link
- Errors: 400 `RESET_LINK_INVALID`, `RESET_LINK_EXPIRED` · 429 `RESET_RATE_LIMITED`

---

## Movies

#### `GET /api/movies` — Public
- Query: `status` (`NOW_SHOWING` | `COMING_SOON` | `ARCHIVED`), `q` (title search, Thai or English)
- **200** `{ movies: Movie[] }` — archived movies are left out unless `status=ARCHIVED`

#### `GET /api/movies/:id` — Public
- **200** `{ movie }` including `availableDates`
- Errors: 404 `MOVIE_NOT_FOUND`

---

## Showtimes

#### `GET /api/showtimes` — Public
- Query: `movieId`, `theatreId`, `date` (`YYYY-MM-DD`)
- **200** `{ showtimes: Showtime[] }` — scheduled showtimes that haven't started, ordered by start time then theatre name
- Errors: 400 `INVALID_DATE`

#### `GET /api/showtimes/:id` — Public
- **200** `{ showtime }` · Errors: 404 `SHOWTIME_NOT_FOUND`

#### `GET /api/showtimes/:id/seats` — Public
- **200** SeatMap (not wrapped) · Errors: 404 `SHOWTIME_NOT_FOUND`

---

## Bookings

All booking routes require a signed-in user

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/bookings` | User | Create a booking |
| `GET` | `/api/bookings` | User | My bookings |
| `GET` | `/api/bookings/:id` | Owner / admin | One booking |
| `GET` | `/api/bookings/:id/ticket` | Owner | E-Ticket |
| `GET` | `/api/bookings/:id/receipt` | Owner / admin | Receipt |
| `POST` | `/api/bookings/:id/cancel` | Owner | Cancel |
| `PATCH` | `/api/bookings/:id/refund-account` | Owner | Add or edit the refund account |
| `POST` | `/api/bookings/:id/seat-changes` | Owner | Change seats |

#### `POST /api/bookings`
- Body: `showtimeId`, `seatIds[]` (at least 1, at most `MAX_SEATS_PER_BOOKING`)
- **201** `{ booking }` — status `PENDING_PAYMENT`, seats held for `SEAT_HOLD_MINUTES`
- Errors: 400 `NO_SEATS`, `TOO_MANY_SEATS`, `INVALID_SEATS`, `SHOWTIME_CANCELLED`, `SHOWTIME_STARTED` · 404 `SHOWTIME_NOT_FOUND` · 409 `SEAT_TAKEN` (`details.seats`), `PENDING_BOOKING_EXISTS` (`details.bookingId`, `details.seats` — an unpaid booking for the same showtime), `TOO_MANY_PENDING_BOOKINGS` (`details.count`, `details.limit`) · 429 `BOOKING_RATE_LIMITED`
- See [Seat hold limits](architecture.md#seat-hold-limits)

#### `GET /api/bookings`
- Query: `scope` — `all` (default) · `upcoming` (awaiting payment, awaiting review or paid, showtime in the future) · `history` (cancelled, expired or past showtime)
- **200** `{ bookings: Booking[] }`, newest first

#### `GET /api/bookings/:id`
- **200** `{ booking }` · Errors: 404 `BOOKING_NOT_FOUND` · 403 `NOT_BOOKING_OWNER`

#### `GET /api/bookings/:id/ticket`
- **200** `{ ticket }` — a Booking plus `ticketQr` (the booking code to encode as the entry QR)
- Errors: 403 `TICKET_NOT_READY` (not paid), `NOT_BOOKING_OWNER` · 404 `BOOKING_NOT_FOUND`

#### `GET /api/bookings/:id/receipt`
- Query: `payment` — a seat-change difference payment of this booking; omit for the ticket receipt
- **200** `{ receipt }`
- Errors: 403 `RECEIPT_NOT_READY` (no receipt issued — unpaid, or a late payment being refunded), `NOT_BOOKING_OWNER` · 404 `BOOKING_NOT_FOUND`

#### `POST /api/bookings/:id/cancel`
- Body: `reason` (≤200), `refundBankName` (2–60) and `refundAccountNo` (10–15 digits; spaces and dashes are stripped) — both required when the booking is paid
- **200** `{ booking }` — seats released; a paid booking's payment becomes `REFUND_PENDING` for the net amount
- Errors: 400 `REFUND_ACCOUNT_REQUIRED` · 403 `NOT_BOOKING_OWNER`, `CANCEL_WINDOW_CLOSED` (`details.cancelCutoffHours`, `details.hoursLeft`) · 404 `BOOKING_NOT_FOUND` · 409 `ALREADY_CLOSED`, `AWAITING_VERIFICATION` (slip under review), `SEAT_CHANGE_AWAITING_VERIFICATION`, `BOOKING_STATE_CHANGED`

#### `PATCH /api/bookings/:id/refund-account`
- Body: `refundBankName`, `refundAccountNo` (both required)
- **200** `{ booking }` — applies to every payment of this booking that is awaiting a refund
- Errors: 403 `NOT_BOOKING_OWNER` · 404 `BOOKING_NOT_FOUND` · 409 `REFUND_NOT_PENDING`

#### `POST /api/bookings/:id/seat-changes`
- Body: `seatIds[]` — the complete new set (kept seats included), same count as now; `refundBankName` + `refundAccountNo` when moving to cheaper seats
- **201** `{ booking, seatChange }` — same or lower price: `seatChange.status = COMPLETED`; higher price: `PENDING_PAYMENT`, then pay at [`/api/seat-changes/:id`](#seat-changes)
- Errors: 400 `INVALID_SEATS`, `SEAT_COUNT_MISMATCH` (`details.required`), `NO_SEAT_CHANGE`, `SHOWTIME_CANCELLED`, `REFUND_ACCOUNT_REQUIRED` (`details.diffAmount`) · 403 `NOT_BOOKING_OWNER`, `SEAT_CHANGE_WINDOW_CLOSED` (`details.cutoffMinutes`) · 404 `BOOKING_NOT_FOUND` · 409 `SEAT_CHANGE_NOT_ALLOWED` (not paid), `SEAT_CHANGE_PENDING` (`details.seatChangeId`), `SEAT_CHANGE_LIMIT` (`details.max`), `SEAT_TAKEN`, `BOOKING_STATE_CHANGED` · 429 `SEAT_CHANGE_RATE_LIMITED`
- See [Seat changes](architecture.md#seat-changes)

---

## Seat changes

The next steps of a seat change that costs more. All routes require a signed-in user

#### `GET /api/seat-changes/:id` — Owner / admin
- **200** `{ seatChange }` (SeatChangeDetail, with the PromptPay payload for the difference)
- Errors: 403 `NOT_BOOKING_OWNER` · 404 `SEAT_CHANGE_NOT_FOUND`

#### `POST /api/seat-changes/:id/slip` — Owner
- Multipart field `slip`
- **201** `{ seatChange }` — moves to `PENDING_VERIFICATION` (late slips within `LATE_SLIP_GRACE_MINUTES` included)
- Errors: 400 `NO_FILE`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `UPLOAD_ERROR` · 403 `NOT_BOOKING_OWNER` · 404 `SEAT_CHANGE_NOT_FOUND` · 409 `SEAT_CHANGE_NOT_PAYABLE` (already sent, or the request is closed), `HOLD_EXPIRED` (grace period over) · 429 `SLIP_RATE_LIMITED`

#### `POST /api/seat-changes/:id/cancel` — Owner
- **200** `{ seatChange }` — held new seats released; the current seats are untouched
- Errors: 403 `NOT_BOOKING_OWNER` · 404 `SEAT_CHANGE_NOT_FOUND` · 409 `SEAT_CHANGE_AWAITING_VERIFICATION`, `SEAT_CHANGE_CLOSED`, `BOOKING_STATE_CHANGED`

---

## Payments

All routes require a signed-in user

#### `GET /api/payments/:bookingId` — Owner
- **200** `{ payment }` (PaymentPage)
- Errors: 403 `NOT_BOOKING_OWNER` · 404 `BOOKING_NOT_FOUND`, `PAYMENT_NOT_FOUND`

#### `POST /api/payments/:bookingId/slip` — Owner
- Multipart field `slip`
- **201** `{ payment }` (PaymentPage) — the countdown stops and the seats stay held until an admin decides. Accepted past the deadline while the seats are still held, and for `LATE_SLIP_GRACE_MINUTES` after expiry (see [Late slip submission](architecture.md#late-slip-submission))
- Errors: 400 `NO_FILE`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `UPLOAD_ERROR` · 403 `NOT_BOOKING_OWNER` · 404 `BOOKING_NOT_FOUND` · 409 `BOOKING_NOT_PAYABLE` (already sent, or the booking can't be paid), `HOLD_EXPIRED` · 429 `SLIP_RATE_LIMITED`

#### `GET /api/payments/:bookingId/slip` — Owner / admin
- Query: `payment` — a seat-change difference payment of this booking (omit for the ticket payment)
- **200** the image bytes (`Content-Type` from the file)
- Errors: 404 `SLIP_NOT_FOUND` (checked before ownership), `SLIP_FILE_MISSING` (the database refers to a file the storage no longer has) · 403 `NOT_BOOKING_OWNER`

#### `GET /api/payments/:bookingId/refund-slip` — Owner / admin
- Same as above for the slip of the admin's refund transfer
- Errors: 404 `REFUND_SLIP_NOT_FOUND`, `SLIP_FILE_MISSING` · 403 `NOT_BOOKING_OWNER`

---

## Notifications

All routes require a signed-in user and only touch that user's notifications

#### `GET /api/notifications`
- Query: `unreadOnly` (`true` | `false`), `limit` (1–100, default 50)
- **200** `{ notifications: Notification[], unreadCount }`, newest first

#### `POST /api/notifications/read-all`
- **200** `{ updated }` — the number marked as read

#### `POST /api/notifications/:id/read`
- **200** `{ ok: true }` (no-op if it's already read or isn't yours)

---

## Admin

Every route below requires role `ADMIN`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/overview` | Dashboard figures |
| `GET` | `/api/admin/queue-counts` | Menu badge counts |
| `GET` · `POST` | `/api/admin/movies` | List (archived included) · create |
| `PATCH` · `DELETE` | `/api/admin/movies/:id` | Edit · delete |
| `GET` · `POST` | `/api/admin/theatres` | List · create |
| `GET` · `PATCH` · `DELETE` | `/api/admin/theatres/:id` | Seat layout · edit · delete |
| `PATCH` | `/api/admin/theatres/:id/seats` | Bulk-edit seat zones / active state |
| `GET` · `POST` | `/api/admin/showtimes` | List · create |
| `GET` | `/api/admin/showtimes/availability` | Busy times and free start times |
| `PATCH` · `DELETE` | `/api/admin/showtimes/:id` | Move / reprice · delete |
| `POST` | `/api/admin/showtimes/:id/cancel` | Cancel a whole showtime |
| `GET` | `/api/admin/bookings` | Search all bookings |
| `POST` | `/api/admin/bookings/:id/cancel` | Cancel for a customer |
| `POST` | `/api/admin/bookings/:id/change-seats` | Move seats for a customer |
| `GET` | `/api/admin/payments` | Slip review queue |
| `POST` | `/api/admin/payments/:id/approve` · `/reject` | Approve · reject a slip |
| `GET` | `/api/admin/refunds` | Refund queue |
| `POST` | `/api/admin/refunds/:id/complete` | Record a refund transfer |
| `PATCH` | `/api/admin/refunds/:id` | Edit a recorded refund |
| `GET` | `/api/admin/users` | Search users |
| `PATCH` · `DELETE` | `/api/admin/users/:id` | Edit · delete a user |
| `POST` | `/api/admin/users/:id/password` | Set a temporary password |
| `GET` | `/api/admin/reports/sales` · `/sales.csv` · `/occupancy` | Reports |

### Overview

#### `GET /api/admin/overview`
- **200** `{ date, revenueToday, bookingsToday, ticketsToday, pendingSlips, showtimesToday, activeHolds, pendingRefunds, recentSlips[], recentRefunds[] }` — the recent lists hold up to 5 rows of `{ id, bookingId, code, customer, amount, status }`, items awaiting action first

#### `GET /api/admin/queue-counts`
- **200** `{ pendingSlips, pendingRefunds, pendingRefundAmount }` — two counts, cheap enough to poll; uses the same conditions as the overview and the queues

### Movies

#### `GET /api/admin/movies`
- Query: `status`, `q` · **200** `{ movies }` (archived included)

#### `POST /api/admin/movies`
- Body: `titleTh`, `titleEn` (1–150), `synopsisTh`, `synopsisEn` (≤3000), `posterUrl` (URL), `backdropUrl` (URL or empty), `durationMin` (30–400), `rating` (≤10, default `G`), `genres[]`, `releaseDate`, `status` (default `NOW_SHOWING`)
- **201** `{ movie }`

#### `PATCH /api/admin/movies/:id`
- Body: any subset of the fields above · **200** `{ movie }` · Errors: 404 `MOVIE_NOT_FOUND`

#### `DELETE /api/admin/movies/:id`
- Query: `force` (`true` to delete a movie that has bookings, with their history)
- **200** `{ deleted: true, bookingCount, showtimeCount }`
- Errors: 404 `MOVIE_NOT_FOUND` · 409 `MOVIE_HAS_BOOKINGS` (`details.bookingCount`, `details.showtimeCount` — without `force`), `MOVIE_HAS_RECEIPTS` (`details.receiptCount` — never deletable), `MOVIE_HAS_OPEN_BOOKINGS` (`details.activeBookings`, `details.openPayments`)
- See [Deleting records still tied to money](architecture.md#deleting-records-still-tied-to-money)

### Theatres

#### `GET /api/admin/theatres`
- **200** `{ theatres: [{ id, name, screenType, rowsCount, colsCount, isActive, seatCount, showtimeCount }] }`

#### `GET /api/admin/theatres/:id`
- **200** `{ theatre }` — theatre fields plus `rows: [{ rowLabel, seats: [{ id, rowLabel, seatNumber, zone, isActive, … }] }]` · Errors: 404 `THEATRE_NOT_FOUND`

#### `POST /api/admin/theatres`
- Body: `name` (1–60), `screenType` (default `2D`), `rowsCount` (1–26), `colsCount` (1–30)
- **201** `{ theatre }` — seats are generated: the front rows `NORMAL`, the back 55% `PREMIUM`, and the last row `SOFA` (half as many seats) when there are at least 4 rows
- Errors: 400 `INVALID_GRID`

#### `PATCH /api/admin/theatres/:id`
- Body: any of `name`, `screenType`, `rowsCount`, `colsCount`, `isActive` (inactive theatres can't get new showtimes)
- **200** `{ theatre }` — changing the size regenerates every seat
- Errors: 400 `INVALID_GRID` · 404 `THEATRE_NOT_FOUND` · 409 `THEATRE_HAS_BOOKINGS` (resizing while seats are booked)

#### `DELETE /api/admin/theatres/:id`
- **200** `{ ok: true }` · Errors: 409 `THEATRE_HAS_BOOKINGS` (`details.bookingCount` — any booking ever; deactivate instead) · 404 `NOT_FOUND`

#### `PATCH /api/admin/theatres/:id/seats`
- Body: `seatIds[]` (at least 1) and `zone` (`NORMAL` | `PREMIUM` | `SOFA`) and/or `isActive`
- **200** `{ updated, theatre }`

### Showtimes

#### `GET /api/admin/showtimes`
- Query: `movieId`, `theatreId`, `date`, `includePast` (default `true`)
- **200** `{ showtimes }` — cancelled showtimes included

#### `GET /api/admin/showtimes/availability`
- Query: `theatreId`, `movieId`, `date` (all required), `excludeId` (the showtime being edited)
- **200** `{ turnaroundMinutes, durationMin, slotStepMinutes, busy: [{ id, startsAt, endsAt, movie }], freeSlots: [ISO start times] }` — slots every 15 minutes between 10:00 and 24:00 Thai time, keeping 15 minutes between showtimes
- Errors: 400 `INVALID_DATE` · 404 `MOVIE_NOT_FOUND`

#### `POST /api/admin/showtimes`
- Body: `movieId`, `theatreId`, `startsAt` (ISO), `basePrice` (1–5000) — zone prices are derived from `basePrice`
- **201** `{ showtime }`
- Errors: 400 `THEATRE_INACTIVE` · 404 `MOVIE_NOT_FOUND`, `THEATRE_NOT_FOUND` · 409 `SHOWTIME_OVERLAP` (`details.conflictingShowtimeId`, `startsAt`, `endsAt`)

#### `PATCH /api/admin/showtimes/:id`
- Body: `theatreId`, `startsAt`, `basePrice` (all optional; `status` is not accepted — use `/cancel`)
- **200** `{ showtime }` — the price can always change; time or theatre only while nobody holds a seat
- Errors: 400 `THEATRE_INACTIVE` · 404 `SHOWTIME_NOT_FOUND`, `THEATRE_NOT_FOUND` · 409 `SHOWTIME_ALREADY_CANCELLED`, `SHOWTIME_HAS_BOOKINGS`, `SHOWTIME_OVERLAP`

#### `POST /api/admin/showtimes/:id/cancel`
- Body: `reason` (≤200, shown to customers)
- **200** `{ showtime, cancelledBookings, refundsQueued }`
- Errors: 404 `SHOWTIME_NOT_FOUND` · 409 `SHOWTIME_ALREADY_CANCELLED`, `SHOWTIME_ENDED`, `SHOWTIME_HAS_PENDING_SLIPS` (`details.count`), `BOOKING_STATE_CHANGED`
- See [Cancelling a whole showtime](architecture.md#cancelling-a-whole-showtime)

#### `DELETE /api/admin/showtimes/:id`
- **200** `{ ok: true }` · Errors: 409 `SHOWTIME_HAS_BOOKINGS` (`details.bookingCount` — any booking ever; cancel instead) · 404 `NOT_FOUND`

### Bookings

#### `GET /api/admin/bookings`
- Query: `status`, `date` (showtime day), `q` (booking code, receipt number, customer phone or name), `page`, `pageSize`
- **200** `{ bookings: Booking[], total, page, pageSize }`, newest first

#### `POST /api/admin/bookings/:id/cancel`
- Body: `reason` (≤200)
- **200** `{ booking }` — any open status; no refund account needed (the customer can add it later)
- Errors: 404 `BOOKING_NOT_FOUND` · 409 `ALREADY_CLOSED`, `SEAT_CHANGE_AWAITING_VERIFICATION`, `BOOKING_STATE_CHANGED`

#### `POST /api/admin/bookings/:id/change-seats`
- Body: `seatIds[]` (complete new set, every seat in its original zone), `reason` (≤200, shown in the customer's notification)
- **200** `{ booking, seatChange }` — no deadline, no quota, must be before the showtime ends
- Errors: 400 `INVALID_SEATS`, `SEAT_COUNT_MISMATCH`, `NO_SEAT_CHANGE`, `SEAT_ZONE_MISMATCH`, `SHOWTIME_CANCELLED` · 404 `BOOKING_NOT_FOUND` · 409 `SEAT_CHANGE_NOT_ALLOWED`, `SHOWTIME_ENDED`, `SEAT_CHANGE_PENDING`, `SEAT_TAKEN`, `BOOKING_STATE_CHANGED`

### Slip review

#### `GET /api/admin/payments`
- Query: `status` — `PENDING_VERIFICATION` (default: the review queue, late slips included) · `AWAITING_SLIP` · `APPROVED` · `REJECTED` · `ALL`; `page`, `pageSize`
- **200** `{ payments, total, page, pageSize }`, oldest slip first. Each item: `{ id, kind, seatChange, status, amount, reference, slipUploadedAt, hasSlip, rejectReason, verifiedAt, verifiedBy, booking: { id, code, status, totalAmount, seats, createdAt, user, showtime } }` — `seatChange` is `{ id, status, fromSeats, toSeats, diffAmount, byAdmin }` for difference payments

#### `POST /api/admin/payments/:id/approve`
- **200** `{ booking }` — ticket payment: booking `PAID` + receipt (emailed); difference payment: seats move + difference receipt; late slip whose seats are gone: payment goes to the refund queue, no receipt
- Errors: 404 `PAYMENT_NOT_FOUND` · 409 `PAYMENT_NOT_PENDING`, `BOOKING_NOT_PENDING`

#### `POST /api/admin/payments/:id/reject`
- Body: `reason` (1–200, required; shown to the customer)
- **200** `{ booking }` — a new payment window of `REJECTED_RETRY_MINUTES`, or closed if the showtime has started or the slip was late
- Errors: 404 `PAYMENT_NOT_FOUND` · 409 `PAYMENT_NOT_PENDING`, `BOOKING_NOT_PENDING`

### Refunds

#### `GET /api/admin/refunds`
- Query: `status` — `REFUND_PENDING` (default, longest waiting first) · `REFUNDED` (most recent first) · `ALL`; `page`, `pageSize`
- **200** `{ refunds, total, page, pageSize }`. Each item: `{ id, kind, seatChange, status, amount, refundAmount, reference, paidAt, refundDueAt, refundedAt, refundedBy, refundNote, refundBankName, refundAccountNo, hasRefundSlip, booking: { id, code, status, totalAmount, seats, cancelledAt, cancelReason, user, showtime } }` — `refundAmount` is the amount to transfer

#### `POST /api/admin/refunds/:id/complete`
- Multipart: `slip` (required), `note`
- **200** `{ ok: true }` — payment `REFUNDED`, customer notified
- Errors: 400 `NO_FILE`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `UPLOAD_ERROR` · 404 `PAYMENT_NOT_FOUND` · 409 `REFUND_NOT_PENDING`

#### `PATCH /api/admin/refunds/:id`
- Multipart: `slip` (optional — replaces the old one), `note` (empty clears it)
- **200** `{ ok: true }` — status and timestamp unchanged, no new notification
- Errors: 404 `PAYMENT_NOT_FOUND` · 409 `REFUND_NOT_COMPLETED`

### Users

#### `GET /api/admin/users`
- Query: `q` (name, email or phone), `role`, `page`, `pageSize`
- **200** `{ users: [{ id, email, phone, name, role, createdAt, bookingCount }], total, page, pageSize }`

#### `PATCH /api/admin/users/:id`
- Body: at least one of `name` (2–60), `email`, `phone`, `role`
- **200** `{ user }` — role changes apply to the next request (no re-login needed)
- Errors: 400 `CANNOT_CHANGE_OWN_ROLE`, `INVALID_PHONE` · 404 `USER_NOT_FOUND` · 409 `EMAIL_TAKEN`, `PHONE_TAKEN`, `DUPLICATE`

#### `POST /api/admin/users/:id/password`
- Body: `newPassword` (8–72, letters and digits)
- **200** `{ ok: true }` — every session of that user is revoked
- Errors: 400 `USE_PROFILE_PAGE` (your own account) · 404 `USER_NOT_FOUND`

#### `DELETE /api/admin/users/:id`
- **200** `{ ok: true }` · Errors: 400 `CANNOT_DELETE_SELF` · 404 `USER_NOT_FOUND` · 409 `USER_HAS_BOOKINGS` (`details.bookingCount`)

### Reports

#### `GET /api/admin/reports/sales`
- Query: `from`, `to` (`YYYY-MM-DD`, by payment day), `groupBy` — `day` (default) · `movie` · `theatre`
- **200** `{ groupBy, from, to, rows: [{ key, label, labelEn, bookings, tickets, revenue }], totals: { bookings, tickets, revenue }, refunds: { count, amount, pendingCount, pendingAmount } }` — paid bookings only; `refunds` covers money queued for refund in the same period

#### `GET /api/admin/reports/sales.csv`
- Same query · **200** `text/csv` attachment `sales-report.csv` (UTF-8 with BOM so Excel reads Thai)

#### `GET /api/admin/reports/occupancy`
- Query: `from` (default: now), `to`
- **200** `{ showtimes: [{ showtimeId, startsAt, movie, theatre, totalSeats, soldSeats, occupancy }] }` — scheduled showtimes, at most 200; `occupancy` is a percentage of active seats

---

## Error codes

Status, code and meaning. Codes are stable; messages may be reworded

| Status | Code | Meaning |
|---|---|---|
| 400 | `CANNOT_CHANGE_OWN_ROLE` | Admins can't change their own role |
| 400 | `CANNOT_DELETE_SELF` | Admins can't delete their own account |
| 400 | `CURRENT_PASSWORD_REQUIRED` | Changing your email needs `currentPassword` |
| 400 | `FILE_TOO_LARGE` | Upload larger than `MAX_SLIP_SIZE_MB` |
| 400 | `INVALID_DATE` | Date isn't `YYYY-MM-DD` |
| 400 | `INVALID_GRID` | Theatre size outside 1–26 rows / 1–30 seats per row |
| 400 | `INVALID_PATH` | Stored slip name escapes its folder |
| 400 | `INVALID_PHONE` | Not a 10-digit Thai mobile number |
| 400 | `INVALID_SEATS` | Seat doesn't belong to this showtime's theatre or is inactive |
| 400 | `NO_FILE` | Slip file missing |
| 400 | `NO_SEATS` | No seats selected |
| 400 | `NO_SEAT_CHANGE` | Seat change selects the same seats |
| 400 | `REFUND_ACCOUNT_REQUIRED` | Paid cancellation or cheaper seat change needs a bank and account number |
| 400 | `RESET_LINK_EXPIRED` | Password reset link older than `PASSWORD_RESET_TTL_MINUTES` |
| 400 | `RESET_LINK_INVALID` | Unknown or already used reset link |
| 400 | `SEAT_COUNT_MISMATCH` | Seat change must keep the same number of seats |
| 400 | `SEAT_ZONE_MISMATCH` | Admin seat moves must keep every seat's zone |
| 400 | `SHOWTIME_CANCELLED` | The showtime was cancelled |
| 400 | `SHOWTIME_STARTED` | Can't book a showtime that has started |
| 400 | `THEATRE_INACTIVE` | Inactive theatres can't get new showtimes |
| 400 | `TOO_MANY_SEATS` | More than `MAX_SEATS_PER_BOOKING` seats |
| 400 | `UNSUPPORTED_FILE_TYPE` | Not a real JPG, PNG or WEBP image |
| 400 | `UPLOAD_ERROR` | Malformed multipart upload |
| 400 | `USE_PROFILE_PAGE` | Change your own password on the profile page |
| 400 | `WRONG_PASSWORD` | Current password is wrong |
| 401 | `INVALID_CREDENTIALS` | Wrong email/phone or password |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh cookie not recognised |
| 401 | `INVALID_TOKEN` | Access token malformed or badly signed |
| 401 | `NO_REFRESH_TOKEN` | Session rotation without a token — not returned over HTTP, where a refresh without a cookie answers 204 |
| 401 | `NO_TOKEN` | Missing `Authorization: Bearer` header |
| 401 | `REFRESH_TOKEN_EXPIRED` | Refresh cookie past its lifetime |
| 401 | `REFRESH_TOKEN_REUSED` | A revoked refresh token was replayed; all sessions revoked |
| 401 | `TOKEN_EXPIRED` | Access token expired — refresh and retry |
| 401 | `TOKEN_REVOKED` | Password changed or user removed since the token was issued |
| 401 | `UNAUTHORIZED` | Role check reached without a signed-in user |
| 403 | `CANCEL_WINDOW_CLOSED` | Less than `CANCEL_CUTOFF_HOURS` before the showtime |
| 403 | `DIRECT_ACCESS_FORBIDDEN` | `PROXY_SECRET` is set and the request didn't come through the web app's proxy |
| 403 | `NOT_BOOKING_OWNER` | The booking belongs to someone else |
| 403 | `RECEIPT_NOT_READY` | No receipt has been issued for this payment |
| 403 | `ROLE_REQUIRED` | Admin role required |
| 403 | `SEAT_CHANGE_WINDOW_CLOSED` | Less than `SEAT_CHANGE_CUTOFF_MINUTES` before the showtime |
| 403 | `TICKET_NOT_READY` | The booking isn't paid yet |
| 404 | `BOOKING_NOT_FOUND` | No such booking |
| 404 | `MOVIE_NOT_FOUND` | No such movie |
| 404 | `NOT_FOUND` | Record to update or delete doesn't exist |
| 404 | `PAYMENT_NOT_FOUND` | No such payment |
| 404 | `REFUND_SLIP_NOT_FOUND` | No refund slip recorded yet |
| 404 | `ROUTE_NOT_FOUND` | Unknown method + path |
| 404 | `SEAT_CHANGE_NOT_FOUND` | No such seat-change request |
| 404 | `SHOWTIME_NOT_FOUND` | No such showtime |
| 404 | `SLIP_FILE_MISSING` | The database refers to a slip file the storage no longer has |
| 404 | `SLIP_NOT_FOUND` | No slip uploaded yet |
| 404 | `THEATRE_NOT_FOUND` | No such theatre |
| 404 | `USER_NOT_FOUND` | No such user |
| 409 | `ALREADY_CLOSED` | Booking already cancelled or expired |
| 409 | `AWAITING_VERIFICATION` | Slip under review — customers can't cancel until it's decided |
| 409 | `BOOKING_NOT_PAYABLE` | Slip already sent, or the booking can no longer be paid |
| 409 | `BOOKING_NOT_PENDING` | The booking or request behind this slip changed status |
| 409 | `BOOKING_STATE_CHANGED` | The booking changed during the request — refresh and retry |
| 409 | `DUPLICATE` | Unique value already used |
| 409 | `EMAIL_TAKEN` | Email belongs to another account |
| 409 | `HOLD_EXPIRED` | Late-slip grace period is over — contact staff with the booking code |
| 409 | `MOVIE_HAS_BOOKINGS` | Movie has bookings; delete again with `force=true` or archive |
| 409 | `MOVIE_HAS_OPEN_BOOKINGS` | Movie still has upcoming tickets, slips under review or pending refunds |
| 409 | `MOVIE_HAS_RECEIPTS` | Movie has issued receipts and can only be archived |
| 409 | `PAYMENT_NOT_PENDING` | Slip already reviewed or its status changed |
| 409 | `PENDING_BOOKING_EXISTS` | Unpaid booking for the same showtime already exists |
| 409 | `PHONE_TAKEN` | Phone belongs to another account |
| 409 | `REFRESH_RACE` | Another tab just rotated this session — retry |
| 409 | `REFUND_NOT_COMPLETED` | Refund not recorded yet, so it can't be edited |
| 409 | `REFUND_NOT_PENDING` | Nothing awaiting a refund (already refunded or never queued) |
| 409 | `SEAT_CHANGE_AWAITING_VERIFICATION` | A difference slip is under review |
| 409 | `SEAT_CHANGE_CLOSED` | Seat-change request already finished |
| 409 | `SEAT_CHANGE_LIMIT` | `MAX_SEAT_CHANGES_PER_BOOKING` reached |
| 409 | `SEAT_CHANGE_NOT_ALLOWED` | Only paid bookings can change seats |
| 409 | `SEAT_CHANGE_NOT_PAYABLE` | Difference slip already sent, or the request can no longer be paid |
| 409 | `SEAT_CHANGE_PENDING` | Another seat-change request is still open |
| 409 | `SEAT_TAKEN` | Someone else got the seat first (`details.seats`) |
| 409 | `SHOWTIME_ALREADY_CANCELLED` | Showtime already cancelled |
| 409 | `SHOWTIME_ENDED` | Showtime has ended |
| 409 | `SHOWTIME_HAS_BOOKINGS` | Showtime has bookings — can't move or delete it |
| 409 | `SHOWTIME_HAS_PENDING_SLIPS` | Review the showtime's pending slips first |
| 409 | `SHOWTIME_OVERLAP` | Clashes with another showtime in the same theatre (15-minute gap) |
| 409 | `THEATRE_HAS_BOOKINGS` | Theatre has bookings — can't resize or delete it |
| 409 | `TOO_MANY_PENDING_BOOKINGS` | `MAX_PENDING_BOOKINGS_PER_USER` unfinished bookings already |
| 409 | `USER_HAS_BOOKINGS` | Users with bookings can't be deleted |
| 409 | `WRITE_CONFLICT` | PostgreSQL resolved a deadlock or serialization failure — retry |
| 422 | `VALIDATION_ERROR` | Request body or query failed validation (`details[]`) |
| 429 | `BOOKING_RATE_LIMITED` | Too many bookings |
| 429 | `LOGIN_RATE_LIMITED` | Too many failed sign-ins or current-password attempts |
| 429 | `REGISTER_RATE_LIMITED` | Too many sign-ups, or failed sign-up attempts, from this IP |
| 429 | `RESET_RATE_LIMITED` | Too many password reset requests |
| 429 | `SEAT_CHANGE_RATE_LIMITED` | Too many seat-change requests |
| 429 | `SLIP_RATE_LIMITED` | Too many slip uploads from this account |
| 500 | `INTERNAL_ERROR` | Unexpected server error (logged) |
