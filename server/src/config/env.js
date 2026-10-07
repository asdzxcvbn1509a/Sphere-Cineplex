import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** โฟลเดอร์ราก ของ workspace `server` */
export const SERVER_ROOT = path.resolve(currentDir, '../..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

/** เลขพร้อมเพย์ตัวอย่างใน .env.example — ขึ้นระบบจริงแล้วยังเป็นเลขนี้ index.js จะเตือนตอนเปิดเครื่อง */
export const SAMPLE_PROMPTPAY_ID = '0812345678';

/**
 * JWT secret ที่ยังเป็นค่าตัวอย่างจาก .env.example / .env.test.example — ใครเปิด repo ก็เห็นค่าเหล่านี้
 * ถ้าหลุดไปถึง production ใครก็เซ็น access token ปลอมได้เอง
 */
const isSampleSecret = (value) => {
  const secret = String(value ?? '');
  return secret.startsWith('replace_me') || secret.endsWith('_not_for_production');
};

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'ต้องกำหนด DATABASE_URL ใน server/.env' })
    .min(1, 'ต้องกำหนด DATABASE_URL ใน server/.env'),
  PORT: z.coerce.number().int().positive().default(4000),
  // ไม่ตั้ง = production เพราะโหมด development เปิดของที่ไม่ควรมีบนระบบจริง (ลิงก์ตั้งรหัสผ่านใน API, stack trace, cookie ไม่ Secure)
  // ลืมตั้งบนโฮสต์ใหม่จึงได้โหมดที่ปลอดภัยไว้ก่อน — .env.example ตั้ง development ไว้ให้เครื่องที่ใช้พัฒนาแล้ว
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z
    .string({ error: 'ต้องกำหนด JWT_ACCESS_SECRET ใน server/.env' })
    .min(16, 'JWT_ACCESS_SECRET สั้นเกินไป'),
  JWT_REFRESH_SECRET: z
    .string({ error: 'ต้องกำหนด JWT_REFRESH_SECRET ใน server/.env' })
    .min(16, 'JWT_REFRESH_SECRET สั้นเกินไป'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // ยิ่งสูงยิ่งเดารหัสผ่านยาก แต่ล็อกอินก็ช้าลงตามตัว 10 คือจุดที่ยังไม่รู้สึกหน่วง
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),
  // ล็อกอินผิดได้กี่ครั้งต่อ (ไอพี + บัญชี) ในกรอบเวลาด้านล่าง — ครั้งที่สำเร็จไม่ถูกนับ
  LOGIN_LIMIT: z.coerce.number().int().positive().default(10),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // สมัครสมาชิกได้กี่บัญชีต่อไอพี ในกรอบเวลาด้านล่าง (นับเฉพาะครั้งที่สมัครสำเร็จ)
  // ตั้งไว้กันบอทสมัครทีละพัน ไม่ใช่กันคนจริง — ออฟฟิศหรือห้างที่ออกเน็ตไอพีเดียวกันต้องยังสมัครได้
  REGISTER_LIMIT: z.coerce.number().int().positive().default(50),
  REGISTER_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  // อายุลิงก์ตั้งรหัสผ่านใหม่ — สั้นพอที่ลิงก์หลุดทีหลังแล้วใช้ไม่ได้ แต่ยาวพอให้คนเปิดเมลทัน
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // ขอลิงก์ได้กี่ครั้งต่อ (ไอพี + อีเมล) ในกรอบเวลาด้านล่าง — กันคนเอาระบบไปถล่มเมลคนอื่นเล่น
  PASSWORD_RESET_LIMIT: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),

  SEAT_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  REJECTED_RETRY_MINUTES: z.coerce.number().int().positive().default(10),
  CANCEL_CUTOFF_HOURS: z.coerce.number().int().nonnegative().default(3),
  MAX_SEATS_PER_BOOKING: z.coerce.number().int().positive().default(8),
  // การจองที่ยังถือที่นั่งไว้พร้อมกันได้กี่รายการต่อคน (รอชำระ + รอตรวจสลิป)
  // กันบัญชีเดียววนจองกักที่นั่งไว้ทั้งโรงโดยไม่จ่าย — คนจองจริงแทบไม่เคยค้างเกิน 1-2 รายการ
  MAX_PENDING_BOOKINGS_PER_USER: z.coerce.number().int().positive().default(3),
  // หลังหมดเวลาชำระเงินแล้วยังส่งสลิปได้อีกกี่นาที (0 = ปิด) — สำหรับคนที่โอนแล้วแต่ส่งหลักฐานไม่ทัน
  // ที่นั่งยังว่างก็ได้ที่นั่งเดิมคืน ไม่ว่างแล้วผู้ดูแลยืนยันยอดแล้วคืนเงินให้ เงินจึงไม่หลุดนอกระบบ
  // (ใช้กับสลิปส่วนต่างของการเปลี่ยนที่นั่งด้วย)
  LATE_SLIP_GRACE_MINUTES: z.coerce.number().int().nonnegative().default(30),
  // ลูกค้าเปลี่ยนที่นั่งเองได้ถึงก่อนรอบฉายกี่นาที — ย้ายในโซนเดิมไม่มีเงินเกี่ยว จึงผ่อนกว่าการยกเลิก (CANCEL_CUTOFF_HOURS)
  SEAT_CHANGE_CUTOFF_MINUTES: z.coerce.number().int().nonnegative().default(30),
  // ลูกค้าเปลี่ยนที่นั่งเองได้กี่ครั้งต่อการจอง — กันการสลับไปมาจนที่นั่งกระพริบให้คนอื่นจองไม่ได้
  // (คำขอที่หมดเวลา/ยกเลิกไม่นับ และผู้ดูแลย้ายให้ไม่นับ)
  MAX_SEAT_CHANGES_PER_BOOKING: z.coerce.number().int().positive().default(2),

  PROMPTPAY_ID: z.string().min(8).default(SAMPLE_PROMPTPAY_ID),
  PROMPTPAY_MERCHANT_NAME: z.string().default('THEATRE RESERVATION'),

  // ---------- ใบเสร็จรับเงิน ----------
  // ชื่อผู้ออกใบเสร็จ ใช้ทั้งหน้าใบเสร็จและอีเมล — ค่าเริ่มต้นตรงกับชื่อที่ลูกค้าเห็นบนหน้าเว็บ (common.appName)
  RECEIPT_ISSUER_NAME: z.string().trim().min(1).default('Sphere Cineplex'),
  // ที่อยู่ผู้ออกใบเสร็จ — ไม่ตั้ง = ไม่แสดงบรรทัดที่อยู่บนใบเสร็จ
  RECEIPT_ISSUER_ADDRESS: z.string().trim().optional(),

  // ---------- อีเมลขาออก ----------
  // ไม่ตั้ง SMTP_HOST = ยังไม่ส่งอีเมลจริง ระบบจะพิมพ์เนื้อเมลลง console ให้แทน (ใช้ตอนพัฒนา)
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // 'true' = เข้ารหัสตั้งแต่เชื่อมต่อ (พอร์ต 465) · ไม่ตั้งมาจะเดาจากพอร์ตให้เอง
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Theatre Reservation <no-reply@localhost>'),
  // ฐานของลิงก์ในอีเมล ต้องเป็น URL ที่ผู้ใช้เปิดได้จากเครื่องตัวเอง — ไม่ตั้งมาจะใช้ CLIENT_ORIGIN
  APP_URL: z.string().optional(),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_SLIP_SIZE_MB: z.coerce.number().positive().default(5),

  // ---------- ที่เก็บสลิปบน Supabase Storage ----------
  // ไม่ตั้ง SUPABASE_URL = เก็บสลิปลงดิสก์ใต้ UPLOAD_DIR (ใช้ตอนพัฒนาและรันเทสต์)
  // โฮสต์ที่ดิสก์ไม่ถาวร (เช่น Render) ต้องตั้ง ไม่งั้นสลิปหายทุกครั้งที่ deploy หรือ restart
  SUPABASE_URL: z.string().trim().url('SUPABASE_URL ต้องเป็น URL เช่น https://<ref>.supabase.co').optional(),
  // secret key (sb_secret_…) หรือ service_role key แบบเดิม — ข้าม RLS ได้ทั้งหมด จึงอยู่ฝั่ง server เท่านั้น
  SUPABASE_SECRET_KEY: z.string().trim().min(1).optional(),
  // ต้องเป็น bucket แบบ private — สลิปเปิดดูได้ผ่าน API ที่ตรวจสิทธิ์เท่านั้น
  SUPABASE_SLIP_BUCKET: z.string().trim().min(1).default('slips'),

  // ใครอยู่หน้า API บ้าง — ใช้ตัดสินว่าจะเชื่อ X-Forwarded-For แค่ไหน (ดู utils/trustProxy.js)
  // ค่าเริ่มต้น loopback = เชื่อเฉพาะ reverse proxy บนเครื่องเดียวกัน ปลอดภัยทั้งตอนพัฒนาและตอนขึ้นจริงแบบทั่วไป
  TRUST_PROXY: z.string().default('loopback'),
  // secret ที่ proxy ของหน้าเว็บ (Vercel) แนบมากับทุกคำขอ — ตั้งแล้ว API รับเฉพาะคำขอที่มาทางหน้าเว็บ (ดู middleware/requireProxy.js)
  // ไม่ตั้ง = รับทุกคำขอเหมือนเดิม (ตอนพัฒนาและรันเทสต์)
  PROXY_SECRET: z.string().trim().min(32, 'PROXY_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร').optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      if (isSampleSecret(value[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'ยังเป็นค่าตัวอย่างจาก .env.example — สร้างค่าสุ่มใหม่ก่อนขึ้นระบบจริง',
        });
      }
    }
  }
  // ตั้งมาแค่ครึ่งเดียวถือว่าตั้งผิด — ปล่อยผ่านเงียบ ๆ แล้วสลิปตกไปอยู่บนดิสก์ จะรู้ตัวอีกทีก็ตอนสลิปหายหลัง deploy
  if (Boolean(value.SUPABASE_URL) !== Boolean(value.SUPABASE_SECRET_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: [value.SUPABASE_URL ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_URL'],
      message: 'ต้องตั้ง SUPABASE_URL และ SUPABASE_SECRET_KEY คู่กัน (หรือเว้นว่างทั้งคู่เพื่อเก็บสลิปลงดิสก์)',
    });
  }
});

