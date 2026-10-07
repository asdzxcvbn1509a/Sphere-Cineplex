# CLAUDE.md

Guidance for AI coding agents working in this repository. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md)

## Project

CineBook — movie theatre seat booking for a Thai audience: React SPA (`client/`) + Express 5 API (`server/`) + PostgreSQL via Prisma. Payments are PromptPay transfers confirmed by an admin reviewing the uploaded slip. `client/` and `server/` are independent npm projects; there is no root workspace

## Commands

| Where | Command | Notes |
|---|---|---|
| `server/` | `npm start` | API on :4000 with `node --watch` |
| `server/` | `npm test` | Unit tests (`src/**/*.test.js`); needs `server/.env` |
| `server/` | `npm run test:int` | Integration tests against real PostgreSQL; needs `server/.env.test` with a `*_test` database, **wipes it** |
| `server/` | `npm run db:migrate` / `npm run db:seed` | Migrate / reseed (the seed wipes all data) |
| `client/` | `npm start` / `npm run build` | Vite on :5173 (proxies `/api` → :4000) / production build |

## Architecture

- Server: `routes/` (zod `validate`) → `controllers/` (req/res only, never Prisma) → `services/` (rules + Prisma). `utils/` pure helpers, `lib/` Prisma client + slip storage, `jobs/` interval jobs
- Shared server modules: `services/locks.js` (lock order, row locks, 409 errors), `services/slips.js` (slip window and submission for bookings and seat changes), `services/seatChangeRules.js`, `utils/bookingAccess.js`, `utils/pagination.js` (`findPage`)
- Client: `api/` modules, `hooks/useApi.js` (`useApi`, `usePagedApi`), `ConfirmModal`, i18n via `t()` and `pick()`
- Reference: [architecture](docs/architecture.md) · [API](docs/api.md) · [state machines](docs/state-machines.md) · [configuration](docs/configuration.md) · [testing](docs/testing.md)

## Invariants — don't break these

- No double booking: `BookingSeat` has `@@unique([showtimeId, seatId])`; seats are released by deleting `BookingSeat` rows
- Every status change is compare-and-set (`updateMany` with the expected status in `WHERE`, check `count`, throw 409)
- Lock order everywhere: `Showtime` (FOR SHARE) → `Booking` → `SeatChange` → `BookingSeat` → `Payment` → `ReceiptCounter`; seat rows written sorted by id
- Receipt numbers come from `ReceiptCounter` inside the approval transaction; emails are sent after commit
- Money is integer baht; times are stored in UTC and shown in Asia/Bangkok
- API errors are `ApiError` with a stable `code`; messages are Thai and shown as-is by the web app. Keep codes, messages and response shapes backward compatible
- Seat-change pricing lives in `server/src/utils/seatChange.js` and is mirrored in `client/src/utils/seatChange.js`
- Every UI string key exists in both `client/src/i18n/th.json` and `en.json`

## Gotchas

- `server/src/config/env.js` exits the process when the environment is invalid; empty values count as unset
- Integration tests refuse databases not ending in `_test` and a configured `SMTP_HOST`. Don't run the API on the `_test` database while they run — its background jobs touch the same rows
- Upload middleware saves the slip before the service runs; services must delete it on failure (`discardSlipOnError`)
- The access token lives in memory only; the refresh cookie `trs_refresh` (path `/api/auth`, `SameSite=lax`) requires the browser to call `/api` on the web app's own origin
- With `PROXY_SECRET` set (production), every route except `/api/health` needs the `x-proxy-secret` header that `client/vercel.json` adds — calls straight to the Render URL get 403 `DIRECT_ACCESS_FORBIDDEN`. Keep it empty locally; tests pass `createApp({ proxySecret })`
- `client/src/pages/SeatSelectionPage.jsx` and `ChangeSeatsPage.jsx` hard-code `MAX_SEATS` / `HOLD_MINUTES` to match the server's defaults
- `docs/` is gitignored except its top-level `*.md` files

## Conventions

- Code comments are in Thai and explain why; Markdown docs are in English
- Match the existing style: ESM, 2 spaces, single quotes, semicolons, trailing commas, arrow functions, LF line endings
- New endpoint: route + controller + service + `client/src/api` function + [docs/api.md](docs/api.md) + `server/api.http` + integration test
- Changed state transition: update [docs/state-machines.md](docs/state-machines.md) and add a concurrency test
