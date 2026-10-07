import ApiError from './ApiError.js';

/**
 * error ของการเข้าถึงการจองที่ทุก service ตอบเหมือนกัน
 * ข้อความของ NOT_BOOKING_OWNER บอกว่าทำอะไรไม่ได้ (ยกเลิก แก้ไข ดูสลิป ฯลฯ) จึงให้แต่ละจุดส่งข้อความของตัวเองมา
 */

export const bookingNotFound = () => {
  return ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
};

export const seatChangeNotFound = () => {
  return ApiError.notFound('SEAT_CHANGE_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนที่นั่งนี้');
};

export const notBookingOwner = (message = 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้') => {
  return ApiError.forbidden('NOT_BOOKING_OWNER', message);
};

/** เป็นเจ้าของการจอง หรือเป็นผู้ดูแล (เปิดดูของลูกค้าได้ทุกรายการ) — requester คือ req.user */
export const canAccessBooking = (requester, ownerId) => {
  return requester.role === 'ADMIN' || ownerId === requester.id;
};
