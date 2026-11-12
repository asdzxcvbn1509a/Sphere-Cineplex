# 🚀 Deploy: Azure for Students

One **Azure App Service** runs the whole system: the ASP.NET Core app answers `/api/*` and serves the built React app for every other path. The data lives in **Azure Database for PostgreSQL** and the payment slips in **Azure Blob Storage**

## Overview

```
Browser ──HTTPS──► App Service (Linux, Free F1, .NET 10)  https://<app>.azurewebsites.net
                     ├── /api/*        ASP.NET Core API
                     ├── everything else  wwwroot/index.html (React build)
                     ├──► Azure Database for PostgreSQL – Flexible Server (Burstable B1ms)
                     ├──► Azure Blob Storage (private container "slips")
                     ├──► SMTP (Gmail app password on port 587, or another provider) — optional
                     └── background jobs: expire unpaid holds and seat changes, showtime reminders
UptimeRobot ──every 5 min──► /api/health   (F1 has no Always On; the app sleeps after ~20 idle minutes)
```

- The web app and the API share one origin, so the refresh cookie (`SameSite=lax`, `Secure`) just works and no proxy or rewrite is needed
- `dotnet publish` builds `client/` into the app's `wwwroot`, so one publish is the whole deployment
- The steps use the Azure portal. Keep every resource in **one region and one resource group**

### Cost

