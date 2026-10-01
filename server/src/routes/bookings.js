import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

// controllers
import {
  createBooking,
  listMyBookings,
  getBooking,
  getTicket,
  cancelBooking,
  updateRefundAccount,
} from '../controllers/bookings.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();
router.use(authenticate);

const createBookingSchema = z.object({
  showtimeId: z.string().min(1, 'ต้องระบุรอบฉาย'),
  seatIds: z.array(z.string().min(1)).min(1, 'กรุณาเลือกที่นั่งอย่างน้อย 1 ที่'),
});

const listQuerySchema = z.object({
  scope: z.enum(['all', 'upcoming', 'history']).optional(),
});

// เลขบัญชีไทยมี 10-15 หลัก ผู้ใช้มักพิมพ์ขีดหรือเว้นวรรคมาด้วย จึงตัดทิ้งก่อนตรวจ
const accountNoSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^[0-9]{10,15}$/.test(value), 'เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก');

const bankNameSchema = z.string().trim().min(2, 'กรุณาระบุธนาคาร').max(60);

const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional(),
  // บัญชีสำหรับรับเงินคืน — จำเป็นเฉพาะการจองที่ชำระเงินไปแล้ว (service เป็นคนบังคับ)
  refundBankName: bankNameSchema.optional(),
  refundAccountNo: accountNoSchema.optional(),
});

// แจ้งบัญชีภายหลัง (ใบที่ผู้ดูแลยกเลิกแทน) — มาทีหลังจึงต้องส่งครบทั้งคู่
const refundAccountSchema = z.object({
  refundBankName: bankNameSchema,
  refundAccountNo: accountNoSchema,
});

/**
 * กันสคริปต์จอง-ยกเลิกวนเพื่อกักที่นั่ง — ด่านหลักคือเพดานการจองค้างใน service (MAX_PENDING_BOOKINGS_PER_USER)
 * ตัวนี้กันอีกชั้นที่เพดานไม่ครอบคลุม: จองแล้วยกเลิกทันทีซ้ำ ๆ ทำให้ที่นั่งกระพริบจนคนอื่นจองไม่ได้
 * นับต่อบัญชี (ผ่าน authenticate มาแล้ว) และนับเฉพาะครั้งที่จองสำเร็จ — ชน SEAT_TAKEN ไม่เสียโควตา
 */
const createBookingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: (req) => req.user.id,
  message: {
    error: {
      code: 'BOOKING_RATE_LIMITED',
      message: 'ทำรายการจองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

// @ENDPOINT http://localhost:4000/api/bookings
router.post('/', createBookingLimiter, validate({ body: createBookingSchema }), createBooking);
router.get('/', validate({ query: listQuerySchema }), listMyBookings);
// @ENDPOINT http://localhost:4000/api/bookings/:id
router.get('/:id', getBooking);
// @ENDPOINT http://localhost:4000/api/bookings/:id/ticket
router.get('/:id/ticket', getTicket);
// @ENDPOINT http://localhost:4000/api/bookings/:id/cancel
router.post('/:id/cancel', validate({ body: cancelSchema }), cancelBooking);
// @ENDPOINT http://localhost:4000/api/bookings/:id/refund-account
router.patch('/:id/refund-account', validate({ body: refundAccountSchema }), updateRefundAccount);

export default router;
