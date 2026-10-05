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
 * ใบเสร็จรับเงิน — ออกตอนผู้ดูแลอนุมัติสลิป เปิดได้ทั้งเจ้าของการจองและผู้ดูแล
 * paymentId = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง (ไม่ส่ง = ใบเสร็จค่าตั๋วตอนจอง)
 * ยังไม่มีใบเสร็จ (ยังไม่จ่าย หรือเป็นเงินที่โอนหลังหมดเวลาแล้วรอคืน) → 403 error.code = 'RECEIPT_NOT_READY'
 */
export const getReceipt = async (bookingId, paymentId) => {
  return await api.get(`/bookings/${bookingId}/receipt`, {
    params: paymentId ? { payment: paymentId } : undefined,
  });
};

/**
 * ขอเปลี่ยนที่นั่ง — seatIds คือชุดใหม่ทั้งชุด (รวมที่นั่งที่คงไว้) จำนวนต้องเท่าเดิม
 *
 * - ราคาเท่าเดิม/ถูกลง → ย้ายทันที (ถูกลงต้องส่งบัญชีรับเงินคืนมาด้วย ไม่งั้น 400 'REFUND_ACCOUNT_REQUIRED')
 * - แพงขึ้น → seatChange.status = 'PENDING_PAYMENT' ไปโอนส่วนต่างที่ /booking/:id/seat-change/:seatChangeId
 * - 409 'SEAT_TAKEN' (details.seats) · 'SEAT_CHANGE_PENDING' (details.seatChangeId) · 'SEAT_CHANGE_LIMIT'
 *   และ 403 'SEAT_CHANGE_WINDOW_CLOSED'
 */
export const requestSeatChange = async (bookingId, { seatIds, refundBankName, refundAccountNo }) => {
  return await api.post(`/bookings/${bookingId}/seat-changes`, {
    seatIds,
    ...(refundBankName && { refundBankName }),
    ...(refundAccountNo && { refundAccountNo }),
  });
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

/**
 * แจ้ง/แก้บัญชีรับเงินคืน — ใช้กับใบที่รอโอนคืนอยู่ (เช่น ผู้ดูแลยกเลิกรอบแทน)
 * ใบที่ไม่ได้รอคืนเงินแล้วจะได้ 409 REFUND_NOT_PENDING
 */
export const updateRefundAccount = async (bookingId, { refundBankName, refundAccountNo }) => {
  return await api.patch(`/bookings/${bookingId}/refund-account`, {
    refundBankName,
    refundAccountNo,
  });
};
