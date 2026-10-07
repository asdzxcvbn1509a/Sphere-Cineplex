# Configuration

All configuration lives in the API's environment. The web app's code reads no environment variables; the only variable on Vercel is `PROXY_SECRET` (see [Web app](#web-app))

- [How the server reads its environment](#how-the-server-reads-its-environment)
- [Server variables](#server-variables)
- [Seed script](#seed-script)
- [Test environment](#test-environment)
- [Web app](#web-app)
- [Production](#production)

---

## How the server reads its environment

- `server/src/config/env.js` loads `server/.env` (dotenv) and validates every variable with zod at startup. If anything is invalid, the server prints the offending variables (`ตั้งค่า environment ไม่ถูกต้อง`, "invalid environment configuration") and exits
- **Empty values count as unset.** `server/.env.example` has lines such as `SMTP_HOST=` to fill in later; they fall back to the defaults below instead of failing validation
- Start from the example: `cp server/.env.example server/.env`, then set `DATABASE_URL` and the two JWT secrets

## Server variables

### Core

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL connection string used by Prisma. For Supabase use the Session pooler URL and append `?connection_limit=5` (see [DEPLOY.md](../DEPLOY.md#22-connection-string--database_url)) |
| `PORT` | `4000` | HTTP port of the API |
| `NODE_ENV` | `production` | `development` · `test` · `production`. Development enables request logging (`morgan`), stack traces in 5xx responses, emails printed to the console and the dev-only password reset link; production marks the refresh cookie `Secure` and refuses the sample JWT secrets. The default is `production` so a host that forgets to set it never runs in development mode; `server/.env.example` sets `development` for local work |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin (credentials enabled) and the default base for links in emails |
| `APP_URL` | value of `CLIENT_ORIGIN` | Base URL of links in emails (password reset, receipt). Must be reachable from the user's own device; a trailing `/` is removed |
| `TRUST_PROXY` | `loopback` | Which proxies to trust `X-Forwarded-For` from. A number = how many proxies sit in front of the API. Rate limits key on the resulting client IP — **don't set `true`** unless you're sure, or IPs can be spoofed to dodge rate limits (see [DEPLOY.md](../DEPLOY.md#7-lock-the-api-to-vercel-and-match-trust_proxy)) |
| `PROXY_SECRET` | _(empty)_ | When set (≥ 32 chars), only requests carrying it in the `x-proxy-secret` header are accepted — Vercel adds the header from its own `PROXY_SECRET` — and everything else gets 403 `DIRECT_ACCESS_FORBIDDEN`, except `GET /api/health`. This closes the direct path to the API, where `X-Forwarded-For` could be spoofed. Empty = no check (development and tests) |

### Sessions and accounts

| Variable | Default | Meaning |
|---|---|---|
| `JWT_ACCESS_SECRET` | **required** (≥ 16 chars) | Signs access tokens (HS256). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. In production the sample values from `.env.example` / `.env.test.example` are refused at startup, since anyone reading the repo could sign tokens with them |
| `JWT_REFRESH_SECRET` | **required** (≥ 16 chars) | Validated at startup (including the production sample-value check) but not used to sign anything today: refresh tokens are random values stored as SHA-256 hashes. Still set it to a random value |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime ([jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) syntax) |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh cookie and session lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost, 8–15 (higher = harder to guess but slower logins) |
| `LOGIN_LIMIT` | `10` | Failed logins allowed per (IP + account) within the window; successful ones don't count. The account is normalized the same way the login looks it up, so `081-234-5678` and `0812345678` share one count. Also limits wrong current-password attempts per account (password change and email change) |
| `LOGIN_WINDOW_MINUTES` | `15` | Window for counting failed logins |
| `REGISTER_LIMIT` | `50` | Accounts that can be registered per IP within the window, counting only successful sign-ups. Failed sign-ups have a separate fixed limit of 30 per 15 minutes per IP, so the sign-up form can't be used to probe which emails and phone numbers have accounts |
| `REGISTER_WINDOW_MINUTES` | `60` | Window for counting sign-ups |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | Lifetime of password reset links |
| `PASSWORD_RESET_LIMIT` | `5` | Reset links that can be requested per (IP + email) within the window |
| `PASSWORD_RESET_WINDOW_MINUTES` | `60` | Window for counting reset requests (also the window of the 60-requests-per-IP limit on the reset endpoints) |

### Booking rules

| Variable | Default | Meaning |
|---|---|---|
| `SEAT_HOLD_MINUTES` | `10` | How long seats are held while awaiting payment (also the hold for a pricier seat change) |
| `REJECTED_RETRY_MINUTES` | `10` | The new payment window after a slip is rejected |
| `CANCEL_CUTOFF_HOURS` | `3` | Customers can cancel while at least this much time remains before the showtime |
| `MAX_SEATS_PER_BOOKING` | `8` | Maximum seats per booking |
| `MAX_PENDING_BOOKINGS_PER_USER` | `3` | Unfinished bookings (awaiting payment + awaiting slip review) one account can hold at once |
| `LATE_SLIP_GRACE_MINUTES` | `30` | Minutes after the payment window closes during which a slip is still accepted (`0` = off) — also applies to seat-change difference slips |
| `SEAT_CHANGE_CUTOFF_MINUTES` | `30` | Customers can change seats themselves until this many minutes before the showtime |
| `MAX_SEAT_CHANGES_PER_BOOKING` | `2` | Seat changes a customer can make per booking (expired/cancelled requests and admin moves don't count) |

> The web app shows two of these as constants: `MAX_SEATS` and `HOLD_MINUTES` in `client/src/pages/SeatSelectionPage.jsx`, and `HOLD_MINUTES` in `client/src/pages/ChangeSeatsPage.jsx`. They only affect what the page displays — the server enforces the real limits — but update them together with the server values

### Payments and receipts

| Variable | Default | Meaning |
|---|---|---|
| `PROMPTPAY_ID` | `0812345678` | Destination PromptPay number (phone or national ID) the QR codes pay to — **must be changed before going live**; money scanned from the QR really goes to this number. In production the server warns at startup while it's still the sample number (a warning, not an error, so demo sites can keep a fake number on purpose) |
| `PROMPTPAY_MERCHANT_NAME` | `THEATRE RESERVATION` | Merchant name returned with the payment details |
| `RECEIPT_ISSUER_NAME` | `Sphere Cineplex` | Receipt issuer name, on the receipt page and in the receipt email |
| `RECEIPT_ISSUER_ADDRESS` | _(empty)_ | Receipt issuer address — empty = no address line |

### Email

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST` | _(empty)_ | Outgoing mail server — **empty = nothing is really sent**. In development each email, links included, is printed to the server console instead; in production only a one-line notice with a masked recipient is logged (never the message — a reset link in the logs would hand over the account), plus a warning at startup |
| `SMTP_PORT` | `587` | SMTP port (use `465` together with `SMTP_SECURE=true`) |
| `SMTP_SECURE` | inferred from the port | `true` when the connection is encrypted from the start; if unset, `true` only for port 465 |
| `SMTP_USER` / `SMTP_PASS` | _(empty)_ | SMTP credentials (can stay empty if the server needs no login) |
| `MAIL_FROM` | `Theatre Reservation <no-reply@localhost>` | Sender shown in emails (`.env.example` sets `CineBook <no-reply@example.com>`) |

Render's free plan blocks SMTP ports 25, 465 and 587 — see [DEPLOY.md](../DEPLOY.md#9-email-optional) for a provider that accepts port 2525

### Slip storage

| Variable | Default | Meaning |
|---|---|---|
| `UPLOAD_DIR` | `uploads` | Root folder for slips stored on disk (relative to `server/`); slips go to `slips/payments/` and `slips/refunds/` under it |
| `MAX_SLIP_SIZE_MB` | `5` | Maximum slip file size |
| `SUPABASE_URL` | _(empty)_ | Supabase Project URL — **empty = slips are stored on disk**; when set, they're stored in Supabase Storage (see [Slip storage](architecture.md#slip-storage)) |
| `SUPABASE_SECRET_KEY` | _(empty)_ | Secret key (`sb_secret_…`) or legacy service_role key. Must be set together with `SUPABASE_URL`, and **never on the client side** |
| `SUPABASE_SLIP_BUCKET` | `slips` | Bucket that stores slips (must be private) |

## Seed script

`npm run db:seed` (`server/prisma/seed.js`) **wipes every table** and creates 6 movies, 3 theatres, showtimes for the next 7 days, an admin (`admin@cinebook.test`) and a customer with paid bookings (`somchai@example.test`)

| Variable | Default | Meaning |
|---|---|---|
| `SEED_PASSWORD` | `Password123` | Password of both demo accounts. **Always set it when seeding a site outsiders can reach** — the default is published in the README |

## Test environment

Integration tests read `server/.env.test` (copy it from `server/.env.test.example`)

- `DATABASE_URL` must point at a database whose name ends in `_test` (the example uses `theatre_reservation_test`); the test helpers refuse to run otherwise, because every test wipes every table
- `SMTP_HOST` must be empty, so tests never send real email
- `UPLOAD_DIR=uploads-test` keeps test slips out of `uploads/`
- `BCRYPT_ROUNDS=8` keeps password hashing fast
- `PROXY_SECRET` stays empty; tests that need the direct-access check pass their own secret to `createApp({ proxySecret })`

See [Testing](testing.md)

## Web app

The web app's code (`client/`) reads no environment variables

- In development, `client/vite.config.js` proxies `/api` to `http://localhost:4000`, so the refresh cookie is same-origin
- In production, `client/vercel.json`:
  - rewrites `/api/*` to the API host, first adding the `x-proxy-secret` header from the Vercel project variable `PROXY_SECRET` (a `routes` entry with a `request.headers` transform). Without the variable, Vercel sends the literal text `$PROXY_SECRET`, which `/api/health` reports as `unresolved`
  - sends security headers with every page (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) — not with `/api/*`, which gets its own from `helmet`. The CSP allows scripts and styles only from the site itself (plus Google Fonts), images from any `https:` URL (movie posters are external links), `data:` and `blob:` (QR codes and slip images)
  - caches `/assets/*` for a year (`immutable`) — Vite fingerprints those file names
- Never give `PROXY_SECRET` a `VITE_` prefix: Vite bundles `VITE_*` variables into the JavaScript every visitor downloads
- The API base path is fixed to `/api` in `client/src/api/client.js`

## Production

`render.yaml` sets `NODE_ENV=production` and `TRUST_PROXY`, and Render generates both JWT secrets. `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CLIENT_ORIGIN`, `PROMPTPAY_ID` and `PROXY_SECRET` are entered when the Blueprint is created (`PROXY_SECRET` is left empty until Vercel sends it). The full walkthrough is in [DEPLOY.md](../DEPLOY.md)

Before going live, at minimum:

- [ ] `PROMPTPAY_ID` is your own PromptPay number
- [ ] New random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- [ ] `SMTP_*` configured, so password reset links and receipts are really emailed
- [ ] `NODE_ENV=production` and the site served over HTTPS (the refresh cookie is `Secure` only then)
- [ ] `TRUST_PROXY` matches the proxies in front of the API, and `PROXY_SECRET` is set to the same value on Vercel and Render
- [ ] `SUPABASE_URL` + `SUPABASE_SECRET_KEY` set if the host has no persistent disk
- [ ] The demo accounts were seeded with your own `SEED_PASSWORD`, not the published `Password123`
