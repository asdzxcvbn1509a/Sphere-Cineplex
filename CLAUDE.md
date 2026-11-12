# CLAUDE.md

Guidance for AI coding agents working in this repository. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md)

## Project

CineBook — movie theatre seat booking for a Thai audience: React SPA (`client/`) + ASP.NET Core 10 MVC app (`server/`) + PostgreSQL via EF Core (Npgsql). Payments are PromptPay transfers confirmed by an admin reviewing the uploaded slip. In production one App Service serves both `/api/*` and the React build from `wwwroot`. `client/` is an npm project and `server/` a .NET solution (`CineBook.slnx`); there is no root workspace

## Commands

| Where | Command | Notes |
|---|---|---|
| `server/` | `dotnet watch --project src/CineBook.Web` | API on :4000 (Development, `launchSettings.json`); `dotnet run --project src/CineBook.Web` without reload |
| `server/` | `dotnet test --filter Category=Unit` | Unit tests; no database |
| `server/` | `dotnet test --filter Category=Integration` | Integration tests against real PostgreSQL; needs `server/.env.test` with a `*_test` database, **wipes it** |
| `server/` | `dotnet tool restore` then `dotnet ef migrations add <Name> --project src/CineBook.Web --output-dir Data/Migrations` / `dotnet ef database update --project src/CineBook.Web` | Migrations (`dotnet-ef` is a local tool) |
| `server/` | `dotnet run --project src/CineBook.Web -- seed` | Reseed sample data (wipes all data) |
| `server/` | `dotnet publish src/CineBook.Web -c Release -o <dir>` | Builds `client/` too and puts `client/dist` in `wwwroot` (`-p:SkipClientBuild=true` to skip) |
| `client/` | `npm start` / `npm run build` | Vite on :5173 (proxies `/api` → :4000) / production build |

## Architecture

- Server (`server/src/CineBook.Web/`): `Controllers/Api/*` (attribute routes; request DTOs in `Models/Requests` validated by FluentValidation through the global `ValidationFilter`; read the request and call one service, never `AppDbContext`) → `Services/*` (rules + EF Core). `Utils/` pure helpers, `Data/` `AppDbContext` + migrations + raw SQL (`Sql.cs`), `Infrastructure/` config, errors, auth, rate limiting, uploads, slip storage, email, security headers, `Jobs/` background jobs, `Seed/` sample data, `Controllers/HomeController` serves `wwwroot/index.html` for every non-`/api` path
- Shared server pieces: `Services/Locks.cs` (lock order, row locks, 409 errors), `Services/SlipService.cs` (slip window and submission for bookings and seat changes), `Services/SeatChangeRules.cs`, `Utils/BookingAccess.cs`, `Utils/Pagination.cs` (`FindPageAsync`)
- Client: `api/` modules, `hooks/useApi.js` (`useApi`, `usePagedApi`), `ConfirmModal`, i18n via `t()` and `pick()`
- Reference: [architecture](docs/architecture.md) · [API](docs/api.md) · [state machines](docs/state-machines.md) · [configuration](docs/configuration.md) · [testing](docs/testing.md) · [design system](docs/design-system.md)

## Invariants — don't break these

- No double booking: `BookingSeat` has a unique index on (`showtimeId`, `seatId`) named `BookingSeat_showtimeId_seatId_key`; seats are released by deleting `BookingSeat` rows
- Every status change is compare-and-set (`ExecuteUpdateAsync` with the expected status in `Where`, check the row count, throw 409). `ExecuteUpdateAsync` doesn't run the timestamp interceptor — set `UpdatedAt` yourself
- Lock order everywhere: `Showtime` (FOR SHARE) → `Booking` → `SeatChange` → `BookingSeat` → `Payment` → `ReceiptCounter`; seat rows written sorted by id (`Sql.InsertBookingSeatsAsync`, not `SaveChanges`, which reorders inserts)
- Receipt numbers come from `ReceiptCounter` inside the approval transaction; emails are queued after commit
- Money is integer baht; times are stored in UTC (`timestamp(3)` without time zone) and shown in Asia/Bangkok
- API errors are `ApiException` with a stable `code`; messages are Thai and shown as-is by the web app. Keep codes, messages and response shapes backward compatible (JSON is camelCase, enums as strings, dates `yyyy-MM-ddTHH:mm:ss.fffZ`)
- Database names stay as Prisma created them (PascalCase tables, camelCase columns, Prisma index/constraint names) so existing databases keep working
- Seat-change pricing lives in `server/src/CineBook.Web/Utils/SeatChangePlanner.cs` and is mirrored in `client/src/utils/seatChange.js`
- Every UI string key exists in both `client/src/i18n/th.json` and `en.json`

