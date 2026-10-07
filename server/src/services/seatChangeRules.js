import { env } from '../config/env.js';
import { seatLabels } from '../utils/seats.js';
import { holdSecondsLeft } from './slips.js';

/**
 * กติกาและรูปข้อมูลของการเปลี่ยนที่นั่งที่หลาย service ใช้ร่วมกัน
 * bookings.js (การ์ดการจอง, ด่านยกเลิก) · seatChanges.js (ด่านขอเปลี่ยน) · payments.js (คิวสลิปและคืนเงิน)
 * ไม่แตะฐานข้อมูล — แยกไฟล์ออกมาเพื่อไม่ให้ bookings.js กับ seatChanges.js ต้อง import กันเป็นวง
 */

/** คำขอเปลี่ยนที่นั่งที่ยังไม่จบ — การจองหนึ่งใบมีได้ทีละหนึ่งคำขอ */
export const OPEN_SEAT_CHANGE_STATUSES = ['PENDING_PAYMENT', 'PENDING_VERIFICATION'];

/** คำขอที่ยังไม่จบของการจองนี้ (ไม่มี = undefined) */
export const openSeatChange = (changes) => {
  return (changes ?? []).find((change) => OPEN_SEAT_CHANGE_STATUSES.includes(change.status));
};

/** คำขอที่นับโควตาของลูกค้า — หมดเวลา/ยกเลิกไม่นับเพราะไม่ได้ย้ายจริง ส่วนที่ผู้ดูแลย้ายให้ก็ไม่นับ */
export const countsTowardSeatChangeQuota = (change) => {
  return !change.byAdmin && [...OPEN_SEAT_CHANGE_STATUSES, 'COMPLETED'].includes(change.status);
};

/** ใช้โควตาเปลี่ยนที่นั่งไปแล้วกี่ครั้ง */
export const seatChangesUsed = (changes) => {
  return (changes ?? []).filter(countsTowardSeatChangeQuota).length;
};

/**
 * ลูกค้าเปลี่ยนที่นั่งเองได้ตอนนี้ไหม — คืน null ถ้าได้ หรือรหัสเหตุผลที่ไม่ได้
 * ใช้ทั้งตัดสินว่าหน้าเว็บจะโชว์ปุ่มไหม และเป็นด่านแรกของ requestSeatChange (ด่านจริงอยู่ใน transaction อีกชั้น)
 * booking ต้อง include showtime และ seatChanges มาแล้ว
 */
export const seatChangeBlocker = (booking, now = new Date()) => {
  if (booking.status !== 'PAID') return 'NOT_PAID';
  if (booking.showtime.status !== 'SCHEDULED') return 'SHOWTIME_CANCELLED';
  const cutoffMs = env.SEAT_CHANGE_CUTOFF_MINUTES * 60 * 1000;
  if (booking.showtime.startsAt.getTime() - now.getTime() < cutoffMs) return 'WINDOW_CLOSED';
  if (openSeatChange(booking.seatChanges)) return 'PENDING';
  if (seatChangesUsed(booking.seatChanges) >= env.MAX_SEAT_CHANGES_PER_BOOKING) return 'LIMIT';
  return null;
};

/** รายการเงินของส่วนต่าง — ลูกค้าเห็นสถานะโอนเพิ่ม/รอคืน และเปิดใบเสร็จหรือสลิปคืนเงินได้ */
const shapeSeatChangePayment = (payment) => {
  return {
    id: payment.id,
    kind: payment.kind,
    status: payment.status,
    amount: payment.amount,
    refundAmount: payment.refundAmount,
    receiptNo: payment.receiptNo,
    rejectReason: payment.rejectReason,
    refundBankName: payment.refundBankName,
    refundAccountNo: payment.refundAccountNo,
    refundedAt: payment.refundedAt,
    refundNote: payment.refundNote,
    hasRefundSlip: Boolean(payment.refundSlipPath),
  };
};

export const shapeSeatChange = (change) => {
  return {
    id: change.id,
    status: change.status,
    fromSeats: seatLabels(change.fromSeats),
    toSeats: seatLabels(change.toSeats),
    fromAmount: change.fromAmount,
    toAmount: change.toAmount,
    diffAmount: change.diffAmount,
    byAdmin: change.byAdmin,
    reason: change.reason,
    closeReason: change.closeReason,
    holdExpiresAt: change.holdExpiresAt,
    holdSecondsLeft: holdSecondsLeft(change),
    createdAt: change.createdAt,
    completedAt: change.completedAt,
    payment: change.payment ? shapeSeatChangePayment(change.payment) : null,
  };
};

/** ส่วนเปลี่ยนที่นั่งของการ์ดการจอง — ปุ่มเปลี่ยนที่นั่ง โควตาที่เหลือ คำขอที่ค้าง และประวัติ */
export const shapeSeatChangeInfo = (booking) => {
  const changes = booking.seatChanges ?? [];
  const blockedReason = seatChangeBlocker(booking);
  const open = openSeatChange(changes);
  return {
    canChange: blockedReason === null,
    blockedReason,
    changesLeft: Math.max(env.MAX_SEAT_CHANGES_PER_BOOKING - seatChangesUsed(changes), 0),
    maxChanges: env.MAX_SEAT_CHANGES_PER_BOOKING,
    cutoffMinutes: env.SEAT_CHANGE_CUTOFF_MINUTES,
    open: open ? shapeSeatChange(open) : null,
    history: changes.map(shapeSeatChange),
  };
};

export const SEAT_CHANGE_SUMMARY_SELECT = {
  select: { id: true, status: true, fromSeats: true, toSeats: true, diffAmount: true, byAdmin: true },
};

/** สรุปคำขอเปลี่ยนที่นั่งของรายการส่วนต่าง ให้ผู้ดูแลเห็นว่าเงินก้อนนี้ย้ายจากที่นั่งไหนไปไหน */
export const seatChangeSummary = (change) => {
  if (!change) return null;
  return {
    id: change.id,
    status: change.status,
    fromSeats: seatLabels(change.fromSeats),
    toSeats: seatLabels(change.toSeats),
    diffAmount: change.diffAmount,
    byAdmin: change.byAdmin,
  };
};
