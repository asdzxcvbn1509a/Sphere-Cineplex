import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { seatLabel, sortSeats } from '../utils/seats.js';

/**
 * ล็อกแถวและ error ของการเขียนพร้อมกัน — ใช้ร่วมกันทั้งการจอง การเปลี่ยนที่นั่ง และการตรวจสลิป
 *
 * ลำดับล็อกทั้งระบบ: Showtime (FOR SHARE) → Booking → SeatChange → BookingSeat → Payment → ReceiptCounter
 * ทุกรายการล็อกตามลำดับนี้ และเขียนที่นั่งเรียงตาม id เสมอ สองรายการที่ชนกันจึงต่อคิวกัน ไม่รอกันเองจน deadlock
 *
 * การเปลี่ยนสถานะทุกจุดเป็น compare-and-set — ใส่สถานะที่คาดไว้ใน where แล้วเช็กว่าโดนแถวจริง
 * ไม่ได้อ่านมาเช็กก่อนแล้วค่อยเขียนทับ ถ้าอีกรายการชิงเปลี่ยนไปก่อน ฝั่งที่ช้ากว่าได้ 409 และ transaction ถูกยกเลิกทั้งก้อน
 */

/**
 * ล็อกแถวรอบฉายแบบแชร์ไว้จนจบ transaction แล้วคืนสถานะล่าสุด (ไม่พบ = undefined)
 * การจองหลายรายการถือล็อกแบบแชร์พร้อมกันได้ ส่วนการยกเลิกทั้งรอบต้องรอให้ทุกรายการจบก่อน
 */
export const lockShowtime = async (tx, showtimeId) => {
  const [row] = await tx.$queryRaw`
    SELECT "status" FROM "Showtime" WHERE "id" = ${showtimeId} FOR SHARE`;
  return row?.status;
};

/**
 * ล็อกแถวการจองไว้จนจบ transaction แล้วคืน { status, seatSnapshot } ล่าสุด (ไม่พบ = undefined)
 * สองรายการที่แก้การจองเดียวกันพร้อมกันต่อคิวกันตรงนี้ รายการที่ช้ากว่าจึงเห็นสิ่งที่อีกรายการเพิ่งเขียนไป
 */
export const lockBooking = async (tx, bookingId) => {
  const [row] = await tx.$queryRaw`
    SELECT "status", "seatSnapshot" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  return row;
};

/** ชนกับ @@unique([showtimeId, seatId]) ของ BookingSeat = มีคนจองที่นั่งนั้นตัดหน้าไปแล้ว */
export const isSeatConflict = (err) => {
  return err?.code === 'P2002' && String(err.meta?.target ?? '').includes('showtimeId');
};

/** 409 SEAT_TAKEN พร้อมบอกว่าที่นั่งไหนโดนตัดหน้าไป — ใช้ทั้งตอนจองและตอนเปลี่ยนที่นั่ง */
export const seatTakenError = async (showtimeId, seatIds) => {
  const taken = await prisma.bookingSeat.findMany({
    where: { showtimeId, seatId: { in: seatIds } },
    include: { seat: true },
  });
  return ApiError.conflict(
    'SEAT_TAKEN',
    'มีผู้อื่นจองที่นั่งนี้ไปก่อนแล้ว กรุณาเลือกที่นั่งใหม่',
    { seats: sortSeats(taken.map((row) => row.seat)).map(seatLabel) },
  );
};

/** สถานะเปลี่ยนไประหว่างที่กำลังทำรายการ (อีกคนกดก่อน, หมดเวลาพอดี) — ให้ผู้ใช้รีเฟรชแล้วดูใหม่ */
export const bookingStateChanged = () => {
  return ApiError.conflict(
    'BOOKING_STATE_CHANGED',
    'สถานะการจองเปลี่ยนไประหว่างทำรายการ กรุณารีเฟรชหน้าจอแล้วลองใหม่',
  );
};

/** สลิปถูกตรวจไปแล้ว หรือรายการที่ผูกอยู่เปลี่ยนสถานะไปก่อน (ผู้ดูแลสองคนกดพร้อมกัน, มีคนยกเลิกไปก่อนเสี้ยววินาที) */
export const paymentNotPending = () => {
  return ApiError.conflict(
    'PAYMENT_NOT_PENDING',
    'รายการนี้ถูกตรวจสอบหรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
  );
};
