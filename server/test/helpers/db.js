import { execFileSync } from 'node:child_process';
import path from 'node:path';
import prisma from '../../src/lib/prisma.js';
import { SERVER_ROOT, isMailConfigured } from '../../src/config/env.js';

/**
 * ด่านกันพัง — เทสต์ล้างทุกตารางก่อนแต่ละเคส ถ้าเผลอชี้ไปฐาน dev ข้อมูลจริงหายหมด
 * และถ้า SMTP ถูกตั้งไว้ เทสต์ลืมรหัสผ่านจะส่งอีเมลจริงออกไป
 */
const assertSafeEnvironment = () => {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '';
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `integration test ต้องรันกับฐานข้อมูลที่ชื่อลงท้ายด้วย _test เท่านั้น (ตอนนี้คือ "${dbName}") — ตรวจ server/.env.test`,
    );
  }
  if (isMailConfigured) {
    throw new Error('SMTP_HOST ถูกตั้งไว้ระหว่างเทสต์ — ใส่ SMTP_HOST= (ว่าง) ใน server/.env.test');
  }
};

let migrated = false;

/** สร้างฐาน (ถ้ายังไม่มี) และรัน migration ให้ล่าสุด — ทำครั้งเดียวต่อไฟล์เทสต์ */
export const setupDatabase = () => {
  assertSafeEnvironment();
  if (migrated) return;
  try {
    execFileSync(
      process.execPath,
      [path.join(SERVER_ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      { cwd: SERVER_ROOT, env: process.env, stdio: 'pipe' },
    );
  } catch (error) {
    throw new Error(`prisma migrate deploy ล้มเหลว:\n${error.stderr?.toString() ?? error.message}`);
  }
  migrated = true;
};

const TABLES = [
  'Notification',
  'Payment',
  'BookingSeat',
  'Booking',
  'ZonePrice',
  'Showtime',
  'Seat',
  'Theatre',
  'Movie',
  'PasswordResetToken',
  'RefreshToken',
  'User',
];

/** ล้างข้อมูลทุกตาราง ให้แต่ละเคสเริ่มจากฐานว่างเหมือนกัน */
export const resetDb = async () => {
  assertSafeEnvironment();
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

/** ปิด connection pool — ไม่งั้น process ของไฟล์เทสต์ค้างไม่ยอมจบ */
export const disconnectDb = () => prisma.$disconnect();
