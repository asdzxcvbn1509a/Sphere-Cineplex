import api from './client.js';

/**
 * สร้างการจอง
 * ถ้าที่นั่งถูกคนอื่นจองตัดหน้าจะได้ 409 พร้อม error.code = 'SEAT_TAKEN'
 * และ error.details.seats = รายชื่อที่นั่งที่ชนกัน
 */
export const createBooking = async ({ showtimeId, seatIds }) => {
  return await api.post('/bookings', { showtimeId, seatIds });
};

/** การจองของฉัน — scope: 'all' | 'upcoming' | 'history' */
export const listMyBookings = async (scope = 'all') => {
  return await api.get('/bookings', { params: { scope } });
};

export const getBooking = async (bookingId) => {
  return await api.get(`/bookings/${bookingId}`);
};

/** ข้อมูล E-Ticket — เรียกได้เฉพาะการจองที่ชำระเงินสำเร็จแล้ว */
export const getTicket = async (bookingId) => {
  return await api.get(`/bookings/${bookingId}/ticket`);
};

/**
 * ยกเลิกการจอง
 *
 * - เลยกำหนด 3 ชม. → 403 error.code = 'CANCEL_WINDOW_CLOSED'
 * - สลิปยังรอตรวจ → 409 error.code = 'AWAITING_VERIFICATION'
 * - ใบที่จ่ายเงินแล้วต้องส่งบัญชีรับเงินคืนมาด้วย ไม่งั้น 400 'REFUND_ACCOUNT_REQUIRED'
 */
export const cancelBooking = async (
  bookingId,
  { reason, refundBankName, refundAccountNo } = {},
) => {
  return await api.post(`/bookings/${bookingId}/cancel`, {
    ...(reason && { reason }),
    ...(refundBankName && { refundBankName }),
    ...(refundAccountNo && { refundAccountNo }),
  });
};
