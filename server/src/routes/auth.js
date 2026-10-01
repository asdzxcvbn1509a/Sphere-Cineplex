import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';

// controllers
import {
  register,
  login,
  refresh,
  logout,
  me,
  updateMe,
  changePassword,
  forgotPassword,
  checkResetLink,
  resetPassword,
} from '../controllers/auth.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { MAX_PASSWORD_LENGTH, passwordSchema } from '../utils/password.js';
import { env } from '../config/env.js';

const router = express.Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'กรุณากรอกชื่อ').max(60),
  email: z.email('อีเมลไม่ถูกต้อง').max(120),
  phone: z.string().trim().min(9, 'กรุณากรอกเบอร์โทรศัพท์').max(20),
  password: passwordSchema,
});

const loginSchema = z.object({
  // ช่องเดียวรับได้ทั้งอีเมลและเบอร์โทร ผู้ใช้จะได้ไม่ต้องจำว่าสมัครไว้ด้วยอะไร
  identifier: z.string().trim().min(4, 'กรุณากรอกอีเมลหรือเบอร์โทรศัพท์').max(120),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน').max(MAX_PASSWORD_LENGTH),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน').max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: z.email('อีเมลไม่ถูกต้อง').max(120),
  lang: z.enum(['th', 'en']).optional(),
});

// ปล่อยให้ service เป็นคนตัดสินว่าลิงก์ใช้ได้ไหม จะได้ตอบเป็นรหัส RESET_LINK_* เหมือนกันทุกกรณี
// ไม่ใช่บางกรณีเป็น 422 ของ zod บางกรณีเป็น 400 ซึ่งหน้าเว็บต้องไปแยกเองสองทาง
const resetTokenSchema = z.string().trim().min(1, 'ลิงก์ไม่ถูกต้อง').max(200);

const resetCheckSchema = z.object({ token: resetTokenSchema });

const resetPasswordSchema = z.object({
  token: resetTokenSchema,
  password: passwordSchema,
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(60).optional(),
  email: z.email('อีเมลไม่ถูกต้อง').max(120).optional(),
});

/**
 * กันการยิงเดารหัสผ่าน — นับเฉพาะครั้งที่ล็อกอินไม่ผ่าน (skipSuccessfulRequests)
 * คนที่ใช้งานปกติจึงไม่มีวันโดนบล็อก แม้จะเข้าออกบ่อยแค่ไหน
 *
 * นับแยกตาม "ไอพี + บัญชีที่พยายามเข้า" เพื่อไม่ให้คนร้ายยิงบัญชีเดียวจนล็อก
 * เจ้าของตัวจริงที่อยู่คนละไอพีเข้าไม่ได้ไปด้วย
 */
const loginLimiter = rateLimit({
  windowMs: env.LOGIN_WINDOW_MINUTES * 60 * 1000,
  limit: env.LOGIN_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const identifier = String(req.body?.identifier ?? '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${identifier}`;
  },
  message: {
    error: {
      code: 'LOGIN_RATE_LIMITED',
      message: 'พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

/**
 * กันสคริปต์สมัครบัญชีรัว ๆ จากไอพีเดียว
 * นับเฉพาะครั้งที่สมัครสำเร็จ (skipFailedRequests) — คนที่กรอกผิดหรือสมัครซ้ำหลายรอบ
 * จะได้ไม่โดนบล็อกทั้งที่ยังไม่ได้บัญชีสักใบ
 */
const registerLimiter = rateLimit({
  windowMs: env.REGISTER_WINDOW_MINUTES * 60 * 1000,
  limit: env.REGISTER_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipFailedRequests: true,
  message: {
    error: {
      code: 'REGISTER_RATE_LIMITED',
      message: 'สมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

/**
 * กันการเดา "รหัสผ่านปัจจุบัน" จากเซสชันที่ถูกขโมยไป
 * นับรายบัญชี ไม่ใช่รายไอพี เพราะคนร้ายที่ถือ token อยู่ย้ายไอพีได้ง่ายกว่าเปลี่ยนบัญชี
 */
const changePasswordLimiter = rateLimit({
  windowMs: env.LOGIN_WINDOW_MINUTES * 60 * 1000,
  limit: env.LOGIN_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  message: {
    error: {
      code: 'LOGIN_RATE_LIMITED',
      message: 'กรอกรหัสผ่านปัจจุบันผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

/**
 * กันเอาระบบไปถล่มเมลคนอื่นเล่น และกันไล่เช็กว่าอีเมลไหนมีบัญชีในระบบ
 *
 * นับตาม (ไอพี + อีเมล) ไม่ใช่อีเมลอย่างเดียว ไม่งั้นคนร้ายยิงขอลิงก์ของเหยื่อรัว ๆ
 * จนเต็มโควตา เจ้าของตัวจริงก็จะขอลิงก์ไม่ได้ กลายเป็นล็อกไม่ให้เขากู้บัญชีเสียเอง
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: env.PASSWORD_RESET_WINDOW_MINUTES * 60 * 1000,
  limit: env.PASSWORD_RESET_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
  message: {
    error: {
      code: 'RESET_RATE_LIMITED',
      message: 'ขอลิงก์ตั้งรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

/**
 * token สุ่ม 32 ไบต์เดาไม่ได้อยู่แล้ว ตัวนี้จึงเป็นแค่กันเหนียวไม่ให้ใครยิงถี่ ๆ ใส่ endpoint นี้
 * ตั้งไว้หลวมพอที่คนกดลิงก์แล้วรีเฟรชหน้าหลายรอบจะไม่โดนบล็อก
 */
const resetPasswordLimiter = rateLimit({
  windowMs: env.PASSWORD_RESET_WINDOW_MINUTES * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RESET_RATE_LIMITED',
      message: 'ลองตั้งรหัสผ่านใหม่บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

// @ENDPOINT http://localhost:4000/api/auth/register
router.post('/register', registerLimiter, validate({ body: registerSchema }), register);
// @ENDPOINT http://localhost:4000/api/auth/login
router.post('/login', loginLimiter, validate({ body: loginSchema }), login);
// @ENDPOINT http://localhost:4000/api/auth/forgot-password
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPassword,
);
/**
 * token อยู่ใน body ไม่ใช่ใน path เพราะ path ไปโผล่ใน access log ของเซิร์ฟเวอร์
 * (morgan บันทึก method + path ทุก request) ส่วน body ไม่ถูกบันทึก
 */
// @ENDPOINT http://localhost:4000/api/auth/reset-password/check
router.post(
  '/reset-password/check',
  resetPasswordLimiter,
  validate({ body: resetCheckSchema }),
  checkResetLink,
);
// @ENDPOINT http://localhost:4000/api/auth/reset-password
router.post(
  '/reset-password',
  resetPasswordLimiter,
  validate({ body: resetPasswordSchema }),
  resetPassword,
);
// @ENDPOINT http://localhost:4000/api/auth/refresh
router.post('/refresh', refresh);
// @ENDPOINT http://localhost:4000/api/auth/logout
router.post('/logout', logout);
// @ENDPOINT http://localhost:4000/api/auth/me
router.get('/me', authenticate, me);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), updateMe);
// @ENDPOINT http://localhost:4000/api/auth/password
router.patch(
  '/password',
  authenticate,
  changePasswordLimiter,
  validate({ body: changePasswordSchema }),
  changePassword,
);

export default router;
