import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isDev } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { parseTrustProxy } from './utils/trustProxy.js';

import authRoutes from './routes/auth.js';
import movieRoutes from './routes/movies.js';
import showtimeRoutes from './routes/showtimes.js';
import bookingRoutes from './routes/bookings.js';
import paymentRoutes from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';

export const createApp = () => {
  const app = express();

  // req.ip ใช้เป็นกุญแจของ rate limit ทุกตัว ต้องเชื่อ X-Forwarded-For เฉพาะ proxy ที่ตั้งไว้จริงเท่านั้น
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  // security headers มาตรฐาน — สำคัญสุดคือ nosniff: รูปสลิปที่ส่งออกไปต้องไม่ถูกเบราว์เซอร์เดาเป็น HTML/สคริปต์
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true, // จำเป็นสำหรับ refresh token cookie
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (isDev) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'theatre-reservation-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/movies', movieRoutes);
  app.use('/api/showtimes', showtimeRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
