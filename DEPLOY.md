# 🚀 Deploy: Vercel + Render + Supabase

คู่มือขึ้นระบบจริงทีละขั้น ใช้แพ็กเกจฟรีได้ทุกบริการ ทำตามลำดับข้อ 1 → 10

## ภาพรวม

```
เบราว์เซอร์ ──► Vercel ─────────────────► Render ─────────► Supabase
               หน้าเว็บ (client/)           API (server/)      Postgres + Storage (สลิป)
               ส่งต่อ /api/* ไปที่ Render
```

- หน้าเว็บเรียก API ที่ `/api/...` บนโดเมนเดียวกับตัวเอง แล้ว Vercel ส่งต่อไปที่ Render ตามที่ตั้งไว้ใน `client/vercel.json`
  **ห้ามแก้ให้หน้าเว็บเรียก URL ของ Render ตรง ๆ** เพราะ refresh token อยู่ใน cookie แบบ `SameSite=lax` ถ้าข้ามโดเมน เบราว์เซอร์จะไม่ส่ง cookie ไป ผู้ใช้จะหลุดล็อกอินทุกครั้งที่รีเฟรช
- API ตั้งค่าผ่าน `render.yaml` (Render Blueprint) ทั้ง build, start และ health check
- เลือก region **Singapore** ทั้ง Render และ Supabase เพราะ API คุยกับฐานหลายรอบต่อ request ถ้าอยู่คนละทวีป ทุกหน้าจะช้า

> Vercel แพ็กเกจ Hobby (ฟรี) ใช้ได้เฉพาะงานส่วนตัวที่ไม่ใช่เชิงพาณิชย์ ถ้าจะเปิดขายตั๋วจริงต้องใช้แพ็กเกจ Pro

## สิ่งที่ต้องมี

