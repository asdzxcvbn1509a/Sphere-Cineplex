import { PrismaClient } from '@prisma/client';
import { env, isDev } from '../config/env.js';

// `node --watch` รีสตาร์ททั้ง process อยู่แล้ว แต่เก็บไว้บน globalThis กัน client ซ้ำ
const globalForPrisma = globalThis;

// ตอนเทสต์ไม่ต้อง log — หลายเคสตั้งใจให้ชน unique constraint แล้วดูว่าระบบตอบ 409 ถูกไหม
const logLevels = { development: ['warn', 'error'], production: ['error'], test: [] };

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: logLevels[env.NODE_ENV] ?? ['error'],
  });

if (isDev) globalForPrisma.__prisma = prisma;

export default prisma;
