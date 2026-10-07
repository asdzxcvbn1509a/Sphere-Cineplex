# Contributing

Conventions and checklists for changing CineBook. Setting up a machine is covered in the [README](README.md#install-and-run); how the system works is in [Architecture and design notes](docs/architecture.md)

- [Before you start](#before-you-start)
- [Where code goes](#where-code-goes)
- [Changing booking, payment or seat-change state](#changing-booking-payment-or-seat-change-state)
- [Adding or changing an endpoint](#adding-or-changing-an-endpoint)
- [Database schema changes](#database-schema-changes)
- [UI text and languages](#ui-text-and-languages)
- [Code style](#code-style)
- [Before you push](#before-you-push)

---

## Before you start

- `client/` and `server/` are independent npm projects — run `npm install` in each
- The server needs `server/.env` (README step 3). Unit tests need it too, because some modules read the configuration when they load
- Integration tests need `server/.env.test` pointing at a database whose name ends in `_test` — see [Testing](docs/testing.md)

## Where code goes

**Server** — `routes/` → `controllers/` → `services/` (see [Server layers](docs/architecture.md#server-layers))

- Validate input in the route file with zod: `validate({ body: schema, query: schema })`. Parsed query values are on `req.validatedQuery`
- Controllers read the request, call one service and send the response. They never import Prisma
- Services own the rules and the database access. Throw `ApiError` (`utils/ApiError.js`) with a stable `UPPER_SNAKE_CASE` code and a Thai message for the user
- Reuse the shared modules instead of writing the same thing again:

  | Need | Use |
  |---|---|
  | Lock a showtime or booking row inside a transaction | `lockShowtime`, `lockBooking` (`services/locks.js`) |
  | 409 for a lost compare-and-set | `bookingStateChanged()`, `paymentNotPending()` (`services/locks.js`) |
  | Seat taken by someone else | `isSeatConflict(err)`, `seatTakenError()` (`services/locks.js`) |
  | Accept a slip for a booking or a seat change | `queueSlipForReview()`, `slipUploadWindow()`, `discardSlipOnError()` (`services/slips.js`) |
  | Seat-change rules / response shapes | `services/seatChangeRules.js` |
  | Not found / not the owner | `bookingNotFound()`, `notBookingOwner(message)`, `canAccessBooking()` (`utils/bookingAccess.js`) |
  | A paginated admin list | `paginationQuery` in the route, `findPage()` in the service (`utils/pagination.js`) |
  | Seat labels, deterministic id order | `seatLabels()`, `compareIds()` (`utils/seats.js`) |

**Client** — see [Client structure](docs/architecture.md#client-structure)

- Call the API through the modules in `client/src/api/`, never with a bare `fetch`
- Load page data with `useApi(fetcher, deps)` (or `usePagedApi` for paginated admin lists) instead of hand-written loading/error state
- Two-button confirmations use `ConfirmModal`; form dialogs and dialogs with several actions use `Modal`
- Show error messages with `apiError(error).message`; branch on `apiError(error).code`

## Changing booking, payment or seat-change state

These are the parts where a mistake loses money or double-books a seat. For any change to a status transition:

1. **Compare-and-set** — put the expected status in the `WHERE` (`updateMany`), check `count`, and throw a 409 when nothing was updated. Never read a status, check it in JavaScript, then overwrite it
2. **Lock order** — `Showtime` (`FOR SHARE`) → `Booking` → `SeatChange` → `BookingSeat` → `Payment` → `ReceiptCounter`. Write seat rows sorted by id
3. **Side effects after commit** — emails go out after the transaction commits (see `emailReceipt`); notifications are written inside it (`notify(…, tx)`)
4. **Files** — an uploaded slip is already in storage when the service runs; remove it if the request fails (`discardSlipOnError`) and delete a replaced slip only after the new one is saved
5. **Money and time** — integer baht; UTC in the database
6. **Test the race** — add an integration test that fires the competing operations together (`Promise.allSettled`) and checks that the final state is consistent. `server/test/integration/payments.test.js` and `seat-changes.test.js` have examples
7. **Document it** — update [State machines](docs/state-machines.md) and the matching section of [Architecture](docs/architecture.md)

## Adding or changing an endpoint

1. **Route** — path, zod schema, `authenticate` / `requireRole('ADMIN')`, upload middleware or a rate limiter if needed. Keep the `// @ENDPOINT` comments
2. **Controller** — one service call, one response envelope (`{ booking }`, `{ items… }`)
3. **Service** — rules, Prisma, `ApiError` codes
4. **Client** — a function in `client/src/api/<group>.js`
5. **Docs** — the endpoint and any new error code in [docs/api.md](docs/api.md), and an example in `server/api.http`
6. **Tests** — integration tests for permissions, error codes and state changes; `http.test.js` covers real-HTTP behaviour (headers, uploads, status codes)

## Database schema changes

- Change `server/prisma/schema.prisma`, run `npm run db:migrate` locally and **commit the migration folder** — production only runs `prisma migrate deploy` ([DEPLOY.md](DEPLOY.md#11-future-updates))
- Never change the production schema by hand (e.g. in Supabase's Table Editor)
- Update `prisma/seed.js` and the test fixtures if the new columns need data

## UI text and languages

- Every string in the UI goes through `t('section.key')`; add the key to **both** `client/src/i18n/th.json` and `client/src/i18n/en.json`
- Database fields that come in two languages (`titleTh` / `titleEn`) are shown with `pick(movie, 'title')`
- Server error messages are Thai and are displayed as-is — keep the `code` stable when you reword a message
- The layout is mobile-first (usable from 360px): check new screens at phone width and on desktop

## Code style

There is no linter or formatter configured; match the surrounding code:

- ESM (`import` / `export`), 2-space indentation, single quotes, semicolons, trailing commas, arrow functions, lines of about 100 characters
- Comments explain *why* something is done, in Thai like the rest of the code; Markdown docs are written in English
- Naming: services export verbs (`createBooking`, `listRefunds`), response shapers are `shapeX`, error factories describe the error (`bookingNotFound()`)
- Seat-change pricing exists twice — `server/src/utils/seatChange.js` (authoritative) and `client/src/utils/seatChange.js` (preview). Change both, with unit tests
- Files use LF line endings

## Before you push

```bash
cd server && npm test && npm run test:int
cd ../client && npm run build
```

For UI changes, also click through the affected pages against the `_test` database ([Checking the web app in a browser](docs/testing.md#checking-the-web-app-in-a-browser)). Keep commits focused, with a subject that says what changed
