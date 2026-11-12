# Configuration

All configuration lives in the server's environment. The web app's code reads no environment variables — in production the same ASP.NET Core app serves it (see [Web app](#web-app))

- [How the server reads its environment](#how-the-server-reads-its-environment)
- [Server variables](#server-variables)
- [Database migrations](#database-migrations)
- [Seed](#seed)
- [Test environment](#test-environment)
- [Web app](#web-app)
- [Production](#production)

---

## How the server reads its environment

- `Program.cs` loads `server/.env` into the process environment at startup (DotNetEnv). **Values already in the environment win** — a variable set in the shell or in the App Service's App Settings overrides the file
- `Infrastructure/Config/AppConfigLoader.cs` then reads and validates every variable into one `AppConfig`. If anything is invalid, the server prints the offending variables (`❌ ตั้งค่า environment ไม่ถูกต้อง`, "invalid environment configuration") and exits
- **Empty values count as unset.** `server/.env.example` has lines such as `SMTP_HOST=` to fill in later; they fall back to the defaults below instead of failing validation
- Start from the example: `cp server/.env.example server/.env`, then set `DATABASE_URL` and the two JWT secrets
- The variable names are the same as the earlier Express version, except `NODE_ENV` → `ASPNETCORE_ENVIRONMENT` and `SUPABASE_*` → `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_SLIP_CONTAINER`. An old `server/.env` keeps working; its leftover `NODE_ENV` and `SUPABASE_*` lines are ignored

## Server variables

### Core

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL connection — a URI (`postgresql://user:pass@host:5432/db?sslmode=require`) or an Npgsql connection string. From the URI, `sslmode` is kept, `connection_limit` becomes the pool size and `schema=public` is ignored. Azure Database for PostgreSQL needs `?sslmode=require` (see [DEPLOY.md](../DEPLOY.md)) |
| `ASPNETCORE_ENVIRONMENT` | `Production` | `Development` · `Test` · `Production`. Development enables the one-line request log, stack traces in 5xx responses, emails printed to the console and the dev-only password reset link; Production marks the refresh cookie `Secure`, refuses the sample JWT secrets and prints warnings at startup. `dotnet run` / `dotnet watch` set `Development` from `Properties/launchSettings.json`; a host that sets nothing runs in Production |
| `PORT` | `4000` | HTTP port when the host doesn't choose one. `ASPNETCORE_URLS` or `ASPNETCORE_HTTP_PORTS` (App Service sets `8080`) win over it |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin (credentials enabled) and the default base for links in emails. In production the web app is served from the same origin, so this is the site's own URL |
| `APP_URL` | value of `CLIENT_ORIGIN` | Base URL of links in emails (password reset, receipt). Must be reachable from the user's own device; a trailing `/` is removed |
| `TRUST_PROXY` | `loopback` | Which proxies to trust `X-Forwarded-For` from: `loopback`, a number (how many proxies sit in front of the app — App Service has one), or a list of IPs/CIDRs. Rate limits key on the resulting client IP — **don't set `true`** unless you're sure, or IPs can be spoofed to dodge rate limits. `/api/health` reports `proxyHops` to help set it (see [DEPLOY.md](../DEPLOY.md)) |
| `PROXY_SECRET` | _(empty)_ | When set (≥ 32 chars), only requests carrying it in the `x-proxy-secret` header are accepted and everything else gets 403 `DIRECT_ACCESS_FORBIDDEN`, except `GET /api/health`. Use it only when a proxy or CDN in front of the app adds the header; leave it empty on App Service, where visitors reach the app directly |
| `DB_MIGRATE_ON_START` | `false` | `true` = apply pending EF Core migrations when the app starts (and before `-- seed`). Used on Azure; locally run `dotnet ef database update` instead |
| `RUN_JOBS` | `true` | `false` = don't start the background jobs (releasing expired holds and seat changes, showtime reminders). The tests set it |

`ASPNETCORE_FORWARDEDHEADERS_ENABLED` must not be `true`: ASP.NET Core would read `X-Forwarded-For` a second time on top of `TRUST_PROXY`, and the server warns at startup if it is

### Sessions and accounts

| Variable | Default | Meaning |
|---|---|---|
| `JWT_ACCESS_SECRET` | **required** (≥ 16 chars) | Signs access tokens (HS256). Generate with `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))` in PowerShell or `openssl rand -hex 32`. In Production the sample values from `.env.example` / `.env.test.example` are refused at startup, since anyone reading the repo could sign tokens with them. Tokens signed by the earlier Express version with the same secret stay valid |
| `JWT_REFRESH_SECRET` | **required** (≥ 16 chars) | Validated at startup (including the Production sample-value check) but not used to sign anything today: refresh tokens are random values stored as SHA-256 hashes. Still set it to a random value |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime: a number with `ms`, `s`, `m`, `h`, `d` (`15m`, `1h`); a plain number is milliseconds |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh cookie and session lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost, 8–15 (higher = harder to guess but slower logins). Hashes made by the earlier version (bcryptjs, `$2b$`) verify as they are |
| `LOGIN_LIMIT` | `10` | Failed logins allowed per (IP + account) within the window; successful ones don't count. The account is normalized the same way the login looks it up, so `081-234-5678` and `0812345678` share one count. Also limits wrong current-password attempts per account (password change and email change) |
| `LOGIN_WINDOW_MINUTES` | `15` | Window for counting failed logins |
| `REGISTER_LIMIT` | `50` | Accounts that can be registered per IP within the window, counting only successful sign-ups. Failed sign-ups have a separate fixed limit of 30 per 15 minutes per IP, so the sign-up form can't be used to probe which emails and phone numbers have accounts |
| `REGISTER_WINDOW_MINUTES` | `60` | Window for counting sign-ups |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | Lifetime of password reset links |
| `PASSWORD_RESET_LIMIT` | `5` | Reset links that can be requested per (IP + email) within the window |
| `PASSWORD_RESET_WINDOW_MINUTES` | `60` | Window for counting reset requests (also the window of the 60-requests-per-IP limit on the reset endpoints) |

Rate-limit counters live in the app's memory (one instance), like before — restarting the app resets them

### Booking rules

| Variable | Default | Meaning |
|---|---|---|
| `SEAT_HOLD_MINUTES` | `10` | How long seats are held while awaiting payment (also the hold for a pricier seat change) |
| `REJECTED_RETRY_MINUTES` | `10` | The new payment window after a slip is rejected |
| `CANCEL_CUTOFF_HOURS` | `3` | Customers can cancel while at least this much time remains before the showtime |
| `MAX_SEATS_PER_BOOKING` | `8` | Maximum seats per booking |
| `MAX_PENDING_BOOKINGS_PER_USER` | `3` | Unfinished bookings (awaiting payment + awaiting slip review) one account can hold at once |
| `SEAT_CHANGE_CUTOFF_MINUTES` | `30` | Customers can change seats themselves until this many minutes before the showtime |
| `MAX_SEAT_CHANGES_PER_BOOKING` | `1` | Seat changes a customer can make per booking (expired/cancelled requests and admin moves don't count) |

> The web app shows two of these as constants: `MAX_SEATS` and `HOLD_MINUTES` in `client/src/pages/SeatSelectionPage.jsx`, and `HOLD_MINUTES` in `client/src/pages/ChangeSeatsPage.jsx`. They only affect what the page displays — the server enforces the real limits — but update them together with the server values

### Payments and receipts

| Variable | Default | Meaning |
|---|---|---|
| `PROMPTPAY_ID` | `0812345678` | Destination PromptPay number (phone or national ID) the QR codes pay to — **must be changed before going live**; money scanned from the QR really goes to this number. In Production the server warns at startup while it's still the sample number (a warning, not an error, so demo sites can keep a fake number on purpose) |
| `PROMPTPAY_MERCHANT_NAME` | `THEATRE RESERVATION` | Merchant name returned with the payment details |
| `RECEIPT_ISSUER_NAME` | `Sphere Cineplex` | Receipt issuer name, on the receipt page and in the receipt email |
| `RECEIPT_ISSUER_ADDRESS` | _(empty)_ | Receipt issuer address — empty = no address line |

### Email

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST` | _(empty)_ | Outgoing mail server — **empty = nothing is really sent**. In Development each email, links included, is printed to the server console instead; in Production only a one-line notice with a masked recipient is logged (never the message — a reset link in the logs would hand over the account), plus a warning at startup |
| `SMTP_PORT` | `587` | SMTP port (use `465` together with `SMTP_SECURE=true`) |
| `SMTP_SECURE` | inferred from the port | `true` = TLS from the start of the connection; `false` = STARTTLS when the server offers it. If unset, `true` only for port 465 |
| `SMTP_USER` / `SMTP_PASS` | _(empty)_ | SMTP credentials (can stay empty if the server needs no login) |
| `MAIL_FROM` | `Theatre Reservation <no-reply@localhost>` | Sender shown in emails (`.env.example` sets `CineBook <no-reply@example.com>`) |

Emails are queued in memory and sent in the background after the request finishes, so an admin approving slips never waits for SMTP. Azure blocks outbound port 25 only — Gmail (App Password) on 587 works, see [DEPLOY.md](../DEPLOY.md)

### Slip storage

| Variable | Default | Meaning |
|---|---|---|
| `UPLOAD_DIR` | `uploads` | Root folder for slips stored on disk (relative to `server/`); slips go to `slips/payments/` and `slips/refunds/` under it |
| `MAX_SLIP_SIZE_MB` | `5` | Maximum slip file size |
| `AZURE_STORAGE_CONNECTION_STRING` | _(empty)_ | Connection string of an Azure Storage account — **empty = slips are stored on disk**; when set, they're stored as blobs (see [Slip storage](architecture.md#slip-storage)). It grants full access to the account: set it only in the app's own settings |
| `AZURE_SLIP_CONTAINER` | `slips` | Container that stores slips (private), with `payments/` and `refunds/` prefixes |

## Database migrations

The schema is defined by the entities in `Models/Entities/` and `Data/AppDbContext.cs`, and changed through EF Core migrations in `Data/Migrations/`. Table, column, enum, index and constraint names are the ones the earlier Prisma schema used, so data and SQL written for the old version still fit

```bash
cd server
dotnet tool restore                                                          # dotnet-ef, pinned in dotnet-tools.json
dotnet ef migrations add <Name> --project src/CineBook.Web --output-dir Data/Migrations
dotnet ef database update --project src/CineBook.Web                       # uses DATABASE_URL from server/.env
```

- On Azure, `DB_MIGRATE_ON_START=true` applies pending migrations each time the app starts (it skips the ones already applied)
- **A database created by the earlier Express/Prisma version** already has the full schema of `InitialCreate`. Keep its data and mark that migration as applied with `psql "<DATABASE_URL>" -f server/tools/adopt-prisma-database.sql` (it checks the database is at Prisma's last migration first). `server/tools/schema-fingerprint.sql` prints an order-independent description of a schema, to compare two databases with `diff`

## Seed

`dotnet run --project src/CineBook.Web -- seed` (from `server/`; `Seed/`) **wipes every table**, then creates:

- 2 admins (`admin@cinebook.test`, `staff@cinebook.test`) and 16 customers, including the demo customer `somchai@example.test`
- 14 movies (now showing, coming soon, archived) and 6 theatres, one of them inactive and some with broken seats
- Showtimes from 10 days ago to 7 days ahead, with two cancelled showtimes
- About 500 bookings covering every booking, payment, refund and seat-change state, with their notifications and receipts
- A sample slip image for every slip, written through the same slip storage as the API: disk, or Azure Blob when `AZURE_STORAGE_CONNECTION_STRING` is set

Everything is dated relative to the day it runs. Finished history is written straight to the database (`SeedSales.cs`); the states still in progress go through the real services (`SeedScenarios.cs`). The random choices use a fixed seed, so every run produces the same data (only times, booking codes and payment references differ). With pending migrations it stops unless `DB_MIGRATE_ON_START=true`

| Variable | Default | Meaning |
|---|---|---|
| `SEED_PASSWORD` | `Password123` | Password of every seeded account. **Always set it when seeding a site outsiders can reach** — the default is published in the README |

## Test environment

Integration tests read **only** `server/.env.test` (copy it from `server/.env.test.example`) — never `server/.env`, so the results don't depend on anyone's local settings

- `DATABASE_URL` must point at a database whose name ends in `_test` (the example uses `cinebook_test`); the test helpers refuse to run otherwise, because every test wipes every table. The first run creates and migrates it
- `SMTP_HOST` and `AZURE_STORAGE_CONNECTION_STRING` must be empty, so tests never send real email or write to real storage
- `RUN_JOBS=false`, `UPLOAD_DIR=uploads-test` (keeps test slips out of `uploads/`), `BCRYPT_ROUNDS=8` (fast hashing)
- `PROXY_SECRET` stays empty; tests that need the direct-access check start their own app with a secret (`ConfiguredApiFactory`)

See [Testing](testing.md)

## Web app

The web app's code (`client/`) reads no environment variables, and the API base path is fixed to `/api` in `client/src/api/client.js`

- In development, `client/vite.config.js` proxies `/api` to `http://localhost:4000`, so the refresh cookie is same-origin
- In production, `dotnet publish` builds `client/` and puts `client/dist` into the app's `wwwroot` (`PublishClient` target in `CineBook.Web.csproj`; skip it with `-p:SkipClientBuild=true`). The same app then:
  - serves `wwwroot/index.html` for every path that isn't `/api/*` or a file, so deep links and page refreshes work (`HomeController`)
  - sends security headers with every page (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) and `helmet`'s default set with `/api/*` (`SecurityHeadersMiddleware`). The CSP allows scripts and styles only from the site itself (plus Google Fonts), images from any `https:` URL (movie posters are external links), `data:` and `blob:` (QR codes and slip images)
  - caches `/assets/*` for a year (`immutable`) — Vite fingerprints those file names — and serves `index.html` with `no-cache`
- Without a build (development), `/` shows a short page pointing to the Vite dev server

## Production

App Service settings for the full walkthrough are in [DEPLOY.md](../DEPLOY.md). Before going live, at minimum:

- [ ] `PROMPTPAY_ID` is your own PromptPay number
- [ ] New random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- [ ] `SMTP_*` configured, so password reset links and receipts are really emailed
- [ ] `ASPNETCORE_ENVIRONMENT` unset or `Production`, and the site served over HTTPS only (the refresh cookie is `Secure`)
- [ ] `TRUST_PROXY` matches the proxies in front of the app (`proxyHops` of `/api/health`), and `ASPNETCORE_FORWARDEDHEADERS_ENABLED=false`
- [ ] `AZURE_STORAGE_CONNECTION_STRING` set — App Service replaces the app's disk on every deploy
- [ ] `DB_MIGRATE_ON_START=true` (or migrations applied another way)
- [ ] The demo accounts were seeded with your own `SEED_PASSWORD`, not the published `Password123`
