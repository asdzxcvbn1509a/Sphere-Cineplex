import { createApp } from './app.js';
import { env, isSupabaseConfigured, SLIP_DIR } from './config/env.js';
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
