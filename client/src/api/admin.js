import api from './client.js';

// ทุกฟังก์ชันในไฟล์นี้ต้องใช้บัญชีที่มี role = ADMIN ไม่อย่างนั้นจะได้ 403 ROLE_REQUIRED

// ---------- ภาพรวม ----------

/** สรุปยอดขายวันนี้ รอบฉายวันนี้ งานค้าง และสลิป/รายการคืนเงินล่าสุดอย่างละ 5 รายการ */
export const getOverview = async () => {
  return await api.get('/admin/overview');
};

/** ตัวเลขงานค้างสำหรับป้ายบน sidebar — เบากว่า overview เพราะเรียกถี่ */
export const getQueueCounts = async () => {
  return await api.get('/admin/queue-counts');
};

// ---------- ภาพยนตร์ ----------

/** ต่างจาก listMovies ของฝั่งผู้ใช้ตรงที่ฝั่ง admin เห็นเรื่องที่ ARCHIVED ด้วย */
export const listMovies = async ({ status, q } = {}) => {
  return await api.get('/admin/movies', {
    params: {
      ...(status && { status }),
      ...(q && { q }),
    },
  });
};

export const createMovie = async (payload) => {
  return await api.post('/admin/movies', payload);
};

export const updateMovie = async (movieId, payload) => {
  return await api.patch(`/admin/movies/${movieId}`, payload);
};

/**
 * ลบภาพยนตร์
 * ถ้าเรื่องนั้นมีการจองอยู่จะได้ 409 MOVIE_HAS_BOOKINGS พร้อมจำนวนการจองใน details
 * ส่ง force: true มาอีกครั้งเมื่อผู้ดูแลยืนยันแล้วว่ายอมให้ประวัติการจองหายไปด้วย
 */
export const deleteMovie = async (movieId, { force = false } = {}) => {
  return await api.delete(`/admin/movies/${movieId}`, {
    params: { ...(force && { force: true }) },
  });
};

// ---------- โรงภาพยนตร์ ----------

export const listTheatres = async () => {
  return await api.get('/admin/theatres');
};

/** รายละเอียดโรง พร้อมผังที่นั่งแยกตามแถว */
export const getTheatre = async (theatreId) => {
  return await api.get(`/admin/theatres/${theatreId}`);
};

export const createTheatre = async (payload) => {
  return await api.post('/admin/theatres', payload);
};

export const updateTheatre = async (theatreId, payload) => {
  return await api.patch(`/admin/theatres/${theatreId}`, payload);
};

export const deleteTheatre = async (theatreId) => {
  return await api.delete(`/admin/theatres/${theatreId}`);
};

/** แก้โซนหรือเปิด/ปิดที่นั่งทีละหลายที่ */
export const updateSeats = async (theatreId, { seatIds, zone, isActive }) => {
  return await api.patch(`/admin/theatres/${theatreId}/seats`, {
    seatIds,
    ...(zone !== undefined && { zone }),
    ...(isActive !== undefined && { isActive }),
  });
};

// ---------- รอบฉาย ----------

export const listShowtimes = async ({ movieId, theatreId, date, includePast = true } = {}) => {
  return await api.get('/admin/showtimes', {
    params: {
      ...(movieId && { movieId }),
      ...(theatreId && { theatreId }),
      ...(date && { date }),
      includePast,
    },
  });
};

/**
 * ช่วงเวลาที่ลงรอบใหม่ได้ของโรงนั้นในวันนั้น
 * server เป็นคนคำนวณด้วยกฎเดียวกับตอนบันทึก (เว้นระหว่างรอบ + ความยาวหนัง)
 * คืนทั้งรอบที่มีอยู่แล้ว (busy) และเวลาเริ่มที่ว่างพอ (freeSlots)
 */
export const getShowtimeAvailability = async ({ theatreId, movieId, date, excludeId }) => {
  return await api.get('/admin/showtimes/availability', {
    params: { theatreId, movieId, date, ...(excludeId && { excludeId }) },
  });
};

/** เวลาจบฉายคำนวณจากความยาวหนังให้อัตโนมัติ และระบบจะกันไม่ให้รอบซ้อนกันในโรงเดียวกัน */
export const createShowtime = async ({ movieId, theatreId, startsAt, basePrice }) => {
  return await api.post('/admin/showtimes', { movieId, theatreId, startsAt, basePrice });
};

export const updateShowtime = async (showtimeId, payload) => {
  return await api.patch(`/admin/showtimes/${showtimeId}`, payload);
};

/**
 * ยกเลิกทั้งรอบ — ปิดทุกการจอง ใบที่จ่ายแล้วเข้าคิวคืนเงิน และแจ้งเตือนลูกค้าทุกคน
 * ยังมีสลิปรอตรวจในรอบนั้นจะได้ 409 SHOWTIME_HAS_PENDING_SLIPS (ต้องตรวจให้จบก่อน)
 * คืน { showtime, cancelledBookings, refundsQueued }
 */
export const cancelShowtime = async (showtimeId, reason) => {
  return await api.post(`/admin/showtimes/${showtimeId}/cancel`, {
    ...(reason && { reason }),
  });
};

export const deleteShowtime = async (showtimeId) => {
  return await api.delete(`/admin/showtimes/${showtimeId}`);
};

// ---------- การจอง ----------

