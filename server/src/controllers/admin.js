import * as movieService from '../services/movies.js';
import * as theatreService from '../services/theatres.js';
import * as showtimeService from '../services/showtimes.js';
import * as bookingService from '../services/bookings.js';
import * as paymentService from '../services/payments.js';
import * as reportService from '../services/reports.js';
import * as userService from '../services/users.js';

/** backdropUrl ที่ส่งมาเป็นสตริงว่าง ให้เก็บเป็น null แทน */
const normalizeMovie = (body) => ({
  ...body,
  ...(body.backdropUrl !== undefined && { backdropUrl: body.backdropUrl || null }),
});

// ---------- ภาพรวม ----------

// @ENDPOINT GET http://localhost:4000/api/admin/overview
export const getOverview = async (req, res, next) => {
  try {
    res.json(await reportService.getOverview());
  } catch (error) {
    next(error);
  }
};

// ---------- ภาพยนตร์ ----------

// @ENDPOINT GET http://localhost:4000/api/admin/movies
export const listMovies = async (req, res, next) => {
  try {
    // ฝั่ง admin ต้องเห็นเรื่องที่ ARCHIVED ด้วย
    const movies = await movieService.listMovies({
      ...req.validatedQuery,
      includeArchived: true,
    });
    res.json({ movies });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/movies
export const createMovie = async (req, res, next) => {
  try {
    const movie = await movieService.createMovie(normalizeMovie(req.body));
    res.status(201).json({ movie });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/admin/movies/:id
export const updateMovie = async (req, res, next) => {
  try {
    const movie = await movieService.updateMovie(req.params.id, normalizeMovie(req.body));
    res.json({ movie });
  } catch (error) {
    next(error);
  }
};

/** ส่ง ?force=true มาเมื่อผู้ดูแลยืนยันแล้วว่ายอมให้ประวัติการจองหายไปด้วย */
// @ENDPOINT DELETE http://localhost:4000/api/admin/movies/:id
export const deleteMovie = async (req, res, next) => {
  try {
    res.json(await movieService.deleteMovie(req.params.id, { force: req.validatedQuery?.force }));
  } catch (error) {
    next(error);
  }
};

// ---------- โรงภาพยนตร์ ----------

// @ENDPOINT GET http://localhost:4000/api/admin/theatres
export const listTheatres = async (req, res, next) => {
  try {
    const theatres = await theatreService.listTheatres();
    res.json({ theatres });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/admin/theatres/:id
export const getTheatre = async (req, res, next) => {
  try {
    const theatre = await theatreService.getTheatreById(req.params.id);
    res.json({ theatre });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/theatres
export const createTheatre = async (req, res, next) => {
  try {
    const theatre = await theatreService.createTheatre(req.body);
    res.status(201).json({ theatre });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/admin/theatres/:id
export const updateTheatre = async (req, res, next) => {
  try {
    const theatre = await theatreService.updateTheatre(req.params.id, req.body);
    res.json({ theatre });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT DELETE http://localhost:4000/api/admin/theatres/:id
export const deleteTheatre = async (req, res, next) => {
  try {
    await theatreService.deleteTheatre(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/admin/theatres/:id/seats
export const updateSeats = async (req, res, next) => {
  try {
    const updated = await theatreService.updateSeats(req.params.id, req.body);
    const theatre = await theatreService.getTheatreById(req.params.id);
    res.json({ updated, theatre });
  } catch (error) {
    next(error);
  }
};

// ---------- รอบฉาย ----------

// @ENDPOINT GET http://localhost:4000/api/admin/showtimes
export const listShowtimes = async (req, res, next) => {
  try {
    const showtimes = await showtimeService.listShowtimes({
      ...req.validatedQuery,
      includePast: req.validatedQuery.includePast ?? true,
      // ผู้ดูแลต้องเห็นรอบที่ยกเลิกแล้วด้วย ไม่งั้นรอบหายจากตารางจนไม่รู้ว่าเกิดอะไรขึ้น
      includeCancelled: true,
    });
    res.json({ showtimes });
  } catch (error) {
    next(error);
  }
};

/** ช่วงเวลาว่างของโรง สำหรับให้หน้าเพิ่มรอบฉายเลือกเวลาที่ไม่ชนกับรอบอื่น */
// @ENDPOINT GET http://localhost:4000/api/admin/showtimes/availability
export const getShowtimeAvailability = async (req, res, next) => {
  try {
    res.json(await showtimeService.getAvailability(req.validatedQuery));
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/showtimes
export const createShowtime = async (req, res, next) => {
  try {
    const showtime = await showtimeService.createShowtime(req.body);
    res.status(201).json({ showtime });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/admin/showtimes/:id
export const updateShowtime = async (req, res, next) => {
  try {
    const showtime = await showtimeService.updateShowtime(req.params.id, req.body);
    res.json({ showtime });
  } catch (error) {
    next(error);
  }
};

/** ยกเลิกทั้งรอบ — ปิดทุกการจอง ใบที่จ่ายแล้วเข้าคิวคืนเงิน และแจ้งเตือนลูกค้าทุกคน */
// @ENDPOINT POST http://localhost:4000/api/admin/showtimes/:id/cancel
export const cancelShowtime = async (req, res, next) => {
  try {
    res.json(
      await bookingService.cancelShowtime({ showtimeId: req.params.id, reason: req.body.reason }),
    );
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT DELETE http://localhost:4000/api/admin/showtimes/:id
export const deleteShowtime = async (req, res, next) => {
  try {
    await showtimeService.deleteShowtime(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

// ---------- การจองทั้งหมด ----------

// @ENDPOINT GET http://localhost:4000/api/admin/bookings
export const listAllBookings = async (req, res, next) => {
  try {
    const bookings = await bookingService.listAllBookings(req.validatedQuery);
    res.json({ bookings });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/admin/queue-counts
export const getQueueCounts = async (_req, res, next) => {
  try {
    res.json(await reportService.getQueueCounts());
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/bookings/:id/cancel
export const cancelBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.cancelBooking({
      bookingId: req.params.id,
      byAdmin: true,
      reason: req.body.reason,
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

// ---------- ตรวจสลิป ----------

// @ENDPOINT GET http://localhost:4000/api/admin/payments
export const listPayments = async (req, res, next) => {
  try {
    const payments = await paymentService.listPayments(req.validatedQuery);
    res.json({ payments });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/payments/:id/approve
export const approvePayment = async (req, res, next) => {
  try {
    const booking = await paymentService.approvePayment({
      paymentId: req.params.id,
      adminId: req.user.id,
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/payments/:id/reject
export const rejectPayment = async (req, res, next) => {
  try {
    const booking = await paymentService.rejectPayment({
      paymentId: req.params.id,
      adminId: req.user.id,
      reason: req.body.reason,
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

// ---------- คืนเงิน ----------

/** คิวการจองที่จ่ายเงินแล้วแต่ถูกยกเลิก จึงต้องโอนเงินคืนลูกค้า */
// @ENDPOINT GET http://localhost:4000/api/admin/refunds
export const listRefunds = async (req, res, next) => {
  try {
    const refunds = await paymentService.listRefunds(req.validatedQuery);
    res.json({ refunds });
  } catch (error) {
    next(error);
  }
};

/** บันทึกว่าโอนเงินคืนแล้ว (ต้องแนบสลิปคืนเงิน) */
// @ENDPOINT POST http://localhost:4000/api/admin/refunds/:id/complete
export const completeRefund = async (req, res, next) => {
  try {
    await paymentService.completeRefund({
      paymentId: req.params.id,
      adminId: req.user.id,
      note: req.body?.note,
      file: req.file,
    });
    // หน้าคืนเงินโหลดคิวใหม่เองหลังบันทึก (รวมถึงหน้าที่กำลังเปิดอยู่) จึงไม่ต้องส่งรายการกลับไป
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

/** แก้รายการที่คืนเงินแล้ว — เปลี่ยนสลิป (ถ้าแนบใหม่) และหมายเหตุ */
// @ENDPOINT PATCH http://localhost:4000/api/admin/refunds/:id
export const updateRefund = async (req, res, next) => {
  try {
    await paymentService.updateRefund({
      paymentId: req.params.id,
      note: req.body?.note,
      file: req.file,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

// ---------- รายงาน ----------

// @ENDPOINT GET http://localhost:4000/api/admin/reports/sales
export const getSalesReport = async (req, res, next) => {
  try {
    res.json(await reportService.getSalesReport(req.validatedQuery));
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/admin/reports/sales.csv
export const downloadSalesCsv = async (req, res, next) => {
  try {
    const report = await reportService.getSalesReport(req.validatedQuery);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.send(reportService.salesReportToCsv(report));
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/admin/reports/occupancy
export const getOccupancyReport = async (req, res, next) => {
  try {
    const showtimes = await reportService.getOccupancyReport(req.validatedQuery);
    res.json({ showtimes });
  } catch (error) {
    next(error);
  }
};

// ---------- ผู้ใช้ ----------

// @ENDPOINT GET http://localhost:4000/api/admin/users
export const listUsers = async (req, res, next) => {
  try {
    const users = await userService.listUsers(req.validatedQuery);
    res.json({ users });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/admin/users/:id
export const updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser({
      ...req.body,
      userId: req.params.id,
      actorId: req.user.id,
    });
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/admin/users/:id/password
export const resetUserPassword = async (req, res, next) => {
  try {
    const result = await userService.resetUserPassword({
      userId: req.params.id,
      actorId: req.user.id,
      newPassword: req.body.newPassword,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT DELETE http://localhost:4000/api/admin/users/:id
export const deleteUser = async (req, res, next) => {
  try {
    const result = await userService.deleteUser({
      userId: req.params.id,
      actorId: req.user.id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};
