import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isDev } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireProxy } from './middleware/requireProxy.js';
import { parseTrustProxy } from './utils/trustProxy.js';

import authRoutes from './routes/auth.js';
import movieRoutes from './routes/movies.js';
import showtimeRoutes from './routes/showtimes.js';
import bookingRoutes from './routes/bookings.js';
import seatChangeRoutes from './routes/seatChanges.js';
import paymentRoutes from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';

/** proxySecret ส่งเข้ามาเองได้ (เทสต์ใช้เปิดการบังคับ) — ไม่ส่งใช้ PROXY_SECRET จาก .env */
export const createApp = ({ proxySecret = env.PROXY_SECRET } = {}) => {
  const app = express();

  // req.ip ใช้เป็นกุญแจของ rate limit ทุกตัว ต้องเชื่อ X-Forwarded-For เฉพาะ proxy ที่ตั้งไว้จริงเท่านั้น
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  // security headers มาตรฐาน — สำคัญสุดคือ nosniff: รูปสลิปที่ส่งออกไปต้องไม่ถูกเบราว์เซอร์เดาเป็น HTML/สคริปต์
  app.use(helmet());
  // ก่อน CORS และการอ่าน body — คำขอที่ไม่ได้มาทางหน้าเว็บถูกปัดตกโดยไม่ต้องเสียแรง parse อะไรเลย
  app.use(requireProxy(proxySecret));
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true, // จำเป็นสำหรับ refresh token cookie
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (isDev) app.use(morgan('dev'));

  app.get('/api/health', (req, res) => {
    const forwardedFor = String(req.headers['x-forwarded-for'] ?? '');
    res.json({
      ok: true,
      service: 'theatre-reservation-api',
      time: new Date().toISOString(),
      // ไว้ตั้ง TRUST_PROXY ตอนขึ้นระบบจริง (ดู DEPLOY.md) — เปิดผ่าน URL หน้าเว็บแล้วตั้ง TRUST_PROXY = proxyHops
      // Vercel เขียนทับ X-Forwarded-For ให้เหลือแค่ไอพีของผู้ใช้ จำนวนรายการที่เห็นจึงเท่ากับจำนวน proxy ที่ต้องเชื่อพอดี
      // ตั้งถูกแล้ว ip ต้องเป็นไอพีจริงของผู้เรียก ไม่ใช่ไอพีของ proxy ตัวใดตัวหนึ่ง
      ip: req.ip,
      proxyHops: forwardedFor.split(',').filter((part) => part.trim()).length,
      // ไว้ตรวจการตั้ง PROXY_SECRET (ดู DEPLOY.md) — เปิดผ่าน URL หน้าเว็บ: ตั้งฝั่ง Vercel แล้วต้องได้ unchecked
      // ตั้งครบทั้งสองฝั่งต้องได้ valid · ค่าทั้งหมดดูใน middleware/requireProxy.js
      proxySecret: req.proxySecret,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/movies', movieRoutes);
  app.use('/api/showtimes', showtimeRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/seat-changes', seatChangeRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
