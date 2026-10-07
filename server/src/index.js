import { createApp } from './app.js';
import {
  env,
  isMailConfigured,
  isSupabaseConfigured,
  SAMPLE_PROMPTPAY_ID,
  SLIP_DIR,
} from './config/env.js';
import prisma from './lib/prisma.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs/index.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`\n🎬  Theatre Reservation API`);
  console.log(`    http://localhost:${env.PORT}/api/health  (${env.NODE_ENV})`);
  console.log(`    อนุญาต origin: ${env.CLIENT_ORIGIN}`);
  console.log(
    `    ที่เก็บสลิป: ${isSupabaseConfigured ? `Supabase Storage (bucket ${env.SUPABASE_SLIP_BUCKET})` : SLIP_DIR}\n`,
  );
  if (env.NODE_ENV === 'production' && !isSupabaseConfigured) {
    // โฮสต์ส่วนใหญ่ (เช่น Render) ล้างดิสก์ทุกครั้งที่ deploy/restart — DB ยังอ้างถึงสลิปแต่ไฟล์หายไปแล้ว
    console.warn(
      '⚠️  ยังเก็บสลิปลงดิสก์ ถ้าโฮสต์นี้ไม่มีดิสก์ถาวร สลิปจะหายทุกครั้งที่ deploy หรือ restart\n' +
        '    ตั้ง SUPABASE_URL และ SUPABASE_SECRET_KEY เพื่อเก็บบน Supabase Storage แทน\n',
    );
  }
  if (env.NODE_ENV === 'production' && !isMailConfigured) {
    // production ไม่พิมพ์เนื้อเมลลง log (ดู utils/mailer.js) — ไม่ตั้ง SMTP = ลิงก์ลืมรหัสผ่านและใบเสร็จไม่ถึงใครเลย
    console.warn(
      '⚠️  ยังไม่ได้ตั้ง SMTP_HOST — อีเมลลืมรหัสผ่านและใบเสร็จจะไม่ถูกส่ง\n' +
        '    ลูกค้าที่ลืมรหัสผ่านต้องให้ผู้ดูแลตั้งรหัสชั่วคราวให้ที่หน้าจัดการผู้ใช้\n',
    );
  }
  if (env.NODE_ENV === 'production' && env.PROMPTPAY_ID === SAMPLE_PROMPTPAY_ID) {
    // เตือนแต่ไม่หยุดระบบ — เว็บเดโมอาจตั้งใจใช้เลขตัวอย่าง ไม่ให้มีใครโอนเงินจริง
    console.warn(
      `⚠️  PROMPTPAY_ID ยังเป็นเลขตัวอย่าง ${SAMPLE_PROMPTPAY_ID} — ถ้าเปิดขายจริง ลูกค้าที่สแกน QR จะโอนเงินเข้าเลขนี้\n`,
    );
  }
  startBackgroundJobs();
});

const shutdown = async (signal) => {
  console.log(`\n${signal} — กำลังปิดระบบ...`);
  stopBackgroundJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
