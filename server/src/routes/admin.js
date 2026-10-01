import express from 'express';
import { z } from 'zod';

// controllers
import {
  getOverview,
  getQueueCounts,
  listMovies,
  createMovie,
  updateMovie,
  deleteMovie,
  listTheatres,
  getTheatre,
  createTheatre,
  updateTheatre,
  deleteTheatre,
  updateSeats,
  listShowtimes,
  getShowtimeAvailability,
  createShowtime,
  updateShowtime,
  deleteShowtime,
  listAllBookings,
  cancelBooking,
  listPayments,
  listRefunds,
  completeRefund,
  updateRefund,
  approvePayment,
  rejectPayment,
  getSalesReport,
  downloadSalesCsv,
  getOccupancyReport,
  listUsers,
  updateUser,
  resetUserPassword,
  deleteUser,
} from '../controllers/admin.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { uploadRefundSlip } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { passwordSchema } from '../utils/password.js';

const router = express.Router();

// ทุกเส้นทางในไฟล์นี้ต้องเป็นผู้ดูแลระบบเท่านั้น
router.use(authenticate, requireRole('ADMIN'));

// ---------- schema ----------

const movieSchema = z.object({
  titleTh: z.string().trim().min(1, 'กรุณากรอกชื่อเรื่องภาษาไทย').max(150),
  titleEn: z.string().trim().min(1, 'กรุณากรอกชื่อเรื่องภาษาอังกฤษ').max(150),
  synopsisTh: z.string().trim().max(3000).default(''),
  synopsisEn: z.string().trim().max(3000).default(''),
  posterUrl: z.url('ลิงก์รูปโปสเตอร์ไม่ถูกต้อง'),
  backdropUrl: z.union([z.url(), z.literal('')]).optional(),
  durationMin: z.coerce.number().int().min(30, 'ความยาวอย่างน้อย 30 นาที').max(400),
  rating: z.string().trim().max(10).default('G'),
  genres: z.array(z.string().trim().min(1)).default([]),
  releaseDate: z.coerce.date(),
  status: z.enum(['NOW_SHOWING', 'COMING_SOON', 'ARCHIVED']).default('NOW_SHOWING'),
});

const movieListQuery = z.object({
  status: z.enum(['NOW_SHOWING', 'COMING_SOON', 'ARCHIVED']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

const theatreSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อโรง').max(60),
  screenType: z.string().trim().min(1).max(20).default('2D'),
  rowsCount: z.coerce.number().int().min(1).max(26),
  colsCount: z.coerce.number().int().min(1).max(30),
  isActive: z.boolean().optional(),
});

const seatUpdateSchema = z
  .object({
    seatIds: z.array(z.string().min(1)).min(1, 'กรุณาเลือกที่นั่ง'),
    zone: z.enum(['NORMAL', 'PREMIUM', 'SOFA']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.zone !== undefined || data.isActive !== undefined, {
    message: 'ต้องระบุ zone หรือ isActive อย่างน้อยหนึ่งอย่าง',
  });

const availabilityQuery = z.object({
  theatreId: z.string().min(1),
  movieId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excludeId: z.string().min(1).optional(),
});

const showtimeCreateSchema = z.object({
  movieId: z.string().min(1),
  theatreId: z.string().min(1),
  startsAt: z.coerce.date(),
  basePrice: z.coerce.number().int().min(1).max(5000),
});

const showtimeUpdateSchema = z.object({
  theatreId: z.string().min(1).optional(),
  startsAt: z.coerce.date().optional(),
  basePrice: z.coerce.number().int().min(1).max(5000).optional(),
  status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
});

const showtimeListQuery = z.object({
  movieId: z.string().min(1).optional(),
  theatreId: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includePast: z.coerce.boolean().optional(),
});

const bookingListQuery = z.object({
  status: z
    .enum(['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED', 'EXPIRED'])
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

const paymentListQuery = z.object({
  status: z
    .enum(['AWAITING_SLIP', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'ALL'])
    .optional(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ปฏิเสธ').max(200),
});

const refundListQuery = z.object({
  status: z.enum(['REFUND_PENDING', 'REFUNDED', 'ALL']).optional(),
});

const userListQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
});

const userUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'กรุณากรอกชื่อ').max(60).optional(),
    email: z.email('อีเมลไม่ถูกต้อง').max(120).optional(),
    phone: z.string().trim().min(9, 'กรุณากรอกเบอร์โทรศัพท์').max(20).optional(),
    role: z.enum(['USER', 'ADMIN']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'ไม่มีข้อมูลที่จะแก้ไข' });

const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  groupBy: z.enum(['day', 'movie', 'theatre']).optional(),
});