/**
 * ค่าที่เป็นสตริงว่างถือว่า "ไม่ได้ตั้ง" — .env.example มีบรรทัดอย่าง `SMTP_HOST=` ไว้ให้เติมทีหลัง
 * ถ้าส่งสตริงว่างเข้า zod ตรง ๆ ช่องที่เป็น optional แต่มีเงื่อนไข (min(1), enum) จะไม่ผ่าน
 * แล้วเซิร์ฟเวอร์เปิดไม่ขึ้นทั้งที่คัดลอก .env.example ไปใช้ตามขั้นตอนใน README ทุกอย่าง
 */
const definedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

const parsed = envSchema.safeParse(definedEnv);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n❌ ตั้งค่า environment ไม่ถูกต้อง (server/.env)\n${details}\n`);
  console.error('   คัดลอกจาก server/.env.example แล้วแก้ค่าให้ครบก่อนรันใหม่\n');
  process.exit(1);
}

export const env = parsed.data;

export const isDev = env.NODE_ENV === 'development';

/** ตั้ง SMTP_HOST แล้วเท่านั้นถึงจะส่งอีเมลจริง ไม่งั้น mailer จะพิมพ์ลง console ให้แทน */
export const isMailConfigured = Boolean(env.SMTP_HOST);

/** ตั้ง SUPABASE_URL แล้วสลิปไปอยู่บน Supabase Storage ไม่งั้นเก็บลงดิสก์ใต้ UPLOAD_DIR (ดู lib/slipStorage.js) */
export const isSupabaseConfigured = Boolean(env.SUPABASE_URL);

/**
 * ไม่ใช้ z.coerce.boolean() เพราะ coerce ตีความสตริง 'false' เป็น true
 * (สตริงที่ไม่ว่างทุกตัวเป็น truthy) ซึ่งจะพังแบบเงียบ ๆ ตอนตั้ง SMTP_SECURE=false
 */
export const SMTP_SECURE = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465;

/** ตัด / ท้าย URL ทิ้ง ลิงก์ในอีเมลจะได้ไม่กลายเป็น //reset-password */
export const APP_URL = (env.APP_URL || env.CLIENT_ORIGIN).replace(/\/+$/, '');

/** โฟลเดอร์เก็บไฟล์อัปโหลด (absolute) */
export const UPLOAD_ROOT = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.join(SERVER_ROOT, env.UPLOAD_DIR);

export const SLIP_DIR = path.join(UPLOAD_ROOT, 'slips');
/**
 * แยกโฟลเดอร์ตามคนอัปโหลด เพราะสองอย่างนี้เป็นคนละเรื่องกัน
 * payments = สลิปที่ลูกค้าโอนเงินเข้ามา · refunds = สลิปที่ผู้ดูแลโอนคืนให้ลูกค้า
 * เวลาเปิดดูโฟลเดอร์หรือทำ backup/ล้างไฟล์จะได้ไม่ปนกันจนแยกไม่ออกว่าไฟล์ไหนของใคร
 */
export const PAYMENT_SLIP_DIR = path.join(SLIP_DIR, 'payments');
export const REFUND_SLIP_DIR = path.join(SLIP_DIR, 'refunds');
