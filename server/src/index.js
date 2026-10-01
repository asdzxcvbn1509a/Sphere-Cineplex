import { createApp } from './app.js';
import { env } from './config/env.js';
import prisma from './lib/prisma.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs/index.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`\n🎬  Theatre Reservation API`);
  console.log(`    http://localhost:${env.PORT}/api/health  (${env.NODE_ENV})`);
  console.log(`    อนุญาต origin: ${env.CLIENT_ORIGIN}\n`);
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
