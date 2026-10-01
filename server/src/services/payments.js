import fs from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { resolveSlipPath } from '../middleware/upload.js';
import { notify } from './notifications.js';
import { getBookingById } from './bookings.js';

/** ข้อมูลหน้าชำระเงินของผู้ใช้ (รวม payload สำหรับ render QR ฝั่ง client) */
export const getPaymentForBooking = async ({ bookingId, userId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, showtime: { select: { startsAt: true } } },
  });
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }
  if (!booking.payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบข้อมูลการชำระเงิน');

  return {
    bookingId: booking.id,
    bookingCode: booking.code,
    bookingStatus: booking.status,
    amount: booking.payment.amount,
    reference: booking.payment.reference,
    qrPayload: booking.payment.qrPayload,
    promptPayId: env.PROMPTPAY_ID,
    merchantName: env.PROMPTPAY_MERCHANT_NAME,
    status: booking.payment.status,
    slipUploadedAt: booking.payment.slipUploadedAt,
    hasSlip: Boolean(booking.payment.slipPath),
    rejectReason: booking.payment.rejectReason,
    holdExpiresAt: booking.holdExpiresAt,
    holdSecondsLeft: booking.holdExpiresAt
      ? Math.max(0, Math.floor((booking.holdExpiresAt.getTime() - Date.now()) / 1000))
      : null,
  };
};

/**
 * ผู้ใช้ส่งสลิป
 * จุดสำคัญ: ตั้ง holdExpiresAt = null เพื่อ "หยุดนับถอยหลัง" ระหว่างรอ admin ตรวจ
 * ที่นั่งจะถูกยึดไว้จนกว่า admin จะอนุมัติหรือปฏิเสธ ผู้ใช้จึงไม่เสียสิทธิ์เพราะความล่าช้าของ admin
 */
export const uploadSlip = async ({ bookingId, userId, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบรูปสลิปการโอนเงิน');

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });

  const cleanup = async () => {
    await fs.unlink(file.path).catch(() => {});
  };

  if (!booking || !booking.payment) {
    await cleanup();
    throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  }
  if (booking.userId !== userId) {
    await cleanup();
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }
  if (booking.status !== 'PENDING_PAYMENT') {
    await cleanup();
    throw ApiError.conflict(
      'BOOKING_NOT_PAYABLE',
      booking.status === 'PENDING_VERIFICATION'
        ? 'ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ'
        : 'รายการนี้ไม่อยู่ในสถานะที่ชำระเงินได้แล้ว',
    );
  }
  if (booking.holdExpiresAt && booking.holdExpiresAt <= new Date()) {
    await cleanup();
    throw ApiError.conflict('HOLD_EXPIRED', 'หมดเวลาชำระเงินแล้ว กรุณาจองใหม่อีกครั้ง');
  }

  const previousSlip = booking.payment.slipPath;

  try {
    await prisma.$transaction(async (tx) => {
      // เงื่อนไขสถานะอยู่ใน update — ถ้า job หมดเวลาหรือการยกเลิกชิงเปลี่ยนสถานะไปก่อนในจังหวะเดียวกัน
      // จะไม่โดนแถวไหนแล้วทั้ง transaction ถูกยกเลิก แทนที่จะเขียนทับสถานะที่เพิ่งเปลี่ยน
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING_PAYMENT' },
        data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null },
      });
      if (count === 0) {
        throw ApiError.conflict('BOOKING_NOT_PAYABLE', 'รายการนี้ไม่อยู่ในสถานะที่ชำระเงินได้แล้ว');
      }
      await tx.payment.update({
        where: { id: booking.payment.id },
        data: {
          slipPath: file.filename,
          slipUploadedAt: new Date(),
          status: 'PENDING_VERIFICATION',
          rejectReason: null,
          verifiedById: null,
          verifiedAt: null,
        },
      });
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  // ลบสลิปเก่าทิ้ง (กรณีส่งใหม่หลังถูกปฏิเสธ) หลังบันทึกสำเร็จแล้วเท่านั้น
  if (previousSlip && previousSlip !== file.filename) {
    await fs.unlink(resolveSlipPath(previousSlip)).catch(() => {});
  }

  return getPaymentForBooking({ bookingId, userId });
};

