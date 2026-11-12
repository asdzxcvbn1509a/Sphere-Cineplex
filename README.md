# 🎬 Theatre Reservation System (Sphere-Cineplex)

A full-stack movie theatre seat booking system — users pick a movie, date, showtime and seats, pay with a PromptPay QR, then get an E-Ticket along with a receipt (E-Receipt), and can change seats afterwards. Admins manage theatres and showtimes, review payment slips and view sales reports

UX/UI designed from a survey of 30 real users (details in [chat_history.md](chat_history.md))

> **Payments** — the QR follows PromptPay's real EMVCo standard; the destination is the PromptPay number set in `PROMPTPAY_ID` in `server/.env`
> The system isn't connected to a bank to detect incoming transfers automatically, so payments are confirmed by an admin reviewing the slip the customer uploads
>
> ⚠️ **Before going live** you must change `PROMPTPAY_ID` to a real account number, generate new `JWT_*_SECRET`s, configure `SMTP_*` so email really gets sent (otherwise people who forget their password won't get the link, and customers won't get receipts by email), run with `ASPNETCORE_ENVIRONMENT=Production` (the default when it isn't set), store slips in Azure Blob Storage, set `TRUST_PROXY` to match the proxies in front of the app (otherwise rate limits count the wrong IPs), and serve over HTTPS (the refresh cookie is `Secure` in Production) — see [Configuration](docs/configuration.md#production)

---

## Features

**Customers**
- Browse movies and showtimes by day; pick seats on a live seat map — logging in is only needed when confirming
- Pay by PromptPay QR and upload the transfer slip; seats are held while the slip is reviewed, and a slip sent shortly after the deadline is still accepted
- E-Ticket with an entry QR, one per seat, saveable as a PNG image, and an E-Receipt (print / save as PDF, also emailed)
- Cancel up to 3 hours before the showtime with a refund to a bank account, and see the admin's refund slip
- Change seats after paying — moving to pricier seats means paying the difference, cheaper seats get it back
- In-app notifications; the whole UI switches between Thai and English
- A Contact us page, opened from the headset icon in the header, that links to the cinema's social channels

**Admins**
- Slip review queue and a refund queue with proof-of-transfer slips, with pending-work badges on the menu
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
| Backend | ASP.NET Core 10 Web App (MVC) · C# — one app serves the API (`/api/*`) and the built React app |
| Database | PostgreSQL · Entity Framework Core 10 (Npgsql) |
| Auth | Sign up / log in with email or phone + password (bcrypt) · 15-minute JWT access token + 7-day rotating refresh token · Forgot password via an emailed link |
| Email | MailKit over SMTP — when not configured, email content is printed to the console instead (development only; production never logs message content) |
| Hosting | Azure App Service (Linux) + Azure Database for PostgreSQL + Azure Blob Storage for slips — see [DEPLOY.md](DEPLOY.md) |
| Payment | PromptPay QR (EMVCo payload) + slip upload for admin review |
| Language | Thai / English, switchable across the whole system |

---

## Requirements

- .NET SDK 10 (for the server)
- Node.js 20 or later (for the web app; developed on Node 24)
- PostgreSQL 14 or later, installed locally (tested on PostgreSQL 18)

---

## Install and run

> `client/` (an npm project) and `server/` (a .NET solution, `CineBook.slnx`) are separate. There's no workspace at the root
>
> This section covers running on your own machine. For going live on Azure, see [DEPLOY.md](DEPLOY.md)

### 1. Install dependencies

```bash
cd server && dotnet restore && dotnet tool restore   # dotnet-ef is a local tool (server/dotnet-tools.json)
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

  ```powershell
  [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))   # or: openssl rand -hex 32
  ```

- `SMTP_*` — can be skipped during development: while it's unset, the system prints emails (including password reset links) to the server console instead
  But it **must be set before going live**, otherwise people who forget their password won't get the link
- `AZURE_STORAGE_CONNECTION_STRING` — can be skipped during development: while it's unset, slips are stored on disk in `server/uploads/`
  But it **must be set before deploying to App Service**, whose disk is replaced on every deploy (see [Slip storage](docs/architecture.md#slip-storage))

Every variable and its default is listed in [Configuration](docs/configuration.md)

### 4. Create the tables and load sample data

```bash
cd server
dotnet ef database update --project src/CineBook.Web     # create the tables (EF Core migrations in Data/Migrations)
dotnet run --project src/CineBook.Web -- seed            # 14 movies, 6 theatres, ~500 bookings in every state, showtimes from 10 days ago to 7 days ahead
```

> A database created by the earlier Express/Prisma version already has the same tables — keep its data and run `psql "<DATABASE_URL>" -f tools/adopt-prisma-database.sql` once instead of `database update` (see [Configuration](docs/configuration.md#database-migrations))

### 5. Run the system

Open **two terminals** and run each side separately

```bash
# Terminal 1 — API on port 4000 (reloads when you edit C# code)
cd server
dotnet watch --project src/CineBook.Web
```

```bash
# Terminal 2 — web app on port 5173
cd client
npm start
```

`client/` accepts either `npm start` or `npm run dev`. `dotnet run --project src/CineBook.Web` runs the API without reloading

Open <http://localhost:5173>

### Demo accounts

| Role | Email | Phone | Password | Notes |
|---|---|---|---|---|
| Admin | `admin@cinebook.test` | `0800000000` | `Password123` | Can access `/admin` |
| Admin | `staff@cinebook.test` | `0800000001` | `Password123` | A second admin, so the queues show who checked or refunded what |
| Regular user | `somchai@example.test` | `0891234567` | `Password123` | Has bookings in every tab: a rejected slip to pay again, a slip under review, a seat-change difference to pay, refunds, past tickets |
| Other customers | `*@example.test` | — | `Password123` | 15 more accounts, listed in `server/src/CineBook.Web/Seed/SeedCatalog.cs` |
| New user | — | — | — | Sign up yourself at `/register` |

The first field on the login page accepts either an **email or a phone number**; the system looks for an `@` to decide which one to search by
so users don't have to remember which one they signed up with. Phone numbers are always normalized to 10 digits (`089-123-4567` = `0891234567`)

The sample data is dated relative to the day you run the seed, so run it again when the showtimes run out. Unpaid bookings and seat changes it leaves open
expire 10 minutes after the API starts, exactly as real ones would. Slips waiting for review stay in the queue until an admin checks them

You can set `SEED_PASSWORD` when running the seed to use a password other than `Password123` — **you must set it every time you seed a site outsiders can reach**, because anyone can read the password in this table (see [DEPLOY.md](DEPLOY.md))

---

## Common commands

| In `server/` | What it does |
|---|---|
| `dotnet watch --project src/CineBook.Web` | Run the API on :4000 and reload on code changes |
| `dotnet run --project src/CineBook.Web` | Run the API without watching files |
| `dotnet ef database update --project src/CineBook.Web` | Create/update tables from the migrations |
| `dotnet ef migrations add <Name> --project src/CineBook.Web --output-dir Data/Migrations` | Add a migration after changing the model |
| `dotnet run --project src/CineBook.Web -- seed` | Wipe the data and load fresh sample data |
| `dotnet test --filter Category=Unit` | Run unit tests (no database needed) |
| `dotnet test --filter Category=Integration` | Run integration tests against a separate test database (see [Testing](docs/testing.md)) |
| `dotnet publish src/CineBook.Web -c Release -o publish` | Build the whole app (API + React build in `wwwroot`) for deployment |

| In `client/` | What it does |
|---|---|
| `npm start` (or `npm run dev`) | Run the web app on port 5173 |
| `npm run build` | Build into `client/dist` |
| `npm run preview` | Preview the built output |

---

## Project structure

```
├─ server/                        .NET solution (CineBook.slnx)
│  ├─ uploads/slips/payments/     Slips from customers' payments (not in git · used when Azure Blob isn't configured)
│  ├─ uploads/slips/refunds/      Slips of refunds admins sent to customers (not in git · used when Azure Blob isn't configured)
│  ├─ tools/                      Schema fingerprint and the SQL that adopts a database made by the old Prisma migrations
│  ├─ src/CineBook.Web/           ASP.NET Core MVC app
│  │  ├─ Program.cs               Loads .env and builds the app; `-- seed` runs the seed instead of the server
│  │  ├─ Controllers/Api/         API controllers — read the request and call one service, never the database
│  │  ├─ Controllers/HomeController.cs  Serves the React build (wwwroot/index.html) for every non-/api path
│  │  ├─ Models/                  Entities (EF), request DTOs + validators, response records
│  │  ├─ Services/                Business logic + database queries (the only place that uses AppDbContext)
│  │  │                           shared by several services: Locks (lock order, row locks) · SlipService (slip submission) · SeatChangeRules
│  │  ├─ Data/                    AppDbContext, migrations, raw SQL for row locks and ordered seat inserts
│  │  ├─ Infrastructure/          Config, errors, auth, rate limiting, uploads, slip storage (disk or Azure Blob), email, security headers
│  │  ├─ Utils/                   Pricing, seats, seat changes, PromptPay, receipts, Thai baht text, dates, pagination
│  │  ├─ Emails/                  Outgoing email content (password reset, receipt), kept separate from the sender
│  │  ├─ Jobs/                    Release expired seats, reminder 1 hour before the showtime
│  │  └─ Seed/                    Sample data (wipes every table)
│  └─ tests/CineBook.Tests/       xUnit — Unit/ and Integration/ (against a separate *_test database via .env.test):
│                                 booking races, expiry vs slip upload, showtime cancellation, seat changes, refunds, multi-tab refresh, real HTTP, etc.
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
| [docs/architecture.md](docs/architecture.md) | Layers and shared modules, background jobs, the main flow and every design decision (concurrency, holds, the payment deadline, sessions, refunds, receipts, seat changes…) |
| [docs/api.md](docs/api.md) | All 68 endpoints with request bodies, responses and errors, shared objects, rate limits and the full error-code table |
| [docs/state-machines.md](docs/state-machines.md) | Status diagrams for bookings, payments, seat changes and showtimes, with what triggers each transition |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, the seed script, the test environment and the go-live checklist |
| [docs/testing.md](docs/testing.md) | Unit and integration tests, checking the web app in a browser, and the manual test checklist |
| [docs/design-system.md](docs/design-system.md) | Colors, fonts, the type scale and how components use them |
| [DEPLOY.md](DEPLOY.md) | Going live on Azure for Students (App Service + PostgreSQL + Blob Storage) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Code conventions and checklists for common changes |
| [chat_history.md](chat_history.md) | The user survey behind the UX decisions |
| [docs/mvc-slides/README.md](docs/mvc-slides/README.md) | How the MVC architecture slides are generated (the slides still describe the earlier Express version) |

Ready-to-use API call examples are in [server/api.http](server/api.http) — open it in VS Code with the **REST Client** extension and click Send Request from top to bottom
