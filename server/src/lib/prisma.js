import { PrismaClient } from '@prisma/client';
import { isDev } from '../config/env.js';

// `node --watch` รีสตาร์ททั้ง process อยู่แล้ว แต่เก็บไว้บน globalThis กัน client ซ้ำ
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) globalForPrisma.__prisma = prisma;

export default prisma;