/** ส่งไฟล์สลิปให้เจ้าของการจองหรือ admin เท่านั้น (ไม่เปิดเป็น static file) */
export const getSlipFilePath = async ({ bookingId, requester }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking?.payment?.slipPath) {
    throw ApiError.notFound('SLIP_NOT_FOUND', 'ยังไม่มีสลิปสำหรับรายการนี้');
  }
  if (requester.role !== 'ADMIN' && booking.userId !== requester.id) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์ดูสลิปของรายการนี้');
  }
  return resolveSlipPath(booking.payment.slipPath);
};

// ---------- ฝั่ง Admin ----------

export const listPayments = async ({ status = 'PENDING_VERIFICATION', take = 100 } = {}) => {
  // คิวที่กดอนุมัติ/ปฏิเสธได้ ต้องเป็นใบที่การจองยังรอตรวจอยู่เท่านั้น
  // กันสลิปค้างคิวกรณีการจองถูกยกเลิกหรือหมดอายุไปแล้ว (ซึ่ง admin กดอะไรไม่ได้)
  const where =
    status === 'ALL'
      ? {}
      : status === 'PENDING_VERIFICATION'
        ? { status, booking: { status: 'PENDING_VERIFICATION' } }
        : { status };

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { slipUploadedAt: 'asc' },
    take,
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, phone: true } },
          showtime: {
            include: {
              movie: { select: { titleTh: true, titleEn: true, posterUrl: true } },
              theatre: { select: { name: true } },
            },
          },
        },
      },
      verifiedBy: { select: { id: true, name: true } },
    },
  });

  return payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    reference: payment.reference,
    slipUploadedAt: payment.slipUploadedAt,
    hasSlip: Boolean(payment.slipPath),
    rejectReason: payment.rejectReason,
    verifiedAt: payment.verifiedAt,
    verifiedBy: payment.verifiedBy,
    booking: {
      id: payment.booking.id,
      code: payment.booking.code,
      status: payment.booking.status,
      totalAmount: payment.booking.totalAmount,
      seats: payment.booking.seatSnapshot,
      createdAt: payment.booking.createdAt,
      user: payment.booking.user,
      showtime: {
        id: payment.booking.showtime.id,
        startsAt: payment.booking.showtime.startsAt,
        movie: payment.booking.showtime.movie,
        theatre: payment.booking.showtime.theatre,
      },
    },
  }));
};

/**
 * ย้ายทั้งใบชำระเงินและการจองออกจาก "รอตรวจ" พร้อมกัน — ทั้งคู่ต้องยังรอตรวจอยู่จริงตอนเขียน
 * ไม่งั้นทั้ง transaction ถูกยกเลิก (เช่น ผู้ดูแลสองคนกดพร้อมกัน หรือมีคนกดยกเลิกการจองไปก่อนเสี้ยววินาที)
 * เดิมเช็กจากข้อมูลที่อ่านไว้แล้วค่อยเขียนทับ จึงอนุมัติทับการจองที่เพิ่งถูกยกเลิกได้
 * ได้การจองที่ PAID ทั้งที่ที่นั่งถูกปล่อยให้คนอื่นจองซ้ำไปแล้ว
 *
 * ลำดับสำคัญ: ล็อกแถว booking ก่อน payment เสมอ ให้ตรงกับการยกเลิก/ส่งสลิป/หมดเวลา
 * ถ้าล็อกสลับลำดับกัน สองรายการที่ชนกันจะรอกันเองจนเกิด deadlock แล้วฝั่งหนึ่งได้ 500 แทน 409
 */
const settlePendingPayment = async (tx, payment, { paymentData, bookingData }) => {
  const bookingMoved = await tx.booking.updateMany({
    where: { id: payment.bookingId, status: 'PENDING_VERIFICATION' },
    data: bookingData,
  });
  const paymentMoved = await tx.payment.updateMany({
    where: { id: payment.id, status: 'PENDING_VERIFICATION' },
    data: paymentData,
  });
  if (paymentMoved.count === 0 || bookingMoved.count === 0) {
    throw ApiError.conflict(
      'PAYMENT_NOT_PENDING',
      'รายการนี้ถูกตรวจสอบหรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
    );
  }
};