/** แบ่งหน้าละ 50 รายการ (ค่าเริ่มต้นของ server) — คืน { bookings, total, page, pageSize } */
export const listAllBookings = async ({ status, date, q, page = 1 } = {}) => {
  return await api.get('/admin/bookings', {
    params: {
      ...(status && { status }),
      ...(date && { date }),
      ...(q && { q }),
      page,
    },
  });
};

/** admin ยกเลิกได้โดยไม่ติดเงื่อนไขเวลา 3 ชั่วโมงเหมือนฝั่งผู้ใช้ */
export const cancelBooking = async (bookingId, reason) => {
  return await api.post(`/admin/bookings/${bookingId}/cancel`, {
    ...(reason && { reason }),
  });
};

// ---------- ตรวจสลิป ----------

/**
 * คิวสลิป — status: 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED' | 'AWAITING_SLIP' | 'ALL'
 * คืน { payments, total, page, pageSize }
 */
export const listPayments = async (status = 'PENDING_VERIFICATION', { page = 1 } = {}) => {
  return await api.get('/admin/payments', { params: { status, page } });
};

/** อนุมัติ → การจองเป็น PAID และออก E-Ticket ให้ผู้ใช้ทันที */
export const approvePayment = async (paymentId) => {
  return await api.post(`/admin/payments/${paymentId}/approve`);
};

/** ปฏิเสธ → การจองกลับไปรอชำระเงินพร้อมได้เวลาใหม่ ไม่ได้ถูกยกเลิกทิ้ง */
export const rejectPayment = async (paymentId, reason) => {
  return await api.post(`/admin/payments/${paymentId}/reject`, { reason });
};

// ---------- คืนเงิน ----------

/**
 * คิวการจองที่จ่ายเงินแล้วแต่ถูกยกเลิก จึงต้องโอนเงินคืน — status: 'REFUND_PENDING' | 'REFUNDED' | 'ALL'
 * คืน { refunds, total, page, pageSize }
 */
export const listRefunds = async (status = 'REFUND_PENDING', { page = 1 } = {}) => {
  return await api.get('/admin/refunds', { params: { status, page } });
};

/** บันทึกว่าโอนเงินคืนแล้ว ต้องแนบสลิปคืนเงิน (server ปฏิเสธถ้าไม่มี) */
export const completeRefund = async (paymentId, { note, file } = {}) => {
  const form = new FormData();
  if (note) form.append('note', note);
  if (file) form.append('slip', file);
  return await api.post(`/admin/refunds/${paymentId}/complete`, form);
};

/** แก้รายการที่คืนเงินแล้ว — ส่งสลิปใหม่เฉพาะเมื่อจะเปลี่ยน, หมายเหตุว่าง = ลบหมายเหตุเดิม */
export const updateRefund = async (paymentId, { note, file } = {}) => {
  const form = new FormData();
  if (note) form.append('note', note);
  if (file) form.append('slip', file);
  return await api.patch(`/admin/refunds/${paymentId}`, form);
};

/** รูปสลิปคืนเงิน ดึงเป็น blob พร้อม auth เหมือนสลิปฝั่งจ่ายเงิน */
export const getRefundSlipBlob = async (bookingId) => {
  return await api.get(`/payments/${bookingId}/refund-slip`, { responseType: 'blob' });
};

// ---------- รายงาน ----------

/** groupBy: 'day' | 'movie' | 'theatre' — นับเฉพาะการจองที่ชำระเงินแล้ว */
export const getSalesReport = async ({ from, to, groupBy = 'day' } = {}) => {
  return await api.get('/admin/reports/sales', {
    params: { groupBy, ...(from && { from }), ...(to && { to }) },
  });
};

/** อัตราที่นั่งเต็มของแต่ละรอบฉาย */
export const getOccupancyReport = async ({ from, to } = {}) => {
  return await api.get('/admin/reports/occupancy', {
    params: { ...(from && { from }), ...(to && { to }) },
  });
};

/** ไฟล์ CSV — ต้องดึงเป็น blob เพราะ endpoint ต้องใช้ access token เปิด URL ตรง ๆ ไม่ได้ */
export const downloadSalesCsv = async ({ from, to, groupBy = 'day' } = {}) => {
  return await api.get('/admin/reports/sales.csv', {
    params: { groupBy, ...(from && { from }), ...(to && { to }) },
    responseType: 'blob',
  });
};

// ---------- ผู้ใช้ ----------

/** ค้นได้ทั้งชื่อ อีเมล และเบอร์โทรด้วยคำเดียว — คืน { users, total, page, pageSize } */
export const listUsers = async ({ q, role, page = 1 } = {}) => {
  return await api.get('/admin/users', {
    params: { ...(q && { q }), ...(role && { role }), page },
  });
};

/** แก้ชื่อ/อีเมล/เบอร์ หรือเปลี่ยนบทบาท (เปลี่ยนบทบาทของตัวเองไม่ได้) */
export const updateUser = async (userId, payload) => {
  return await api.patch(`/admin/users/${userId}`, payload);
};

/** ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่ลืมรหัส — เซสชันเดิมของบัญชีนั้นถูกเพิกถอนทั้งหมด */
export const resetUserPassword = async (userId, newPassword) => {
  return await api.post(`/admin/users/${userId}/password`, { newPassword });
};

/** ลบได้เฉพาะบัญชีที่ยังไม่เคยจอง ไม่งั้นได้ 409 USER_HAS_BOOKINGS */
export const deleteUser = async (userId) => {
  return await api.delete(`/admin/users/${userId}`);
};