| Resource | Plan | Cost |
|---|---|---|
| App Service plan | Free F1 | Free, no time limit, within quotas: CPU 3 minutes per 5 minutes and 60 minutes per day, 1 GB of memory, 165 MB of outbound data per day (see [F1 quotas](#free-f1-quotas)). No Always On, no custom-domain TLS |
| Azure Database for PostgreSQL | Flexible Server, Burstable B1ms, 32 GB | Free for 12 months under Azure's free services (750 hours/month) — afterwards it is billed to your credit, so delete or downsize it before then |
| Storage account | Standard LRS | A few baht a month from the student credit |

Azure for Students gives a yearly credit and must be renewed every year. **When the credit runs out the whole subscription is disabled**, including the free services — check **Cost Management** now and then

## Prerequisites

- An Azure for Students subscription (sign up with your university email at <https://azure.microsoft.com/free/students>)
- The code on GitHub (the workflow in step 6 deploys from the `main` branch)
- .NET SDK 10, Node.js 20+ and `psql` on your machine (for seeding and checks)

## 1. Resource group

Portal → **Resource groups** → **Create** → name it e.g. `cinebook-rg` → pick a region close to your users, such as **Southeast Asia**. Student subscriptions often have a policy that allows only some regions; if a later step says the region isn't allowed, start again in one the error message lists

## 2. Database: Azure Database for PostgreSQL – Flexible Server

1. Portal → **Create a resource** → **Azure Database for PostgreSQL – Flexible Server** → **Create**
2. **Basics**
   - Resource group `cinebook-rg`, server name e.g. `cinebook-db` (becomes `cinebook-db.postgres.database.azure.com`), the same region
   - PostgreSQL version: the newest offered (16 or later)
   - Workload type: **Development** → **Configure server** → **Burstable, B1ms**, storage **32 GiB**, high availability **off**
   - Authentication: **PostgreSQL authentication only**; set an admin username and a strong password (avoid `@` `:` `/` `?` `#` in it, or URL-encode them later)
3. **Networking**: **Public access**, tick **Allow public access from any Azure service within Azure to this server**, and **+ Add current client IP address** (for seeding from your machine)
4. **Review + create**, wait a few minutes
5. Open the server → **Databases** → **+ Add** → name `cinebook`

The connection string for the app (`DATABASE_URL`):

```
postgresql://<admin>:<password>@cinebook-db.postgres.database.azure.com:5432/cinebook?sslmode=require&connection_limit=5
```

`sslmode=require` is mandatory on Azure; `connection_limit=5` keeps the app's pool small for the B1ms server

## 3. Slip storage: Azure Blob Storage

1. Portal → **Storage accounts** → **Create** → resource group `cinebook-rg`, a globally unique name (e.g. `cinebookslips123`), the same region, **Standard**, redundancy **LRS** → **Review + create**
2. Open it → **Containers** → **+ Container** → name `slips`, anonymous access **Private**
3. **Security + networking → Access keys** → **Show** → copy **Connection string** of key1. This is `AZURE_STORAGE_CONNECTION_STRING` — it grants full access to the account, so it goes only into the App Service settings (step 4) and your own terminal when seeding

## 4. App Service

1. Portal → **Create a resource** → **Web App**
   - Resource group `cinebook-rg`, name e.g. `cinebook` (the site becomes `https://cinebook.azurewebsites.net`)
   - Publish: **Code** · Runtime stack: **.NET 10 (LTS)** · Operating system: **Linux** · the same region
   - Pricing plan: create a new Linux plan and choose **Free F1**
   - **Review + create**
2. Open the app → **Settings → Configuration → General settings**: **HTTPS Only** = On, **SCM Basic Auth Publishing Credentials** = On (needed for the publish profile in step 6) → **Save**
3. **Settings → Environment variables → App settings** → add each of these → **Apply**:

| Name | Value |
|---|---|
| `DATABASE_URL` | the connection string from step 2 |
| `AZURE_STORAGE_CONNECTION_STRING` | the connection string from step 3 |
| `JWT_ACCESS_SECRET` | a new random value: `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))` (PowerShell) or `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | another new random value |
| `CLIENT_ORIGIN` | `https://<app>.azurewebsites.net` (no trailing `/`) |
| `PROMPTPAY_ID` | your PromptPay number (keep the sample `0812345678` only for a demo nobody pays into) |
| `TRUST_PROXY` | `1` — App Service has one front end in front of the app (check it in step 7) |
| `DB_MIGRATE_ON_START` | `true` — creates the tables on the first start and applies new migrations on later deploys |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `false` — the app reads `X-Forwarded-For` itself according to `TRUST_PROXY` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | optional, see step 9 |

Leave `ASPNETCORE_ENVIRONMENT` unset (the app then runs in Production) and `PROXY_SECRET` empty. Every other variable has a sensible default — see [Configuration](docs/configuration.md)

App Service sets the port itself (`ASPNETCORE_HTTP_PORTS=8080`), and the app listens on it automatically

## 5. First deploy and check

Any of the deploy methods in step 6 works for the first deploy. After it, open **Monitoring → Log stream** and restart the app once (**Overview → Restart**). The start-up lines should show:

```
🎬  Theatre Reservation API
    http://localhost:8080/api/health  (Production)
    อนุญาต origin: https://<app>.azurewebsites.net
    ที่เก็บสลิป: Azure Blob Storage (container slips)
    เครื่อง: <n> CPU · Workstation GC · ใช้ <n> MB จาก <n> MB
```

- No `❌ ตั้งค่า environment ไม่ถูกต้อง` ("invalid environment configuration") — if there is, the next lines name the variable to fix
- The `เครื่อง:` ("machine:") line shows how many CPUs and how much memory the app sees, and how much memory it uses right after starting. It should say `Workstation GC` (set in `CineBook.Web.csproj`) and use roughly 100–200 MB, far below the F1 limit of 1 GB (see [F1 quotas](#free-f1-quotas))
- No `⚠️` lines you didn't expect. The ones you may see on purpose: the sample `PROMPTPAY_ID` and the missing `SMTP_HOST`
- The first start creates the tables (`DB_MIGRATE_ON_START=true`); it can take a minute on F1

## 6. Deploying from GitHub (recommended)

The repository contains `.github/workflows/deploy-azure.yml`. On every push to `main` (or a manual run) it installs Node and .NET, runs `dotnet publish` (which builds the web app into `wwwroot`) and deploys the result

1. App Service → **Overview** → **Download publish profile** (if the button is greyed out, step 4.2 wasn't saved)
2. GitHub → the repository → **Settings → Secrets and variables → Actions**
   - **Secrets** → **New repository secret** → name `AZURE_WEBAPP_PUBLISH_PROFILE`, value = the whole content of the downloaded file
   - **Variables** → **New repository variable** → name `AZURE_WEBAPP_NAME`, value = the app name (e.g. `cinebook`)
3. **Actions** → **Deploy to Azure App Service** → **Run workflow** (or push to `main`)

The publish profile avoids creating a service principal, which university tenants usually don't allow. Keep it secret: it can deploy anything to the app. If it leaks, **Reset publish profile** on the app's Overview page and update the secret

Without GitHub — publish locally and upload the folder:

```bash
cd server
dotnet publish src/CineBook.Web -c Release -o publish
```

then in VS Code with the **Azure App Service** extension: right-click the `publish` folder → **Deploy to Web App…** → pick the app. (Or zip the folder's contents and run `az webapp deploy --resource-group cinebook-rg --name <app> --src-path app.zip --type zip`)

## 7. Check `TRUST_PROXY`

Open `https://<app>.azurewebsites.net/api/health` from your own browser:

- `proxyHops` should be `1` and `ip` should be your public IP address
- If `proxyHops` is different, set `TRUST_PROXY` to that number. If `ip` is a private Azure address while `proxyHops` is 1, `TRUST_PROXY` is still `loopback` — set it to `1`

Rate limits (logins, sign-ups, slip uploads) count per client IP, so a wrong value either lumps every visitor together or lets anyone spoof an IP to dodge the limits

## 8. Load the sample data (seed)

Run the seed **once**, from your machine, against the Azure database and storage. In PowerShell, from `server/`:

```powershell
$env:DATABASE_URL = "postgresql://<admin>:<password>@cinebook-db.postgres.database.azure.com:5432/cinebook?sslmode=require"
$env:AZURE_STORAGE_CONNECTION_STRING = "<connection string from step 3>"
$env:SEED_PASSWORD = "<a password for the demo accounts>"
$env:DB_MIGRATE_ON_START = "true"
dotnet run --project src/CineBook.Web -- seed
Remove-Item Env:DATABASE_URL, Env:AZURE_STORAGE_CONNECTION_STRING, Env:SEED_PASSWORD, Env:DB_MIGRATE_ON_START
```

- Values in the environment win over `server/.env`, so this run uses Azure while your local settings stay as they are
- **Always set `SEED_PASSWORD`** — the default `Password123` is published in the README, and anyone could log in as an admin with it
- Your IP must be in the database's firewall rules (step 2.3); if your IP changed, add it again under the server's **Networking**
- The sample slips go to the `slips` container. If you forgot `AZURE_STORAGE_CONNECTION_STRING`, they land on your disk instead and the seed warns about it — set it and run the seed again

The seed **wipes every table**. Never run it once there are real users. Re-running it is how you reset the demo when the sample showtimes run out (they cover 10 days back to 7 days ahead of the run): accounts, bookings and receipts all start over, and slips uploaded by real users stay in the container until you delete the `payments/` and `refunds/` folders yourself

## 9. Email (optional)

Without SMTP nothing is emailed: forgot-password links and receipts are not sent (production logs only a one-line notice). Azure blocks outbound port 25 only, so a normal provider on port 587 works. With Gmail:

1. Turn on 2-Step Verification for the Google account, then create an **App password** (Google Account → Security → App passwords)
2. App settings:

| Name | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | the 16-character app password |
| `MAIL_FROM` | `CineBook <your Gmail address>` — must be the same address as `SMTP_USER` |

Leave `SMTP_SECURE` unset (port 587 uses STARTTLS). Any other SMTP provider (Brevo, SendGrid, …) works the same way

## 10. Keep the app awake

The Free F1 plan has no **Always On**: after about 20 minutes without requests the app is unloaded, the next visitor waits for a cold start, and the background jobs stop while it sleeps (unpaid holds then expire only when the app wakes up)

Create a free monitor at [UptimeRobot](https://uptimerobot.com) (or cron-job.org): type **HTTP(s)**, URL `https://<app>.azurewebsites.net/api/health`, interval **5 minutes**. `/api/health` doesn't touch the database, so the pings cost almost nothing

### Free F1 quotas

| Quota | Limit | Resets |
|---|---|---|
| CPU (Short) | 3 CPU minutes per 5 minutes | every 5 minutes |
| CPU (Day) | 60 CPU minutes per day | at 00:00 UTC (07:00 in Thailand) |
| Memory | 1,024 MB for the whole plan | at the start of every hour |
| Data Out | 165 MB of responses per day | at 00:00 UTC (07:00 in Thailand) |

When any of them runs out, Azure stops the whole site until that quota resets: the pages, the API and the SCM site (deploys, Log stream) all answer **403 "This web app is stopped"**, and **Overview → Status** shows **Quota exceeded**. **App Service plan → Quotas** shows which quota ran out and when it resets

- Restarting doesn't help, and deploys fail with 403 until the quota resets
- To get the site back at once, **App Service plan → Scale up → B1**: Basic has no quotas (about US$13 a month from the student credit, charged only while the plan is on B1). Deploy or investigate, then scale back down to F1
- The memory chart under **Metrics** can stay empty on F1; the `เครื่อง:` line in the Log stream (step 5) shows how much memory the app uses instead
- For a real launch, stay on B1 or higher — it also has **Always On**, so the monitor above isn't needed

## 11. Post-deploy checks

- [ ] `https://<app>.azurewebsites.net/api/health` answers `ok: true`, and `proxyHops`/`ip` are right (step 7)
- [ ] The home page loads; refreshing a deep link such as `/my-bookings` or `/admin/payments` shows the page (not a 404)
- [ ] Log in, refresh the page — you are still logged in (the refresh cookie works)
- [ ] Book seats and upload a slip → a new blob appears under `payments/` in the `slips` container
- [ ] As an admin, open the slip in the review queue and approve it → the receipt opens (and arrives by email if SMTP is set)
- [ ] Opening a slip URL without logging in is refused — slips are only served through the API
- [ ] **Log stream** shows no `⚠️` lines you didn't expect and no `fail:` lines

## 12. Future updates

- Push to `main` → the workflow deploys. New EF Core migrations run on the next start (`DB_MIGRATE_ON_START=true`)
- Create migrations locally (`dotnet ef migrations add <Name> --project src/CineBook.Web --output-dir Data/Migrations`) and commit them
- Don't change the production schema by hand (e.g. in the portal's query editor) — the next migration would clash with it

## 13. Moving data from the earlier Vercel + Render + Supabase deployment (optional)

The default is to start fresh with the seed. To keep the old production data instead:

1. With the old version still running, clear slips that were sent after their deadline and are still waiting for review — the new version hides them from the queue. This query must return 0 rows (approve or reject the remaining ones first):

   ```sql
   SELECT p.id, p.kind, p.amount, b.code, b.status AS booking_status, s.status AS seat_change_status
   FROM "Payment" p
   JOIN "Booking" b ON b.id = p."bookingId"
   LEFT JOIN "SeatChange" s ON s.id = p."seatChangeId"
   WHERE p.status = 'PENDING_VERIFICATION'
     AND ((p.kind = 'BOOKING' AND b.status <> 'PENDING_VERIFICATION')
       OR (p.kind = 'SEAT_CHANGE_TOPUP' AND s.status <> 'PENDING_VERIFICATION'));
   ```

2. Dump the data only: `pg_dump --data-only --no-owner --exclude-table=_prisma_migrations "<old DATABASE_URL>" > data.sql`
3. Let the new app start once with an empty database so the migration creates the tables, then load the dump with `psql "<Azure DATABASE_URL>" -f data.sql`. The schema is identical, so no conversion is needed
4. Copy the slip files from the Supabase bucket `slips` to the Azure container `slips`, keeping the `payments/` and `refunds/` prefixes (download them from Supabase Storage, then upload with Azure Storage Explorer or `az storage blob upload-batch`)

Generate new JWT secrets anyway — everyone logs in again, which is fine

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The site shows "Application Error" and Log stream shows `ตั้งค่า environment ไม่ถูกต้อง` | The next lines name the bad variable. Fix it in **Environment variables** and apply |
| Log stream shows `JWT_ACCESS_SECRET … ค่าตัวอย่าง` (sample value) | The secrets are still the ones from `.env.example`; set new random values |
| The app fails to start with a database error mentioning SSL or `pg_hba.conf` | `DATABASE_URL` lacks `?sslmode=require`, or the server's **Networking** doesn't allow Azure services |
| `relation "Booking" does not exist` | The tables were never created — set `DB_MIGRATE_ON_START=true` and restart |
| Log stream shows `⚠️ ยังเก็บสลิปลงดิสก์` ("still storing slips on disk"), or opening a slip gives 404 `SLIP_FILE_MISSING` | `AZURE_STORAGE_CONNECTION_STRING` isn't set. Slips uploaded meanwhile went to the app's disk and are lost on the next deploy |
| Log stream shows `⚠️ ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` | Set it to `false` (step 4) |
| Users get `LOGIN_RATE_LIMITED` or `REGISTER_RATE_LIMITED` after only a few attempts | `TRUST_PROXY` doesn't match `proxyHops`, so every visitor shares one IP (step 7) |
| Refreshing logs you out | The site isn't on HTTPS (the cookie is `Secure`), or `CLIENT_ORIGIN` doesn't match the site URL |
| The workflow fails at **Deploy** with an authentication error | The publish profile secret is wrong or was reset — download it again (step 6) and check **SCM Basic Auth Publishing Credentials** is On |
| The site (and the SCM site) answers 403 "This web app is stopped" | Check **Overview → Status**. **Quota exceeded**: an F1 quota ran out — [F1 quotas](#free-f1-quotas) tells which one and how to get the site back. **Stopped**: someone pressed Stop — press **Start**. If the subscription itself is disabled, the student credit ran out or expired (see [Cost](#cost)) |
| The first request after a while takes many seconds | The app was asleep — set up the monitor in step 10 |