export const approvePayment = async ({ paymentId, adminId }) => {
  const payment = await loadPendingPayment(paymentId);

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await settlePendingPayment(tx, payment, {
      paymentData: { status: 'APPROVED', verifiedById: adminId, verifiedAt: now, rejectReason: null },
      bookingData: { status: 'PAID', paidAt: now, holdExpiresAt: null },
    });
    await notify(
      {
        userId: payment.booking.userId,
        type: 'PAYMENT_APPROVED',
        context: { code: payment.booking.code },
        data: { bookingId: payment.bookingId },
      },
      tx,
    );
  });

  return getBookingById(payment.bookingId);
};

/**
 * ปฏิเสธสลิป — คืนการจองกลับไปสถานะรอชำระเงิน พร้อมให้เวลาใหม่
 * (ไม่ยกเลิกทิ้งทันที เพราะผู้ใช้อาจแค่แนบสลิปผิดรูป)
 */
export const rejectPayment = async ({ paymentId, adminId, reason }) => {
  const payment = await loadPendingPayment(paymentId);
  const newHold = addMinutes(new Date(), env.REJECTED_RETRY_MINUTES);

  await prisma.$transaction(async (tx) => {
    await settlePendingPayment(tx, payment, {
      paymentData: { status: 'REJECTED', rejectReason: reason, verifiedById: adminId, verifiedAt: new Date() },
      bookingData: { status: 'PENDING_PAYMENT', holdExpiresAt: newHold },
    });
    await notify(
      {
        userId: payment.booking.userId,
        type: 'PAYMENT_REJECTED',
        context: { code: payment.booking.code, reason },
        data: { bookingId: payment.bookingId },
      },
      tx,
    );
  });

  return getBookingById(payment.bookingId);
};

const loadPendingPayment = async (paymentId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { id: true, code: true, userId: true, status: true } } },
  });
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
  if (payment.status !== 'PENDING_VERIFICATION') {
    throw ApiError.conflict('PAYMENT_NOT_PENDING', 'รายการนี้ถูกตรวจสอบไปแล้ว');
  }
  if (payment.booking.status !== 'PENDING_VERIFICATION') {
    throw ApiError.conflict('BOOKING_NOT_PENDING', 'สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอ');
  }
  return payment;
};

// ---------- การคืนเงิน ----------

/**
 * คิวรอคืนเงิน — การจองที่จ่ายเงินมาแล้วแต่ถูกยกเลิกภายหลัง
 * ระบบนี้รับเงินด้วยการโอน + ตรวจสลิป การคืนเงินจึงเป็นการโอนคืนด้วยมือเช่นกัน
 * หน้าที่ของระบบคือเตือนว่ายังค้างอยู่ และเก็บหลักฐานว่าโอนคืนไปแล้วเมื่อไหร่ โดยใคร
 */
export const listRefunds = async ({ status = 'REFUND_PENDING', take = 100 } = {}) => {
  const refunds = await prisma.payment.findMany({
    where: status === 'ALL' ? { status: { in: ['REFUND_PENDING', 'REFUNDED'] } } : { status },
    orderBy: status === 'REFUNDED' ? { refundedAt: 'desc' } : { refundDueAt: 'asc' },
    take,
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, phone: true } },
          showtime: {
            include: {
              movie: { select: { titleTh: true, titleEn: true, posterUrl: true } },
              theatre: { select: { name: true } },
            },
          },
        },
      },
      refundedBy: { select: { id: true, name: true } },
    },
  });

  return refunds.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    reference: payment.reference,
    paidAt: payment.booking.paidAt,
    refundDueAt: payment.refundDueAt,
    refundedAt: payment.refundedAt,
    refundedBy: payment.refundedBy,
    refundNote: payment.refundNote,
    refundBankName: payment.refundBankName,
    refundAccountNo: payment.refundAccountNo,
    hasRefundSlip: Boolean(payment.refundSlipPath),
    booking: {
      id: payment.booking.id,
      code: payment.booking.code,
      status: payment.booking.status,
      totalAmount: payment.booking.totalAmount,
      seats: payment.booking.seatSnapshot,
      cancelledAt: payment.booking.cancelledAt,
      cancelReason: payment.booking.cancelReason,
      user: payment.booking.user,
      showtime: {
        id: payment.booking.showtime.id,
        startsAt: payment.booking.showtime.startsAt,
        movie: payment.booking.showtime.movie,
        theatre: payment.booking.showtime.theatre,
      },
    },
  }));
};

