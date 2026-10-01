import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** โฟลเดอร์ราก ของ workspace `server` */
export const SERVER_ROOT = path.resolve(currentDir, '../..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'ต้องกำหนด DATABASE_URL ใน server/.env'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET สั้นเกินไป'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET สั้นเกินไป'),
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

  PROMPTPAY_ID: z.string().min(8).default('0812345678'),
  PROMPTPAY_MERCHANT_NAME: z.string().default('THEATRE RESERVATION'),

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
});

const parsed = envSchema.safeParse(process.env);

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