## Gotchas

- `server/.env` is loaded at startup (values already in the environment win); invalid configuration prints the problems and exits; empty values count as unset. Tests load only `server/.env.test` (`CINEBOOK_SKIP_DOTENV=true`)
- Integration tests refuse databases not ending in `_test`, a configured `SMTP_HOST` and `AZURE_STORAGE_CONNECTION_STRING`. Don't run the API on the `_test` database while they run — its background jobs touch the same rows (tests set `RUN_JOBS=false`)
- `SlipUploadReader` stores the slip before the service runs; services must delete it on failure (`SlipService.DiscardSlipOnErrorAsync`). MVC's form value providers are removed globally so the multipart body is read only there, after the rate limit
- Rate limits are MVC filters (`[RateLimit("policy")]`, order −1000) and run before `ValidationFilter` (order 100), like the old middleware order
- An empty or non-JSON body binds as `{}` and is validated normally (the old `req.body ?? {}`), not a 415
- The access token lives in memory only; the refresh cookie `trs_refresh` (path `/api/auth`, `SameSite=lax`, `Secure` in Production) requires the browser to call `/api` on the web app's own origin
- With `PROXY_SECRET` set, every route except `/api/health` needs the `x-proxy-secret` header — keep it empty unless a proxy in front adds it
- `CineBook.Web.csproj` turns off Server GC and concurrent GC to keep memory low on App Service Free F1, where going over 1 GB stops the whole site (403) until the next hour. Keep them off; the startup line `เครื่อง:` shows the GC mode and memory in use
- `client/src/pages/SeatSelectionPage.jsx` and `ChangeSeatsPage.jsx` hard-code `MAX_SEATS` / `HOLD_MINUTES` to match the server's defaults
- The fit-to-screen admin lists (bookings, showtimes, movies, theatres, users; `components/admin/fitLayout.js` + `hooks/useFitPageSize.js`) compute rows per page from a `ROW_HEIGHT` constant in each page. Keep it equal to the rows' `xl:h-*` class, and keep every `xl` cell to a fixed number of lines (`xl:truncate`, `line-clamp`), or rows overflow the box
- `docs/` is gitignored except its top-level `*.md` files
- The seed (`Seed/`) writes finished history straight to the database in `SeedSales.cs` and drives open states through the real services in `SeedScenarios.cs`. A schema change or a changed state transition must be mirrored in `SeedSales.cs`; never call `PaymentService.ApproveAsync`/`SeatChangeService.ApproveTopUpAsync` from the seed (they email receipts). `SeedRandom` reproduces the old JS seed's random sequence — keep the order of random calls
- A database created by the old Prisma migrations is adopted with `server/tools/adopt-prisma-database.sql` (one `__EFMigrationsHistory` row); check it first with `tools/schema-fingerprint.sql`

## Conventions

- Code comments are in Thai and explain why; Markdown docs are in English
- C#: 4 spaces, file-scoped namespaces, primary constructors for services/controllers, `sealed` classes, records for responses (`server/.editorconfig`). JavaScript (client): ESM, 2 spaces, single quotes, semicolons, trailing commas, arrow functions. LF line endings
- UI styling uses only the design-system tokens in `client/src/index.css`: semantic colors (`page`, `surface`, `accent`, `selected`, `field`, status `*-bg` …), the `cocoa|blue|gold|cream-10…100` palette, and the type scale `text-h1|h2|body-1|body-2|caption`. Tailwind's default colors and sizes are disabled and silently produce no CSS. Modals and ticket/receipt re-theme via `.theme-blue` / `.theme-paper`
- New endpoint: controller action + request DTO/validator + service + `client/src/api` function + [docs/api.md](docs/api.md) + `server/api.http` + integration test
- Changed state transition: update [docs/state-machines.md](docs/state-machines.md) and add a concurrency test