/** ผู้ดูแลโอนคืนเองแล้วมาบันทึก ต้องแนบสลิปคืนเงิน เพราะลูกค้าเปิดดูเป็นหลักฐานได้ที่หน้าการจองของฉัน */
export const completeRefund = async ({ paymentId, adminId, note, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบสลิปการโอนคืน');

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { id: true, code: true, userId: true } } },
  });

  const cleanup = async () => {
    await fs.unlink(file.path).catch(() => {});
  };

  if (!payment) {
    await cleanup();
    throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
  }
  if (payment.status !== 'REFUND_PENDING') {
    await cleanup();
    throw ApiError.conflict(
      'REFUND_NOT_PENDING',
      payment.status === 'REFUNDED'
        ? 'รายการนี้คืนเงินไปแล้ว'
        : 'รายการนี้ไม่ได้อยู่ในสถานะรอคืนเงิน',
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      // กดบันทึกซ้ำ/ผู้ดูแลสองคนกดพร้อมกัน — ครั้งที่สองต้องไม่ผ่าน ไม่งั้นลูกค้าได้แจ้งเตือนซ้ำ
      // และสลิปใบแรกถูกเขียนทับจนกลายเป็นไฟล์กำพร้า
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'REFUND_PENDING' },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          refundedById: adminId,
          refundNote: note ?? null,
          refundSlipPath: file.filename,
        },
      });
      if (count === 0) throw ApiError.conflict('REFUND_NOT_PENDING', 'รายการนี้คืนเงินไปแล้ว');
      await notify(
        {
          userId: payment.booking.userId,
          type: 'REFUND_COMPLETED',
          context: { code: payment.booking.code, amount: payment.amount },
          data: { bookingId: payment.bookingId },
        },
        tx,
      );
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
};

/**
 * แก้รายการที่บันทึกคืนเงินไปแล้ว — เปลี่ยนสลิป (ถ้าแนบมาใหม่) และหมายเหตุ
 * ไม่แตะสถานะ/เวลาคืนเงิน และไม่แจ้งเตือนลูกค้าซ้ำ เพราะเงินถูกโอนไปแล้วจริง แค่แก้หลักฐานให้ถูก
 */
export const updateRefund = async ({ paymentId, note, file }) => {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

  const cleanup = async () => {
    if (file) await fs.unlink(file.path).catch(() => {});
  };

  if (!payment) {
    await cleanup();
    throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
  }
  if (payment.status !== 'REFUNDED') {
    await cleanup();
    throw ApiError.conflict('REFUND_NOT_COMPLETED', 'รายการนี้ยังไม่ได้บันทึกการคืนเงิน');
  }

  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'REFUNDED' },
    data: {
      refundNote: note?.trim() || null,
      ...(file && { refundSlipPath: file.filename }),
    },
  });
  if (count === 0) {
    await cleanup();
    throw ApiError.conflict('REFUND_NOT_COMPLETED', 'รายการนี้ยังไม่ได้บันทึกการคืนเงิน');
  }

  // สลิปเก่าไม่มีใครอ้างถึงแล้ว ลบทิ้งหลังบันทึกสำเร็จเท่านั้น
  if (file && payment.refundSlipPath) {
    await fs.unlink(resolveSlipPath(payment.refundSlipPath, 'refund')).catch(() => {});
  }
};

/** สลิปคืนเงิน — เจ้าของการจองหรือ admin เท่านั้น เหมือนสลิปฝั่งจ่ายเงิน */
export const getRefundSlipFilePath = async ({ bookingId, requester }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking?.payment?.refundSlipPath) {
    throw ApiError.notFound('REFUND_SLIP_NOT_FOUND', 'ยังไม่มีสลิปคืนเงินสำหรับรายการนี้');
  }
  if (requester.role !== 'ADMIN' && booking.userId !== requester.id) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์ดูสลิปของรายการนี้');
  }
  return resolveSlipPath(booking.payment.refundSlipPath, 'refund');
};
