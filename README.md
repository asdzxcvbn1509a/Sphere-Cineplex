# 🎬 Theatre Reservation System (Sphere-Cineplex)

A full-stack movie theatre seat booking system — users pick a movie, date, showtime and seats, pay with a PromptPay QR, then get an E-Ticket along with a receipt (E-Receipt), and can change seats afterwards. Admins manage theatres and showtimes, review payment slips and view sales reports

UX/UI designed from a survey of 30 real users (details in [chat_history.md](chat_history.md))

> **Payments** — the QR follows PromptPay's real EMVCo standard; the destination is the PromptPay number set in `PROMPTPAY_ID` in `server/.env`
> The system isn't connected to a bank to detect incoming transfers automatically, so payments are confirmed by an admin reviewing the slip the customer uploads
>
> ⚠️ **Before going live** you must change `PROMPTPAY_ID` to a real account number, generate new `JWT_*_SECRET`s, configure `SMTP_*` so email really gets sent (otherwise people who forget their password won't get the link, and customers won't get receipts by email), set `NODE_ENV=production`, set `TRUST_PROXY` to match the proxies in front of the API (otherwise rate limits count the wrong IPs), and serve over HTTPS (only then is the refresh cookie sent as `Secure`) — see [Configuration](docs/configuration.md#production)

---

## Features

**Customers**
- Browse movies and showtimes by day; pick seats on a live seat map — logging in is only needed when confirming
- Pay by PromptPay QR and upload the transfer slip; seats are held while the slip is reviewed, and a slip sent shortly after the deadline is still accepted
- E-Ticket with an entry QR, and an E-Receipt (print / save as PDF, also emailed)
- Cancel up to 3 hours before the showtime with a refund to a bank account, and see the admin's refund slip
- Change seats after paying — moving to pricier seats means paying the difference, cheaper seats get it back
- In-app notifications; the whole UI switches between Thai and English

**Admins**
- Slip review queue (late slips included) and a refund queue with proof-of-transfer slips, with pending-work badges on the menu
- Search all bookings by booking code, receipt number, phone or name; cancel or move seats for a customer
- Cancel a whole showtime in one action — every customer is notified and paid bookings are queued for refunds
- Manage movies, theatres (seat zone editor) and showtimes (free time-slot finder), and user accounts (temporary passwords, roles)
- Sales and occupancy reports with CSV export

**Under the hood** — double booking is prevented by a database unique constraint, every status change is a compare-and-set update taken in one global lock order, refresh tokens rotate with reuse detection, and concurrency cases are covered by integration tests against real PostgreSQL. See [Architecture and design notes](docs/architecture.md)

---

## Tech stack

| Part | Technology |
|---|---|
| Frontend | Vite 7 · React 19 (JavaScript) · React Router 7 · TailwindCSS 4 |
| Backend | Node.js · Express 5 (ESM) |
| Database | PostgreSQL · Prisma ORM 6 |
| Auth | Sign up / log in with email or phone + password (bcrypt) · 15-minute JWT access token + 7-day rotating refresh token · Forgot password via an emailed link |
| Email | nodemailer over SMTP — when not configured, email content is printed to the console instead (development only; production never logs message content) |
| Payment | PromptPay QR (EMVCo payload) + slip upload for admin review |
| Language | Thai / English, switchable across the whole system |

---

## Requirements

- Node.js 20 or later (developed and tested on Node 24)
- PostgreSQL 14 or later, installed locally (tested on PostgreSQL 18)

---

## Install and run

> `client/` and `server/` are separate, independent projects, each with its own `package.json` and `node_modules`. There's no workspace at the root
>
> This section covers running on your own machine. For going live (Vercel + Render + Supabase), see [DEPLOY.md](DEPLOY.md)

### 1. Install dependencies (in both folders)

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Prepare the database

Create an empty database in PostgreSQL (one time only)

```bash
# Windows PowerShell — adjust the path to your installed PostgreSQL version
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE theatre_reservation_v2"
```

### 3. Configure the environment

```bash
cp server/.env.example server/.env     # Windows: copy server\.env.example server\.env
```

Edit `server/.env`:

- `DATABASE_URL` — replace `<PASSWORD>` with the password of the `postgres` user
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — generate new values with

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- `SMTP_*` — can be skipped during development: while it's unset, the system prints emails (including password reset links) to the server console instead
  But it **must be set before going live**, otherwise people who forget their password won't get the link
- `SUPABASE_*` — can be skipped during development: while it's unset, slips are stored on disk in `server/uploads/`
  But it **must be set before deploying to a host without a persistent disk**, such as Render (see [Slip storage](docs/architecture.md#slip-storage))

Every variable and its default is listed in [Configuration](docs/configuration.md)

### 4. Create the tables and load sample data

```bash
cd server
npm run db:migrate      # create tables from prisma/schema.prisma
npm run db:seed         # 6 movies, 3 theatres, showtimes for the next 7 days
```

### 5. Run the system

Open **two terminals** and run each side separately

```bash
# Terminal 1 — API on port 4000
cd server
npm start
```

```bash
# Terminal 2 — web app on port 5173
cd client
npm start
```

Both folders accept either `npm start` or `npm run dev` with the same result (both reload automatically when you edit code)

Open <http://localhost:5173>

### Demo accounts

| Role | Email | Phone | Password | Notes |
|---|---|---|---|---|
| Admin | `admin@cinebook.test` | `0800000000` | `Password123` | Can access `/admin` |
| Regular user | `somchai@example.test` | `0891234567` | `Password123` | Has sample booking history |
| New user | — | — | — | Sign up yourself at `/register` |

The first field on the login page accepts either an **email or a phone number**; the system looks for an `@` to decide which one to search by
so users don't have to remember which one they signed up with. Phone numbers are always normalized to 10 digits (`089-123-4567` = `0891234567`)

In development mode the login page has shortcut buttons that fill in the two sample accounts above (not shown in production builds)

You can set `SEED_PASSWORD` when running the seed to use a password other than `Password123` — **you must set it every time you seed a site outsiders can reach**, because anyone can read the password in this table (see [DEPLOY.md](DEPLOY.md))

---

## Common commands

| In `server/` | What it does |
|---|---|
| `npm start` (or `npm run dev`) | Run the API with auto-restart on file changes |
| `npm run start:prod` | Run the API without watching files (for production) |
| `npm run db:migrate` | Create/update tables from the schema |
| `npm run db:seed` | Wipe the data and load fresh sample data |
| `npm run db:studio` | Open Prisma Studio to browse the database |
| `npm run db:reset` | Drop every table, then migrate + seed again |
| `npm test` | Run unit tests (no database needed) |
| `npm run test:int` | Run integration tests against a separate test database (see [Testing](docs/testing.md)) |

| In `client/` | What it does |
|---|---|
| `npm start` (or `npm run dev`) | Run the web app on port 5173 |
| `npm run build` | Build into `client/dist` |
| `npm run preview` | Preview the built output |

---

## Project structure

```
├─ server/                        Independent project with its own package.json
│  ├─ prisma/schema.prisma        The whole database structure
│  ├─ prisma/seed.js              Sample data
│  ├─ uploads/slips/payments/     Slips from customers' payments (not in git · used when Supabase isn't configured)
│  ├─ uploads/slips/refunds/      Slips of refunds admins sent to customers (not in git · used when Supabase isn't configured)
│  ├─ src/
│  │  ├─ app.js  index.js         Assembles the Express app and starts the server
│  │  ├─ config/env.js            Reads and validates .env with zod
│  │  ├─ lib/                     prisma client, slip storage (disk or Supabase Storage)
│  │  ├─ middleware/              auth, role check, validate, upload (+ file content check), error handler
│  │  ├─ utils/                   jwt, password, phone, promptpay, pricing, seats, seatChange, bookingAccess, datetime, mailer, pagination, receipt, bahtText (+ unit tests)
│  │  ├─ emails/                  Outgoing email content (password reset, receipt), kept separate from the sender
│  │  ├─ jobs/                    Release expired seats, reminder 1 hour before the showtime
│  │  ├─ routes/                  Map URLs to controllers (file names match controllers/)
│  │  ├─ controllers/             Take req/res and call services — never touch prisma
│  │  └─ services/                Business logic + database queries (the only place that uses prisma)
│  │                              shared by several services: locks.js (lock order, row locks) · slips.js (slip submission) · seatChangeRules.js
│  └─ test/                       Integration tests (run against a separate test database via .env.test)
│     ├─ helpers/                 Wipe the database + create test data (refuses to run unless it's a *_test database)
│     └─ integration/             Booking races, expiry vs slip upload, showtime cancellation, seat changes, refunds, multi-tab refresh, real HTTP, etc.
├─ client/                        Independent project with its own package.json
│  └─ src/
│     ├─ api/                     One file per endpoint group + client.js (auto refresh token)
│     ├─ store/                   zustand — authStore, notificationStore, adminQueueStore
│     ├─ context/                 i18n (Thai/English), Toast
│     ├─ hooks/                   useApi / usePagedApi (loading + error state), useCountdown, usePolling, useSeatSelection
│     ├─ components/              ui kit (incl. ConfirmModal, Chip), layout, seat map, movie cards, payment, booking, admin
│     ├─ pages/                   User-facing pages (including receipt, profile, forgot password and reset password)
│     └─ pages/admin/             Admin pages (including user management)
└─ docs/                          Architecture, API reference, state machines, configuration, testing
   └─ mvc-slides/                 Generator for MVC-Architecture-API.pptx
```

---

## Documentation

| Document | What's in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers and shared modules, background jobs, the main flow and every design decision (concurrency, holds, late slips, sessions, refunds, receipts, seat changes…) |
| [docs/api.md](docs/api.md) | All 68 endpoints with request bodies, responses and errors, shared objects, rate limits and the full error-code table |
| [docs/state-machines.md](docs/state-machines.md) | Status diagrams for bookings, payments, seat changes and showtimes, with what triggers each transition |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, the seed script, the test environment and the go-live checklist |
| [docs/testing.md](docs/testing.md) | Unit and integration tests, checking the web app in a browser, and the manual test checklist |
| [DEPLOY.md](DEPLOY.md) | Going live on Vercel + Render + Supabase |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Code conventions and checklists for common changes |
| [chat_history.md](chat_history.md) | The user survey behind the UX decisions |
| [docs/mvc-slides/README.md](docs/mvc-slides/README.md) | How the MVC architecture slides are generated |

Ready-to-use API call examples are in [server/api.http](server/api.http) — open it in VS Code with the **REST Client** extension and click Send Request from top to bottom
