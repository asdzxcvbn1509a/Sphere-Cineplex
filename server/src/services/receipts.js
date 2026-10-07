import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { APP_URL, env } from '../config/env.js';
import { bookingNotFound, canAccessBooking, notBookingOwner } from '../utils/bookingAccess.js';
import { sendMail } from '../utils/mailer.js';
import { formatReceiptNo, receiptYear, shapeReceipt } from '../utils/receipt.js';
import { receiptEmail } from '../emails/receipt.js';

const receiptInclude = {
  user: { select: { id: true, name: true, email: true } },
  showtime: {
    include: {
      movie: { select: { titleTh: true, titleEn: true } },
      theatre: { select: { name: true } },
    },
  },
  payment: true,
};

const issuer = () => {
  return { name: env.RECEIPT_ISSUER_NAME, address: env.RECEIPT_ISSUER_ADDRESS };
};

const loadReceiptBooking = (bookingId) => {
  return prisma.booking.findUnique({ where: { id: bookingId }, include: receiptInclude });
};

/**
 * รายการเงินที่จะออกใบเสร็จ — ไม่ระบุ = ใบหลัก (ค่าตั๋วตอนจอง)
 * ระบุ = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง ต้องเป็นรายการของการจองนี้เท่านั้น (กันเอา id ของคนอื่นมาเปิดผ่านการจองตัวเอง)
 */
const receiptPayment = (booking, paymentId) => {
  if (!paymentId) return booking.payment;
  return prisma.payment.findFirst({
    where: { id: paymentId, bookingId: booking.id },
    include: { seatChange: { select: { fromSeats: true, toSeats: true } } },
  });
};

/**
 * ออกเลขที่ใบเสร็จถัดไปของปีนั้น — ต้องเรียกใน transaction เดียวกับการอนุมัติสลิป (ส่ง tx มาเป็น client)
 *
 * ตัวนับเป็นแถวในตาราง ไม่ใช่ SEQUENCE ของ PostgreSQL เพราะ SEQUENCE ไม่ย้อนตาม rollback
 * อนุมัติไม่ผ่านทีไร (ชนกับผู้ดูแลอีกคน, การจองถูกยกเลิกไปพอดี) เลขก็หายไปหนึ่งเลข
 * ใบเสร็จจะขาดช่วงจนตรวจย้อนหลังไม่ได้ว่าใบที่หายไปไปไหน — แบบนี้ถ้า transaction ล้ม ค่าที่เพิ่มก็ย้อนกลับด้วย
 *
 * แถวตัวนับถูกล็อกไว้จนจบ transaction การอนุมัติที่มาพร้อมกันจึงต่อคิวกันแค่ช่วงท้ายนี้
 * ทุกที่ล็อกตามลำดับ Booking → Payment → ReceiptCounter และไม่มีที่ไหนล็อกตัวนับก่อน จึงไม่เกิด deadlock
 */
export const issueReceiptNo = async (client, at = new Date()) => {
  const year = receiptYear(at);
  const [{ lastNo }] = await client.$queryRaw`
    INSERT INTO "ReceiptCounter" ("year", "lastNo") VALUES (${year}::int, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastNo" = "ReceiptCounter"."lastNo" + 1
    RETURNING "lastNo"`;
  return formatReceiptNo(year, lastNo);
};

/**
 * ใบเสร็จของการจอง — เจ้าของการจองหรือผู้ดูแลเท่านั้น (แบบเดียวกับการดูสลิป)
 * paymentId = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง (ไม่ส่ง = ใบเสร็จค่าตั๋วตอนจอง)
 */
export const getReceipt = async ({ bookingId, paymentId, requester }) => {
  const booking = await loadReceiptBooking(bookingId);
  if (!booking) throw bookingNotFound();
  if (!canAccessBooking(requester, booking.userId)) {
    throw notBookingOwner('ไม่มีสิทธิ์ดูใบเสร็จของรายการนี้');
  }
  // ออกให้เฉพาะใบที่อนุมัติแล้วการจองเป็น PAID — สลิปที่ส่งหลังหมดเวลาแล้วเข้าคิวคืนเงินทันทีไม่มีใบเสร็จ
  const payment = await receiptPayment(booking, paymentId);
  if (!payment?.receiptNo) {
    throw ApiError.forbidden('RECEIPT_NOT_READY', 'รายการนี้ยังไม่มีใบเสร็จรับเงิน');
  }
  return shapeReceipt(booking, issuer(), payment);
};

/**
 * ส่งใบเสร็จทางอีเมล — เรียกหลัง transaction ของการอนุมัติจบแล้วเท่านั้น
 * ถ้าอนุมัติไม่สำเร็จ (ชนกับผู้ดูแลอีกคน) จะได้ไม่มีเมลของใบเสร็จที่ไม่มีอยู่จริงหลุดออกไป
 *
 * รอแค่ตอนอ่านข้อมูล ไม่รอ SMTP — ผู้ดูแลกำลังไล่ตรวจคิวสลิป ไม่ควรต้องรอเมลส่งเสร็จทีละใบ
 * และอะไรพังในนี้ก็แค่ลง log เพราะการอนุมัติสำเร็จไปแล้ว ลูกค้ายังเปิดใบเสร็จจากหน้าเว็บได้ตามปกติ
 */
export const emailReceipt = async (bookingId, paymentId) => {
  try {
    const booking = await loadReceiptBooking(bookingId);
    if (!booking) return;
    const payment = await receiptPayment(booking, paymentId);
    if (!payment?.receiptNo) return;
    // บัญชีเก่าที่ได้อีเมลชั่วคราวตอนเปลี่ยนมาใช้รหัสผ่าน (migration password_auth) ส่งไปก็ไม่ถึงใคร
    if (booking.user.email.endsWith('.invalid')) return;

    const receipt = shapeReceipt(booking, issuer(), payment);
    const message = receiptEmail({
      receipt,
      receiptUrl: `${APP_URL}/booking/${booking.id}/receipt${paymentId ? `?payment=${paymentId}` : ''}`,
      ticketUrl: `${APP_URL}/booking/${booking.id}/ticket`,
    });
    // ไม่ await — sendMail จัดการ error ของ SMTP เองอยู่แล้ว ส่วน .catch กันกรณีอื่น
    // ไม่ให้กลายเป็น unhandled rejection ซึ่งทำให้ Node ปิดทั้ง process
    sendMail({ to: booking.user.email, ...message }).catch((error) => {
      console.error(`[receipt] ส่งใบเสร็จ ${receipt.receiptNo} ไม่สำเร็จ:`, error.message);
    });
  } catch (error) {
    console.error(`[receipt] เตรียมอีเมลใบเสร็จของการจอง ${bookingId} ไม่สำเร็จ:`, error.message);
  }
};
