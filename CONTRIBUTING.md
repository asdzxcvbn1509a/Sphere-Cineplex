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

- `server/` is a .NET 10 solution (`dotnet restore` and `dotnet tool restore` for `dotnet-ef`); `client/` is an npm project (`npm install`)
- The server needs `server/.env` (README step 3). Unit tests don't
- Integration tests need `server/.env.test` pointing at a database whose name ends in `_test` — see [Testing](docs/testing.md)

## Where code goes

**Server** (`server/src/CineBook.Web/`) — `Controllers/Api/` → `Services/` (see [Server layers](docs/architecture.md#server-layers))

- Describe input with a request class in `Models/Requests/` and a FluentValidation validator next to it (derive from `RequestValidator<T>`; the helpers `RequiredText`, `OptionalText`, `OneOf`, `DateKey`, `IdList`, `Paging` … give the same rules and Thai messages as before). The global `ValidationFilter` runs every validator and answers 422 `VALIDATION_ERROR`. Implement `INormalizable` to trim or reshape values before validation
- Controllers read the request, call one service and return the response envelope. They never use `AppDbContext`
- Services own the rules and the database access. Throw `ApiException` (`Infrastructure/Errors/ApiException.cs`) with a stable `UPPER_SNAKE_CASE` code and a Thai message for the user
- Reuse the shared pieces instead of writing the same thing again:

  | Need | Use |
  |---|---|
  | Lock a showtime or booking row inside a transaction | `Locks.LockShowtimeAsync`, `Locks.LockBookingAsync` |
  | 409 for a lost compare-and-set | `Locks.BookingStateChanged()`, `Locks.PaymentNotPending()` |
  | Seat taken by someone else | `Locks.IsSeatConflict(ex)`, `Locks.SeatTakenErrorAsync()` |
  | Insert seat rows in id order | `Sql.InsertBookingSeatsAsync` (not `SaveChanges`, which reorders inserts) |
  | Accept a slip for a booking or a seat change | `SlipService.QueueSlipForReviewAsync()`, `SlipService.CanUploadSlip()`, `SlipService.DiscardSlipOnErrorAsync()` |
  | Seat-change rules / response shapes | `SeatChangeRules` |
  | Not found / not the owner | `BookingAccess.BookingNotFound()`, `BookingAccess.NotBookingOwner(message)`, `BookingAccess.CanAccessBooking()` |
  | A paginated admin list | `Paging(...)` in the validator, `Pagination.FindPageAsync()` in the service |
  | Seat labels, deterministic id order | `Seats.SeatLabels()`, `Seats.CompareIds()` |
  | Rate limit an endpoint | `[RateLimit("policy")]` with a policy in `Infrastructure/RateLimiting/RateLimitPolicies.cs` |

**Client** — see [Client structure](docs/architecture.md#client-structure)

- Call the API through the modules in `client/src/api/`, never with a bare `fetch`
- Load page data with `useApi(fetcher, deps)` (or `usePagedApi` for paginated admin lists) instead of hand-written loading/error state
- Two-button confirmations use `ConfirmModal`; form dialogs and dialogs with several actions use `Modal`
- Show error messages with `apiError(error).message`; branch on `apiError(error).code`

## Changing booking, payment or seat-change state

These are the parts where a mistake loses money or double-books a seat. For any change to a status transition:

1. **Compare-and-set** — put the expected status in the `Where` of `ExecuteUpdateAsync`, check the row count, and throw a 409 when nothing was updated. Never read a status, check it in C#, then overwrite it. Set `UpdatedAt` in the update yourself (the timestamp interceptor only sees `SaveChanges`)
2. **Lock order** — `Showtime` (`FOR SHARE`) → `Booking` → `SeatChange` → `BookingSeat` → `Payment` → `ReceiptCounter`. Write seat rows sorted by id
3. **Side effects after commit** — emails are queued after the transaction commits (see `ReceiptService.EmailAsync`); notifications are written inside it (`NotificationService.NotifyAsync(db, …)`)
4. **Files** — an uploaded slip is already in storage when the service runs; remove it if the request fails (`DiscardSlipOnErrorAsync`) and delete a replaced slip only after the new one is saved
5. **Money and time** — integer baht; UTC in the database
6. **Test the race** — add an integration test that fires the competing operations together (`Fixtures.AllSettled`, each with its own DI scope) and checks that the final state is consistent. `Integration/PaymentTests.cs` and `SeatChangeTests.cs` have examples
7. **Document it** — update [State machines](docs/state-machines.md) and the matching section of [Architecture](docs/architecture.md)

## Adding or changing an endpoint

1. **Controller action** — attribute route under `api/...`, `[Authorize]` / `[Authorize(Roles = "ADMIN")]`, `[RateLimit(...)]` if needed, `SlipUploadReader` for slip uploads. Keep the `// @ENDPOINT` comments
2. **Request + validator** — in `Models/Requests/`
3. **Service** — rules, EF Core, `ApiException` codes; register it in `Infrastructure/Startup/ServiceRegistration.cs`
4. **Response** — a record in `Models/Responses/`, one response envelope (`{ booking }`, `{ items… }`)
5. **Client** — a function in `client/src/api/<group>.js`
6. **Docs** — the endpoint and any new error code in [docs/api.md](docs/api.md), and an example in `server/api.http`
7. **Tests** — integration tests for permissions, error codes and state changes; `HttpAuthTests.cs` and `HttpBookingTests.cs` cover real-HTTP behaviour (headers, uploads, status codes)

## Database schema changes

- Change the entity in `Models/Entities/` and its mapping in `Data/AppDbContext.cs`, then `dotnet ef migrations add <Name> --project src/CineBook.Web --output-dir Data/Migrations` and **commit the migration** — production applies pending migrations on start (`DB_MIGRATE_ON_START=true`, [DEPLOY.md](DEPLOY.md))
- Keep the naming of the existing schema: PascalCase tables, camelCase columns, PostgreSQL enums named like the C# enum
- Never change the production schema by hand (e.g. in the Azure portal's query editor)
- Update the seed and the test fixtures if the new columns need data. The seed writes finished history rows straight to the database in `Seed/SeedSales.cs`, so new columns (or changed state rules) must be mirrored there
- Integration tests truncate a fixed list of tables (`tests/CineBook.Tests/Helpers/ApiFactory.cs`) — add new tables to it

## UI text and languages

- Every string in the UI goes through `t('section.key')`; add the key to **both** `client/src/i18n/th.json` and `client/src/i18n/en.json`
- Database fields that come in two languages (`titleTh` / `titleEn`) are shown with `pick(movie, 'title')`
- Server error messages are Thai and are displayed as-is — keep the `code` stable when you reword a message
- The layout is mobile-first (usable from 360px): check new screens at phone width and on desktop
- Style with the design-system tokens only (`bg-surface`, `text-muted`, `text-body-2`, …). Tailwind's default colors and sizes are disabled and produce no CSS. See [Design system](docs/design-system.md)

## Code style

There is no linter or formatter run in CI; match the surrounding code:

- C# (`server/.editorconfig`): 4-space indentation, file-scoped namespaces, `var` where the type is obvious, primary constructors for services and controllers, `sealed` classes, records for response shapes, `Async` suffix on async methods, lines of about 120 characters
- JavaScript (`client/`): ESM, 2-space indentation, single quotes, semicolons, trailing commas, arrow functions, lines of about 100 characters
- Comments explain *why* something is done, in Thai like the rest of the code; Markdown docs are written in English
- Naming: service methods are verbs (`CreateAsync`, `ListRefundsAsync`), error factories describe the error (`BookingAccess.BookingNotFound()`)
- Seat-change pricing exists twice — `server/src/CineBook.Web/Utils/SeatChangePlanner.cs` (authoritative) and `client/src/utils/seatChange.js` (preview). Change both, with unit tests
- Files use LF line endings

## Before you push

```bash
cd server && dotnet test
cd ../client && npm run build
```

For UI changes, also click through the affected pages against the `_test` database ([Checking the web app in a browser](docs/testing.md#checking-the-web-app-in-a-browser)). Keep commits focused, with a subject that says what changed
