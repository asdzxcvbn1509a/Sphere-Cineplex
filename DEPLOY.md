# 🚀 Deploy: Vercel + Render + Supabase

A step-by-step guide to going live. Every service works on its free plan. Follow steps 1 → 10 in order

## Overview

```
Browser ──► Vercel ─────────────────────► Render ──────────► Supabase
            web app (client/)             API (server/)      Postgres + Storage (slips)
            forwards /api/* to Render
```

- The web app calls the API at `/api/...` on its own domain, and Vercel forwards those requests to Render as configured in `client/vercel.json`
  **Don't change the web app to call the Render URL directly**: the refresh token lives in a `SameSite=lax` cookie, and across domains the browser won't send it, so users get logged out on every refresh
- `client/vercel.json` also caches everything under `/assets/` for a year (`immutable`). Vite puts a content hash in those file names, so every build ships new names, while `index.html` is still revalidated on every visit and always points at the current files
- The API is configured through `render.yaml` (Render Blueprint): build, start and health check
- Pick the **Singapore** region for both Render and Supabase. The API makes several database round trips per request, so if they sit on different continents every page will be slow

> Vercel's Hobby plan (free) is for personal, non-commercial use only. To sell real tickets you need the Pro plan

## Prerequisites

- GitHub, Supabase, Render and Vercel accounts (all of them let you sign up with your GitHub account)
- The project already running on your own machine, following the [README](README.md#install-and-run)

---

## 1. Push the code to GitHub

Render and Vercel pull the code from GitHub, so everything the system needs must be committed

1. Check for uncommitted files:

   ```bash
   git status
   ```

   Every folder in `server/prisma/migrations/` must be committed, because Render creates the tables from migrations only. If one is missing, the tables will be incomplete and the API will break at runtime

2. Commit everything:

   ```bash
   git add -A
   git commit -m "Prepare for deployment"
   ```

3. Create a new repo on GitHub (it can be private) and push:

   ```bash
   git remote add origin https://github.com/<username>/<repo-name>.git
   git push -u origin main
   ```

4. Open the repo on GitHub and check that `server/.env` and `server/.env.test` were **not** pushed (`.gitignore` already excludes them, but double-check: they contain the database password and JWT secrets)

## 2. Supabase: database and slip storage

### 2.1 Create a project

1. [supabase.com](https://supabase.com) → **New project**
2. **Region:** Southeast Asia (Singapore)
3. **Database password:** set one and note it down (used in step 2.2)
4. **Turn off the Data API** if the create-project page offers the option. If the project already exists, turn it off at Project Settings → Data API
   - This app connects to the database directly through Prisma and doesn't use Supabase's REST API
   - The tables Prisma creates don't have RLS enabled, so if the Data API stays on, they may be reachable through it
   - Storage, which holds the slips, is a separate service and isn't affected when the Data API is off

### 2.2 Connection string → `DATABASE_URL`

1. Click the **Connect** button at the top of the project page and choose **Session pooler**
   **Don't use Direct connection**: it's IPv6, which Render can't reach (the build fails with `P1001`)
2. Copy the URI, which looks roughly like this:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

3. Replace `[YOUR-PASSWORD]` with the password from step 2.1. If it contains special characters such as `@ # / ? % :`, URL-encode them first (e.g. `@` → `%40`, `#` → `%23`)
4. Append `?connection_limit=5` to keep Prisma's connection count within the free-plan pooler quota

The result is your `DATABASE_URL`. Keep it for steps 3 and 4

### 2.3 Bucket for slips

Follow the [Slip storage](README.md#slip-storage) section of the README: Storage → **New bucket**, name it `slips` and **turn off Public bucket**

### 2.4 Storage connection values

| Value | Where to find it | Used as |
|---|---|---|
| Project URL | `https://<project-ref>.supabase.co`, where `<project-ref>` is the ID in the dashboard URL (`supabase.com/dashboard/project/<project-ref>`) | `SUPABASE_URL` |
| Secret key | Project Settings → API Keys → secret key (`sb_secret_…`), or `service_role` in the legacy tab | `SUPABASE_SECRET_KEY` |

> The secret key bypasses every permission in the database and Storage. Put it on Render only — **never in Vercel or in client-side code**

## 3. Render: API

1. [render.com](https://render.com) → **New** → **Blueprint** → connect GitHub and pick this repo
   Render reads `render.yaml` at the repo root and creates a web service named `theatre-reservation-api` (Singapore region, free plan, build/start commands and health check all preset)
2. Render asks for the values that aren't in the file:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The value from step 2.2 |
   | `SUPABASE_URL` | The value from step 2.4 |
   | `SUPABASE_SECRET_KEY` | The value from step 2.4 |
   | `CLIENT_ORIGIN` | The web app URL you'll get from Vercel, e.g. `https://<repo-name>.vercel.app`. If you're not sure yet, enter it anyway and fix it in step 6 |
   | `PROMPTPAY_ID` | The phone number or national ID number linked to **your own** PromptPay. The QR on the payment page is generated from it — if someone scans and pays, the money really goes to this number |

   You don't need to fill in:
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: Render generates them
   - `NODE_ENV` / `TRUST_PROXY`: already set in `render.yaml`

3. Click **Apply** and wait for the build (about 3–5 minutes the first time). The build step runs `prisma migrate deploy`, which creates every table on Supabase
4. Open the **Logs** tab. You should see this line (the server logs in Thai; it means "Slip storage: Supabase Storage (bucket slips)"):

   ```
   ที่เก็บสลิป: Supabase Storage (bucket slips)
   ```

   If you see the warning `⚠️  ยังเก็บสลิปลงดิสก์` ("still storing slips on disk"), `SUPABASE_URL` / `SUPABASE_SECRET_KEY` aren't set yet
5. Note the service URL at the top of the page, e.g. `https://theatre-reservation-api.onrender.com` (if that name is taken, Render adds a suffix), then open `<Render URL>/api/health` — it must return `"ok": true`

## 4. Load sample data (seed)

Do this once, after step 3 (the tables must already exist). Run it from **your own machine**, pointed at the Supabase database

> ⚠️ The seed **wipes every table** before creating the sample data. Only run it while there are no real users yet (for what a re-run does, see step 12)

PowerShell (Windows):

```powershell
cd server
$env:DATABASE_URL = '<DATABASE_URL from step 2.2>'
$env:SEED_PASSWORD = '<new demo account password>'
npm run db:seed
Remove-Item Env:DATABASE_URL, Env:SEED_PASSWORD
```

macOS / Linux:

```bash
cd server
DATABASE_URL='<DATABASE_URL from step 2.2>' SEED_PASSWORD='<new password>' npm run db:seed
```

- Values set with `$env:` only apply to that terminal window. `server/.env` still points at your local database
- **Don't forget `Remove-Item`**. If you do, the next command in the same window (e.g. `npm run db:reset`) will run against the production database
- `SEED_PASSWORD` replaces the `Password123` written in the README. Without it, anyone can log in as the admin
  - The resulting accounts are `admin@cinebook.test` (admin) and `somchai@example.test`, both with this password
  - Make it 8+ characters with both letters and digits
- Use single quotes `'...'` as in the example. If the password contains `$`, double quotes will mangle it

## 5. Vercel: web app

1. Edit `client/vercel.json` and replace `YOUR-RENDER-SERVICE.onrender.com` with the Render domain from step 3.5:

   ```json
   "destination": "https://theatre-reservation-api.onrender.com/api/:path*"
   ```

   Then commit and push:

   ```bash
   git commit -am "Point Vercel /api rewrite to Render"
   git push
   ```

   The file deliberately ships with a placeholder so the web app doesn't work until you change it. If you guessed the service name and that name belonged to someone else, every request — passwords and cookies included — would be sent to their server

2. [vercel.com](https://vercel.com) → **Add New** → **Project** → import this repo
3. **Root Directory:** click Edit and choose `client`
   - The framework is detected as Vite automatically; no need to change Build or Output
   - No Environment Variables are needed
4. Click **Deploy** to get the web app URL, e.g. `https://<project>.vercel.app` (see the actual name under Settings → Domains)

## 6. Correct `CLIENT_ORIGIN`

If the Vercel URL differs from what you entered in step 3:
1. Render → service → **Environment** → set `CLIENT_ORIGIN` to the real URL (no trailing `/`)
2. Click Save and Render restarts on its own

This value is used to build the links in emails (password reset links and receipts). If it's wrong, those links lead to the wrong place

## 7. Match `TRUST_PROXY` to the real number of proxies

The rate limits on login, sign-up and forgot password count per user IP. The system only sees the real IP when `TRUST_PROXY` exactly equals the number of proxies in front of the API
If it's set too low, everyone is counted as the same IP (Vercel's):
- One person entering a wrong password repeatedly gets that account locked for everyone
- The sign-up quota is shared by the whole site

Steps:
1. Open `https://<Vercel URL>/api/health`. **It must be opened through the Vercel URL** — through the Render URL, the count comes out one hop short
2. Check `proxyHops`. If it's already `3`, this step is done
3. If it isn't 3, set `TRUST_PROXY` in `render.yaml` to that value, then commit and push
   Change it in the file, because the file is the source of truth for this value. If you only change it in the dashboard, it may be overwritten on the next Blueprint sync
4. Open `/api/health` again. The `ip` value must match the IP shown by [api64.ipify.org](https://api64.ipify.org)

> **Accepted limitation:** requests sent straight to the Render URL (bypassing Vercel) pass through one fewer proxy, so they can spoof their IP to dodge the rate limits

## 8. Keep the server awake (Render free plan)

The free Render plan goes to sleep after 15 minutes without requests and takes about 1 minute to wake up. While it's asleep:
- The first visitor has a long wait (Vercel waits at most 120 seconds)
- Background jobs stop: seats whose payment window has run out aren't released, and pre-showtime reminders aren't sent
- If nobody touches the database for 7 days, Supabase's free plan pauses the project

Fix this by setting up an automatic pinger with [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org) (both free):
- URL: `https://<Render URL>/api/health` (calling Render directly is fine; it doesn't need to go through Vercel)
- Interval: every 10 minutes

Render's free hours (750 hours/month) are enough to keep one service up all month, but not if the same account has other free services
On a paid Render plan you can skip this step

## 9. Email (optional)

Until `SMTP_HOST` is set, the system doesn't send real email. It prints each message (including password reset links) to Render's Logs instead, so users won't receive anything

Render's free plan **blocks ports 25, 465 and 587**, so Gmail won't work. Use [Brevo](https://www.brevo.com) (300 emails a day free) instead, which accepts port 2525:

1. Sign up for Brevo and verify the sender email you'll use (Senders)
2. On the SMTP & API page → create an SMTP key, and note down the SMTP login and the key
3. Render → Environment → add these variables:

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `2525` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | SMTP login from Brevo |
   | `SMTP_PASS` | SMTP key from Brevo |
   | `MAIL_FROM` | `CineBook <verified sender email>` |

On a paid Render plan you can use Gmail (port 587 + App Password) as described in `server/.env.example`

## 10. Post-deploy checks

- [ ] `<Render URL>/api/health` and `<Vercel URL>/api/health` both return `"ok": true`
- [ ] Log in on the web app and refresh — you must still be logged in (if you're logged out, see step 13)
- [ ] Open `<Vercel URL>/my-bookings` directly and refresh — you must not get a 404 page
- [ ] Book seats and upload a slip — a new file must appear under `payments/` in Supabase → Storage → `slips`
- [ ] Log in as the admin — you must be able to open that slip, and approving it must produce a receipt
- [ ] Render's Logs show no `⚠️` warnings

---

## 11. Future updates

- Push to `main` and both sides deploy automatically (Render only rebuilds when files in `server/` change)
- Whenever you change `schema.prisma`, always create the migration locally first with `npm run db:migrate` and commit the migration folder too. Render runs new migrations during the build
- Don't change the table structure of the production database by hand (e.g. through Supabase's Table Editor), because the next migration will clash with your changes

## 12. Reset the demo (re-run the seed)

You can re-run the command from step 4 at any time, e.g. when the sample showtimes run out (the seed only creates showtimes for the 7 days from the day it runs), but every run is a complete restart of the system:

- Self-registered users, bookings, payments, receipts and notifications are **all gone**, and everyone is logged out
- The demo account password becomes the `SEED_PASSWORD` set for that run (if unset, it reverts to `Password123`)
- Receipt numbers start again from 000001
- Existing slip images in the bucket are **not deleted** along with them. To empty it, go to Supabase → Storage → `slips` and delete the `payments` and `refunds` folders

**Never run it once there are real users**, and never put the seed in Render's build or start command

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Render build fails with `P1001: Can't reach database server` | You're using the Direct (IPv6) connection string — switch to Session pooler (step 2.2). Or the Supabase project is paused |
| Build fails with `prisma: not found` | The build command lacks `--include=dev`. Use the command from `render.yaml` |
| Logs show `max clients reached` | `DATABASE_URL` is missing the `?connection_limit=5` suffix |
| The server won't start and Logs show `ตั้งค่า environment ไม่ถูกต้อง` ("invalid environment configuration") | The next line names the bad variable. Fix it in Render → Environment |
| Deep links or refreshes give a Vercel 404 | Root Directory isn't set to `client`, or `client/vercel.json` is missing |
| Refreshing logs you out | Requests aren't going through Vercel (e.g. the code was changed to call the Render URL directly), so the cookie isn't sent |
| Every request errors and Vercel's Logs show `ROUTER_EXTERNAL_TARGET_ERROR` | The URL in `client/vercel.json` is wrong, or Render took longer than 120 seconds to wake up (try again, or do step 8) |
| Logs show `⚠️  ยังเก็บสลิปลงดิสก์` ("still storing slips on disk"), or opening a slip gives 404 `SLIP_FILE_MISSING` | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` aren't set. Slips uploaded during that time were stored on Render's disk and are already gone |
| Supabase says the project is paused | 7 days without activity. Click Restore on the project page, then do step 8 to keep it from happening again |