- บัญชี GitHub, Supabase, Render และ Vercel (สมัครด้วยบัญชี GitHub ได้ทุกเจ้า)
- โปรเจกต์ที่รันบนเครื่องตัวเองได้แล้วตาม [README](README.md#ติดตั้งและรัน)

---

## 1. เอาโค้ดขึ้น GitHub

Render และ Vercel ดึงโค้ดจาก GitHub ทุกอย่างที่ระบบต้องใช้จึงต้องถูก commit ไปด้วย

1. ดูว่ามีไฟล์ค้างไหม:

   ```bash
   git status
   ```

   ทุกโฟลเดอร์ใน `server/prisma/migrations/` ต้องถูก commit เพราะ Render สร้างตารางจาก migration เท่านั้น ถ้าขาดตัวไหน ตารางจะไม่ครบและ API จะพังตอนใช้งาน

2. commit ทุกอย่าง:

   ```bash
   git add -A
   git commit -m "Prepare for deployment"
   ```

3. สร้าง repo ใหม่บน GitHub (ตั้งเป็น private ได้) แล้ว push:

   ```bash
   git remote add origin https://github.com/<ชื่อผู้ใช้>/<ชื่อ-repo>.git
   git push -u origin main
   ```

4. เปิด repo บน GitHub แล้วเช็กว่า**ไม่มี** `server/.env` หรือ `server/.env.test` ติดขึ้นไป (`.gitignore` กันไว้แล้ว แต่ควรตรวจซ้ำ เพราะในไฟล์มีรหัสผ่านฐานข้อมูลและ JWT secret)

## 2. Supabase: ฐานข้อมูลและที่เก็บสลิป

### 2.1 สร้าง project

1. [supabase.com](https://supabase.com) → **New project**
2. **Region:** Southeast Asia (Singapore)
3. **Database password:** ตั้งรหัสแล้วจดไว้ (ใช้ในข้อ 2.2)
4. **ปิด Data API** ถ้าหน้าสร้าง project มีตัวเลือกนี้ ถ้าสร้างไปแล้วก็ปิดได้ที่ Project Settings → Data API
   - แอปนี้ต่อฐานผ่าน Prisma โดยตรง ไม่ได้ใช้ REST API ของ Supabase
   - ตารางที่ Prisma สร้างไม่ได้เปิด RLS ถ้าปล่อย Data API ไว้ ตารางพวกนี้อาจถูกเข้าถึงผ่าน API นั้นได้
   - Storage ที่ใช้เก็บสลิปเป็นอีกบริการหนึ่ง ปิด Data API แล้วไม่กระทบ

### 2.2 Connection string → `DATABASE_URL`

1. กดปุ่ม **Connect** ด้านบนของหน้า project แล้วเลือกแบบ **Session pooler**
   **ห้ามใช้ Direct connection** เพราะเป็น IPv6 ซึ่ง Render ต่อไม่ได้ (build จะล้มด้วย `P1001`)
2. คัดลอก URI ซึ่งหน้าตาประมาณนี้:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

3. แทน `[YOUR-PASSWORD]` ด้วยรหัสจากข้อ 2.1 ถ้ารหัสมีอักขระพิเศษอย่าง `@ # / ? % :` ต้องแปลงเป็น URL-encode ก่อน (เช่น `@` → `%40`, `#` → `%23`)
4. ต่อท้ายด้วย `?connection_limit=5` เพื่อจำกัดจำนวน connection ของ Prisma ไม่ให้เกินโควตาของ pooler แพ็กเกจฟรี

ค่าที่ได้คือ `DATABASE_URL` เก็บไว้ใช้ในข้อ 3 และ 4

### 2.3 Bucket สำหรับสลิป

ทำตามหัวข้อ [ที่เก็บสลิป](README.md#ที่เก็บสลิป) ใน README: Storage → **New bucket** ตั้งชื่อ `slips` และ**ปิด Public bucket**

### 2.4 ค่าสำหรับเชื่อมต่อ Storage

| ค่า | หาจากไหน | ใช้เป็น |
|---|---|---|
| Project URL | `https://<project-ref>.supabase.co` โดย `<project-ref>` คือรหัสใน URL ของหน้า dashboard (`supabase.com/dashboard/project/<project-ref>`) | `SUPABASE_URL` |
| Secret key | Project Settings → API Keys → secret key (`sb_secret_…`) หรือ `service_role` ในแท็บ legacy | `SUPABASE_SECRET_KEY` |

> secret key ข้ามสิทธิ์ทุกอย่างในฐานและ Storage ได้ ใส่ไว้ที่ Render ที่เดียวเท่านั้น **ห้ามใส่ใน Vercel หรือในโค้ดฝั่ง client**

## 3. Render: API

1. [render.com](https://render.com) → **New** → **Blueprint** → เชื่อม GitHub แล้วเลือก repo นี้
   Render จะอ่าน `render.yaml` ที่ราก repo แล้วสร้าง web service ชื่อ `theatre-reservation-api` ให้ (region Singapore, แพ็กเกจฟรี, คำสั่ง build/start และ health check ตั้งไว้หมดแล้ว)
2. Render จะถามค่าที่ยังไม่มีในไฟล์:

   | ตัวแปร | ใส่ค่า |
   |---|---|
   | `DATABASE_URL` | ค่าจากข้อ 2.2 |
   | `SUPABASE_URL` | ค่าจากข้อ 2.4 |
   | `SUPABASE_SECRET_KEY` | ค่าจากข้อ 2.4 |
   | `CLIENT_ORIGIN` | URL หน้าเว็บที่จะได้จาก Vercel เช่น `https://<ชื่อ-repo>.vercel.app` ถ้ายังไม่รู้แน่ใส่ไปก่อน แล้วแก้ในข้อ 6 |
   | `PROMPTPAY_ID` | เบอร์โทรหรือเลขบัตรประชาชนที่ผูกพร้อมเพย์**ของคุณเอง** QR หน้าชำระเงินสร้างจากเลขนี้ ถ้ามีคนสแกนจ่าย เงินจะเข้าเลขนี้จริง |

   ส่วนที่ไม่ต้องกรอก:
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: Render สุ่มให้เอง
   - `NODE_ENV` / `TRUST_PROXY`: กำหนดไว้ใน `render.yaml` แล้ว

3. กด **Apply** แล้วรอ build (ครั้งแรกประมาณ 3–5 นาที) ขั้น build จะรัน `prisma migrate deploy` สร้างตารางทั้งหมดบน Supabase ให้
4. เปิดแท็บ **Logs** ต้องเห็นบรรทัด:

   ```
   ที่เก็บสลิป: Supabase Storage (bucket slips)
   ```

   ถ้าเห็นคำเตือน `⚠️  ยังเก็บสลิปลงดิสก์` แปลว่ายังไม่ได้ตั้ง `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
5. จด URL ของ service ที่หัวหน้า เช่น `https://theatre-reservation-api.onrender.com` (ถ้าชื่อนี้มีคนใช้แล้ว Render จะต่อท้ายให้) แล้วเปิด `<URL Render>/api/health` ต้องได้ `"ok": true`

## 4. ใส่ข้อมูลตัวอย่าง (seed)

ทำครั้งเดียวหลังข้อ 3 (ตารางต้องถูกสร้างแล้ว) โดยรันจาก**เครื่องตัวเอง** แต่ชี้ไปที่ฐานบน Supabase

> ⚠️ seed **ล้างข้อมูลทุกตาราง**ก่อนสร้างข้อมูลตัวอย่าง รันได้เฉพาะตอนที่ยังไม่มีผู้ใช้จริง (ผลของการรันซ้ำดูข้อ 12)

PowerShell (Windows):

```powershell
cd server
$env:DATABASE_URL = '<DATABASE_URL จากข้อ 2.2>'
$env:SEED_PASSWORD = '<รหัสใหม่ของบัญชีเดโม>'
npm run db:seed
Remove-Item Env:DATABASE_URL, Env:SEED_PASSWORD
```

macOS / Linux:

```bash
cd server
DATABASE_URL='<DATABASE_URL จากข้อ 2.2>' SEED_PASSWORD='<รหัสใหม่>' npm run db:seed
```

- ค่าที่ตั้งด้วย `$env:` มีผลแค่ในหน้าต่างเทอร์มินัลนั้น `server/.env` ยังชี้ไปที่ฐานในเครื่องเหมือนเดิม
- **อย่าลืม `Remove-Item`** ถ้าลืม คำสั่งถัดไปในหน้าต่างเดียวกัน (เช่น `npm run db:reset`) จะไปทำกับฐานจริง
- `SEED_PASSWORD` ใช้แทน `Password123` ที่เขียนอยู่ใน README ถ้าไม่ตั้ง ใครก็ล็อกอินเป็นผู้ดูแลได้
  - บัญชีที่ได้คือ `admin@cinebook.test` (ผู้ดูแล) และ `somchai@example.test` ใช้รหัสนี้ทั้งคู่
  - ควรยาว 8 ตัวขึ้นไป มีทั้งตัวอักษรและตัวเลข
- ใช้ quote เดี่ยว `'...'` ตามตัวอย่าง ถ้ารหัสมี `$` อยู่ quote คู่จะทำให้ค่าเพี้ยน

## 5. Vercel: หน้าเว็บ

1. แก้ `client/vercel.json` เปลี่ยน `YOUR-RENDER-SERVICE.onrender.com` เป็นโดเมน Render จากข้อ 3.5:

   ```json
   "destination": "https://theatre-reservation-api.onrender.com/api/:path*"
   ```

   แล้ว commit และ push:

   ```bash
   git commit -am "Point Vercel /api rewrite to Render"
   git push
   ```

   ไฟล์นี้ตั้งใจใส่ placeholder ให้หน้าเว็บใช้ไม่ได้จนกว่าจะแก้ ถ้าเดาชื่อ service แล้วชื่อนั้นเป็นของคนอื่น ทุก request รวมรหัสผ่านและ cookie จะถูกส่งไปที่เซิร์ฟเวอร์ของเขา

2. [vercel.com](https://vercel.com) → **Add New** → **Project** → Import repo นี้
3. **Root Directory:** กด Edit แล้วเลือก `client`
   - Framework จะขึ้นเป็น Vite เอง ไม่ต้องแก้ Build หรือ Output
   - ไม่ต้องตั้ง Environment Variables
4. กด **Deploy** จะได้ URL หน้าเว็บ เช่น `https://<project>.vercel.app` (ดูชื่อจริงที่ Settings → Domains)

## 6. แก้ `CLIENT_ORIGIN` ให้ตรง

ถ้า URL จาก Vercel ไม่ตรงกับที่ใส่ไว้ในข้อ 3:
1. Render → service → **Environment** → แก้ `CLIENT_ORIGIN` เป็น URL จริง (ไม่มี `/` ท้าย)
2. กด Save แล้ว Render จะรีสตาร์ตให้เอง

ค่านี้ใช้ทำลิงก์ในอีเมล (ลิงก์ตั้งรหัสผ่านใหม่และใบเสร็จ) ถ้าผิด ลิงก์ในเมลจะพาไปผิดที่

## 7. ตั้ง `TRUST_PROXY` ให้ตรงกับจำนวน proxy จริง

rate limit ของการล็อกอิน สมัครสมาชิก และลืมรหัสผ่าน นับตาม IP ของผู้ใช้ ระบบจะเห็น IP จริงก็ต่อเมื่อ `TRUST_PROXY` เท่ากับจำนวน proxy หน้า API พอดี
ถ้าตั้งน้อยไป ทุกคนจะถูกนับเป็น IP เดียวกัน (ของ Vercel):
- คนหนึ่งกรอกรหัสผิดซ้ำ ๆ แล้วบัญชีนั้นโดนล็อกสำหรับทุกคน
- โควตาสมัครสมาชิกถูกใช้ร่วมกันทั้งเว็บ

ขั้นตอน:
1. เปิด `https://<URL Vercel>/api/health` **ต้องเปิดผ่าน URL ของ Vercel** ถ้าเปิดผ่าน URL ของ Render จะนับได้น้อยกว่าความจริง 1 ชั้น
2. ดูค่า `proxyHops` ถ้าเป็น `3` อยู่แล้วก็จบขั้นนี้
3. ถ้าไม่ใช่ 3 ให้แก้ `TRUST_PROXY` ใน `render.yaml` เป็นค่านั้น แล้ว commit และ push
   ต้องแก้ที่ไฟล์ เพราะไฟล์เป็นต้นฉบับของค่านี้ ถ้าแก้ใน dashboard อย่างเดียว ค่าอาจถูกเขียนทับตอน Blueprint sync ครั้งถัดไป
4. เปิด `/api/health` อีกครั้ง ค่า `ip` ต้องตรงกับ IP ที่ [api64.ipify.org](https://api64.ipify.org) แสดง

> **ข้อจำกัดที่ยอมรับไว้:** ถ้ามีคนยิง request ตรงไปที่ URL ของ Render (ไม่ผ่าน Vercel) ทางนั้นมี proxy น้อยกว่า 1 ชั้น จึงปลอม IP หลบ rate limit ได้

## 8. กันเซิร์ฟเวอร์หลับ (Render แพ็กเกจฟรี)

Render ฟรีจะหลับเมื่อไม่มี request เข้ามา 15 นาที และใช้เวลาตื่นราว 1 นาที ระหว่างที่หลับ:
- คนแรกที่เข้าเว็บต้องรอนาน (Vercel รอได้สูงสุด 120 วินาที)
- job เบื้องหลังหยุดทำงาน ที่นั่งที่หมดเวลาชำระไม่ถูกปล่อย และแจ้งเตือนก่อนรอบฉายไม่ถูกส่ง
- ถ้าไม่มีใครใช้ฐานข้อมูลเลย 7 วัน Supabase แพ็กเกจฟรีจะพัก project

แก้โดยตั้งตัวเรียกอัตโนมัติด้วย [UptimeRobot](https://uptimerobot.com) หรือ [cron-job.org](https://cron-job.org) (ฟรีทั้งคู่):
- URL: `https://<URL Render>/api/health` (เรียก Render ตรงได้ ไม่ต้องผ่าน Vercel)
- ความถี่: ทุก 10 นาที

ชั่วโมงฟรีของ Render (750 ชั่วโมง/เดือน) พอให้ service เดียวเปิดได้ทั้งเดือน แต่ถ้ามี service ฟรีตัวอื่นในบัญชีเดียวกันจะไม่พอ
ถ้าใช้แพ็กเกจเสียเงินของ Render ข้ามข้อนี้ได้

## 9. อีเมล (ไม่บังคับ)

ถ้ายังไม่ตั้ง `SMTP_HOST` ระบบจะไม่ส่งเมลจริง แต่พิมพ์เนื้อเมล (รวมลิงก์ตั้งรหัสผ่านใหม่) ลง Logs ของ Render แทน ผู้ใช้จึงจะไม่ได้รับเมล

Render ฟรี**บล็อกพอร์ต 25, 465 และ 587** จึงส่งผ่าน Gmail ไม่ได้ ให้ใช้ [Brevo](https://www.brevo.com) (ฟรีวันละ 300 ฉบับ) ซึ่งรับพอร์ต 2525 แทน:

1. สมัคร Brevo แล้วยืนยันอีเมลผู้ส่งที่จะใช้ (Senders)
2. หน้า SMTP & API → สร้าง SMTP key แล้วจด SMTP login กับ key ไว้
3. Render → Environment → เพิ่มตัวแปรเหล่านี้:

   | ตัวแปร | ค่า |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `2525` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | SMTP login จาก Brevo |
   | `SMTP_PASS` | SMTP key จาก Brevo |
   | `MAIL_FROM` | `CineBook <อีเมลผู้ส่งที่ยืนยันแล้ว>` |

ถ้าใช้ Render แบบเสียเงิน จะใช้ Gmail (พอร์ต 587 + App Password) ตามที่อธิบายใน `server/.env.example` ได้เลย

## 10. ตรวจหลัง deploy

- [ ] `<URL Render>/api/health` และ `<URL Vercel>/api/health` ได้ `"ok": true` ทั้งคู่
- [ ] ล็อกอินบนหน้าเว็บแล้วกดรีเฟรช ต้องยังล็อกอินอยู่ (ถ้าหลุด ดูข้อ 13)
- [ ] เปิด `<URL Vercel>/my-bookings` ตรง ๆ แล้วรีเฟรช ต้องไม่เจอหน้า 404
- [ ] จองที่นั่งแล้วส่งสลิป ใน Supabase → Storage → `slips` ต้องมีไฟล์ใหม่ใต้ `payments/`
- [ ] ล็อกอินเป็นผู้ดูแล ต้องเปิดดูสลิปใบนั้นได้ และอนุมัติแล้วได้ใบเสร็จ
- [ ] Logs ของ Render ไม่มีคำเตือน `⚠️`

---

## 11. อัปเดตครั้งต่อไป

- push เข้า `main` แล้วทั้งสองฝั่งจะ deploy ให้เอง (Render จะ build ใหม่เฉพาะเมื่อไฟล์ใน `server/` เปลี่ยน)
- แก้ `schema.prisma` เมื่อไหร่ ต้องสร้าง migration ในเครื่องก่อนเสมอด้วย `npm run db:migrate` แล้ว commit โฟลเดอร์ migration ไปด้วย Render จะรัน migration ใหม่ให้ตอน build
- อย่าแก้โครงสร้างตารางในฐานจริงด้วยมือ (เช่นผ่าน Table Editor ของ Supabase) เพราะ migration ถัดไปจะชนกับสิ่งที่แก้ไว้

## 12. รีเซ็ตเดโม (รัน seed ซ้ำ)

รันคำสั่งเดิมในข้อ 4 ซ้ำได้ทุกเมื่อ เช่น เมื่อรอบฉายตัวอย่างหมด (seed สร้างรอบล่วงหน้าแค่ 7 วันนับจากวันที่รัน) แต่ทุกครั้งเท่ากับเริ่มระบบใหม่ทั้งหมด:

- ผู้ใช้ที่สมัครเอง การจอง การชำระเงิน ใบเสร็จ และแจ้งเตือน**หายหมด** และทุกคนหลุดล็อกอิน
- รหัสบัญชีเดโมเปลี่ยนเป็น `SEED_PASSWORD` ที่ตั้งในรอบนั้น (ถ้าไม่ตั้งจะกลับเป็น `Password123`)
- เลขใบเสร็จเริ่มนับจาก 000001 ใหม่
- รูปสลิปเดิมใน bucket **ไม่ถูกลบตาม** ถ้าต้องการให้ว่าง ไปที่ Supabase → Storage → `slips` แล้วลบโฟลเดอร์ `payments` และ `refunds`

**ห้ามรันเมื่อมีผู้ใช้จริงแล้ว** และห้ามใส่ seed ไว้ในคำสั่ง build หรือ start ของ Render

## 13. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| build บน Render ล้มด้วย `P1001: Can't reach database server` | ใช้ connection string แบบ Direct (IPv6) ให้เปลี่ยนเป็น Session pooler (ข้อ 2.2) หรือ project ของ Supabase ถูกพักอยู่ |
| build ล้มด้วย `prisma: not found` | คำสั่ง build ไม่มี `--include=dev` ให้ใช้คำสั่งตาม `render.yaml` |
| Logs มี `max clients reached` | `DATABASE_URL` ไม่ได้ต่อท้าย `?connection_limit=5` |
| เซิร์ฟเวอร์ไม่ขึ้น และ Logs มี `ตั้งค่า environment ไม่ถูกต้อง` | บรรทัดถัดไปจะบอกชื่อตัวแปรที่ผิด ให้แก้ที่ Render → Environment |
| เปิดลิงก์ลึกหรือรีเฟรชแล้วเจอ 404 ของ Vercel | Root Directory ไม่ได้ตั้งเป็น `client` หรือไม่มีไฟล์ `client/vercel.json` |
| รีเฟรชแล้วหลุดล็อกอิน | request ไม่ได้ผ่าน Vercel (เช่น แก้โค้ดให้เรียก URL Render ตรง) cookie จึงไม่ถูกส่ง |
| ทุก request error และ Logs ของ Vercel มี `ROUTER_EXTERNAL_TARGET_ERROR` | URL ใน `client/vercel.json` ผิด หรือ Render ตื่นช้าเกิน 120 วินาที (ลองใหม่อีกครั้ง หรือทำข้อ 8) |
| Logs มี `⚠️  ยังเก็บสลิปลงดิสก์` หรือเปิดสลิปแล้วได้ 404 `SLIP_FILE_MISSING` | ยังไม่ได้ตั้ง `SUPABASE_URL` / `SUPABASE_SECRET_KEY` สลิปที่ส่งเข้ามาช่วงนั้นถูกเก็บบนดิสก์ของ Render และหายไปแล้ว |
| Supabase แจ้งว่า project ถูกพัก (paused) | ไม่มีการใช้งาน 7 วัน ให้กด Restore ในหน้า project แล้วทำข้อ 8 กันไว้ |