// ---------- ภาพรวม ----------
// @ENDPOINT http://localhost:4000/api/admin/overview
router.get('/overview', getOverview);

// ---------- ภาพยนตร์ ----------
// @ENDPOINT http://localhost:4000/api/admin/movies
router.get('/movies', validate({ query: movieListQuery }), listMovies);
router.post('/movies', validate({ body: movieSchema }), createMovie);
router.patch('/movies/:id', validate({ body: movieSchema.partial() }), updateMovie);
router.delete(
  '/movies/:id',
  validate({ query: z.object({ force: z.coerce.boolean().optional() }) }),
  deleteMovie,
);

// ---------- โรงภาพยนตร์ ----------
// @ENDPOINT http://localhost:4000/api/admin/theatres
router.get('/theatres', listTheatres);
router.get('/theatres/:id', getTheatre);
router.post('/theatres', validate({ body: theatreSchema }), createTheatre);
router.patch('/theatres/:id', validate({ body: theatreSchema.partial() }), updateTheatre);
router.delete('/theatres/:id', deleteTheatre);
router.patch('/theatres/:id/seats', validate({ body: seatUpdateSchema }), updateSeats);

// ---------- รอบฉาย ----------
// @ENDPOINT http://localhost:4000/api/admin/showtimes
router.get('/showtimes', validate({ query: showtimeListQuery }), listShowtimes);
// @ENDPOINT http://localhost:4000/api/admin/showtimes/availability
router.get('/showtimes/availability', validate({ query: availabilityQuery }), getShowtimeAvailability);
router.post('/showtimes', validate({ body: showtimeCreateSchema }), createShowtime);
router.patch('/showtimes/:id', validate({ body: showtimeUpdateSchema }), updateShowtime);
router.delete('/showtimes/:id', deleteShowtime);

// ---------- การจองทั้งหมด ----------
// @ENDPOINT http://localhost:4000/api/admin/bookings
router.get('/bookings', validate({ query: bookingListQuery }), listAllBookings);
router.post('/bookings/:id/cancel', validate({ body: cancelSchema }), cancelBooking);
// @ENDPOINT http://localhost:4000/api/admin/queue-counts
router.get('/queue-counts', getQueueCounts);

// ---------- ตรวจสลิป ----------
// @ENDPOINT http://localhost:4000/api/admin/payments
router.get('/payments', validate({ query: paymentListQuery }), listPayments);
router.post('/payments/:id/approve', approvePayment);
router.post('/payments/:id/reject', validate({ body: rejectSchema }), rejectPayment);

// ---------- คืนเงิน ----------
// @ENDPOINT http://localhost:4000/api/admin/refunds
router.get('/refunds', validate({ query: refundListQuery }), listRefunds);
// ต้องแนบสลิปคืนเงิน ใช้ middleware ตัวเดียวกับสลิปฝั่งจ่ายเงิน (field ชื่อ slip)
router.post('/refunds/:id/complete', uploadRefundSlip, completeRefund);
// แก้รายการที่คืนแล้ว — แนบสลิปใหม่ได้แต่ไม่บังคับ (ไม่แนบ = ใช้สลิปเดิม)
router.patch('/refunds/:id', uploadRefundSlip, updateRefund);

// ---------- ผู้ใช้ ----------
// @ENDPOINT http://localhost:4000/api/admin/users
router.get('/users', validate({ query: userListQuery }), listUsers);
router.patch('/users/:id', validate({ body: userUpdateSchema }), updateUser);
router.post('/users/:id/password', validate({ body: resetPasswordSchema }), resetUserPassword);
router.delete('/users/:id', deleteUser);

// ---------- รายงาน ----------
// @ENDPOINT http://localhost:4000/api/admin/reports/sales
router.get('/reports/sales', validate({ query: reportQuery }), getSalesReport);
router.get('/reports/sales.csv', validate({ query: reportQuery }), downloadSalesCsv);
router.get('/reports/occupancy', validate({ query: reportQuery }), getOccupancyReport);

export default router;
