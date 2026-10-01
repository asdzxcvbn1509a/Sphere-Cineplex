import fs from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { toPage } from '../utils/pagination.js';
import { resolveSlipPath } from '../middleware/upload.js';
import { notify } from './notifications.js';
import { SLIP_ACCEPTING_PAYMENT_STATUSES, getBookingById, slipUploadWindow } from './bookings.js';

/**
 * สลิปที่รอผู้ดูแลตรวจ — ใช้ชุดเดียวกันทั้งคิวตรวจสลิป ป้ายตัวเลขบนเมนู และหน้าภาพรวม
 * รวมสลิปที่ส่งมาหลังการจองหมดเวลาแล้วด้วย (การจองเป็น EXPIRED) ซึ่งผู้ดูแลอนุมัติแล้วจะเข้าคิวคืนเงิน
 */
export const PENDING_SLIP_WHERE = {
  status: 'PENDING_VERIFICATION',
  booking: { status: { in: ['PENDING_VERIFICATION', 'EXPIRED'] } },
};

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

  // ให้ server เป็นคนตัดสินว่ายังส่งสลิปได้ไหม หน้าเว็บจะได้ไม่ต้องเดากติกาเองจากนาฬิกาเครื่องลูกค้า
  const { canUpload, lateUntil } = slipUploadWindow(booking);

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
    canUploadSlip: canUpload,
    lateSlipUntil: lateUntil,
    lateSlipGraceMinutes: env.LATE_SLIP_GRACE_MINUTES,
  };
};

const notPayable = () => {
  return ApiError.conflict('BOOKING_NOT_PAYABLE', 'รายการนี้ไม่อยู่ในสถานะที่ชำระเงินได้แล้ว');
};

/** ที่นั่งเดิมของการจองที่หมดเวลาไปแล้วเอาคืนไม่ได้ (ถูกจองต่อ, ปิดใช้งาน, รอบเริ่ม/ถูกยกเลิก) */
class SeatsUnavailableError extends Error {}

/**
 * ส่งสลิปหลังการจองหมดเวลาไปแล้ว (ภายในช่วงผ่อนผัน) — ลูกค้าโอนเงินแล้วจริงแต่ส่งหลักฐานไม่ทัน
 *
 * ลองเอาที่นั่งเดิมคืนก่อน ถ้ายังว่างอยู่ก็เข้าคิวตรวจตามปกติเหมือนไม่เคยหมดเวลา
 * ถ้าที่นั่งไม่ว่างแล้ว การจองคงหมดเวลาไว้ แต่สลิปยังเข้าคิวตรวจ ผู้ดูแลยืนยันยอดแล้วจะเข้าคิวคืนเงิน
 * เดิมระบบปฏิเสธสลิปทิ้งเฉย ๆ — เงินที่โอนมาแล้วจึงไม่มีทางไปต่อในระบบเลย
 */
const acceptLateSlip = async (booking, slipData) => {
  const now = new Date();
  const showtimeOpen = booking.showtime.status === 'SCHEDULED' && booking.showtime.startsAt > now;

  if (showtimeOpen) {
    try {
      await prisma.$transaction(async (tx) => {
        // ล็อกแถวรอบฉายเหมือนตอนจองใหม่ — กันชนกับการยกเลิกทั้งรอบที่อาจเกิดพร้อมกัน
        const [live] = await tx.$queryRaw`
          SELECT "status" FROM "Showtime" WHERE "id" = ${booking.showtimeId} FOR SHARE`;
        if (live?.status !== 'SCHEDULED') throw new SeatsUnavailableError();

        const seatIds = booking.seatSnapshot.map((seat) => seat.id).sort();
        const usable = await tx.seat.count({ where: { id: { in: seatIds }, isActive: true } });
        if (usable !== seatIds.length) throw new SeatsUnavailableError();

        const { count } = await tx.booking.updateMany({
          where: { id: booking.id, status: 'EXPIRED' },
          data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null, cancelReason: null },
        });
        if (count === 0) throw notPayable();

        // ที่นั่งถูกคนอื่นจองไปแล้ว = unique constraint ชน (P2002) แล้วทั้ง transaction ย้อนกลับ
        const priceById = new Map(booking.seatSnapshot.map((seat) => [seat.id, seat.price]));
        await tx.bookingSeat.createMany({
          data: seatIds.map((seatId) => ({
            bookingId: booking.id,
            showtimeId: booking.showtimeId,
            seatId,
            price: priceById.get(seatId),
          })),
        });
        await tx.payment.update({ where: { id: booking.payment.id }, data: slipData });
      });
      return;
    } catch (error) {
      if (!(error instanceof SeatsUnavailableError) && error?.code !== 'P2002') throw error;
      // ที่นั่งไม่ว่างแล้ว — ไปทางเข้าคิวตรวจแบบไม่มีที่นั่งด้านล่าง
    }
  }

  await prisma.$transaction(async (tx) => {
    // ล็อก booking ก่อน payment ตามลำดับเดียวกับที่อื่น และยืนยันว่ายังหมดเวลาอยู่จริง
    const { count } = await tx.booking.updateMany({
      where: { id: booking.id, status: 'EXPIRED' },
      data: { cancelReason: 'โอนหลังหมดเวลา ที่นั่งไม่ว่างแล้ว — รอตรวจสลิปเพื่อคืนเงิน' },
    });
    if (count === 0) throw notPayable();
    const moved = await tx.payment.updateMany({
      where: { id: booking.payment.id, status: { in: SLIP_ACCEPTING_PAYMENT_STATUSES } },
      data: slipData,
    });
    if (moved.count === 0) throw notPayable();
  });
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
    include: { payment: true, showtime: { select: { status: true, startsAt: true } } },
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

  if (!slipUploadWindow(booking).canUpload) {
    await cleanup();
    if (booking.payment.status === 'PENDING_VERIFICATION') {
      throw ApiError.conflict('BOOKING_NOT_PAYABLE', 'ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ');
    }
    if (booking.status === 'EXPIRED') {
      throw ApiError.conflict(
        'HOLD_EXPIRED',
        `หมดเวลาส่งสลิปแล้ว หากโอนเงินไปแล้วกรุณาติดต่อเจ้าหน้าที่ พร้อมรหัสการจอง ${booking.code}`,
      );
    }
    throw notPayable();
  }

  const previousSlip = booking.payment.slipPath;
  const slipData = {
    slipPath: file.filename,
    slipUploadedAt: new Date(),
    status: 'PENDING_VERIFICATION',
    rejectReason: null,
    verifiedById: null,
    verifiedAt: null,
  };

  try {
    let current = booking;
    if (current.status === 'PENDING_PAYMENT') {
      const moved = await prisma.$transaction(async (tx) => {
        // เงื่อนไขสถานะอยู่ใน update — ถ้า job หมดเวลาหรือการยกเลิกชิงเปลี่ยนสถานะไปก่อนในจังหวะเดียวกัน
        // จะไม่โดนแถวไหน แทนที่จะเขียนทับสถานะที่เพิ่งเปลี่ยน
        // (ไม่เช็กว่าเลยกำหนดหรือยัง — ถ้า job ยังไม่ปล่อยที่นั่ง ที่นั่งก็ยังเป็นของคนนี้ รับสลิปได้เลย)
        const { count } = await tx.booking.updateMany({
          where: { id: bookingId, status: 'PENDING_PAYMENT' },
          data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null },
        });
        if (count === 0) return false;
        await tx.payment.update({ where: { id: booking.payment.id }, data: slipData });
        return true;
      });
      if (!moved) {
        // job เพิ่งปล่อยที่นั่งไปในจังหวะเดียวกันพอดี — อ่านใหม่แล้วไปทางสลิปส่งช้า
        // ลูกค้าไม่ควรเห็น error เพียงเพราะกดส่งตรงเสี้ยววินาทีที่ job ทำงาน
        current = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: { payment: true, showtime: { select: { status: true, startsAt: true } } },
        });
        if (current.status !== 'EXPIRED' || !slipUploadWindow(current).canUpload) throw notPayable();
      }
    }
    if (current.status === 'EXPIRED') await acceptLateSlip(current, slipData);
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

export const listPayments = async ({ status = 'PENDING_VERIFICATION', page, pageSize } = {}) => {
  const paging = toPage({ page, pageSize });
  // คิวที่กดอนุมัติ/ปฏิเสธได้ = PENDING_SLIP_WHERE (รวมสลิปที่ส่งหลังหมดเวลา)
  // กันสลิปค้างคิวกรณีการจองถูกยกเลิกไปแล้ว (ซึ่ง admin กดอะไรไม่ได้)
  const where =
    status === 'ALL' ? {} : status === 'PENDING_VERIFICATION' ? PENDING_SLIP_WHERE : { status };

  const query = {
    where,
    // คิวเก่าสุดขึ้นก่อน (ใครส่งก่อนได้ตรวจก่อน) — id ต่อท้ายให้ลำดับคงที่ระหว่างหน้า
    orderBy: [{ slipUploadedAt: 'asc' }, { id: 'asc' }],
    skip: paging.skip,
    take: paging.take,
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
  };
  const [payments, total] = await prisma.$transaction([
    prisma.payment.findMany(query),
    prisma.payment.count({ where }),
  ]);

  const items = payments.map((payment) => ({
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
  return { items, total, page: paging.page, pageSize: paging.pageSize };
};

/**
 * ย้ายทั้งใบชำระเงินและการจองออกจาก "รอตรวจ" พร้อมกัน — ทั้งคู่ต้องยังอยู่ในสถานะที่คาดไว้ตอนเขียน
 * ไม่งั้นทั้ง transaction ถูกยกเลิก (เช่น ผู้ดูแลสองคนกดพร้อมกัน หรือมีคนกดยกเลิกการจองไปก่อนเสี้ยววินาที)
 * เดิมเช็กจากข้อมูลที่อ่านไว้แล้วค่อยเขียนทับ จึงอนุมัติทับการจองที่เพิ่งถูกยกเลิกได้
 * ได้การจองที่ PAID ทั้งที่ที่นั่งถูกปล่อยให้คนอื่นจองซ้ำไปแล้ว
 *
 * ลำดับสำคัญ: ล็อกแถว booking ก่อน payment เสมอ ให้ตรงกับการยกเลิก/ส่งสลิป/หมดเวลา
 * ถ้าล็อกสลับลำดับกัน สองรายการที่ชนกันจะรอกันเองจนเกิด deadlock แล้วฝั่งหนึ่งได้ 500 แทน 409
 */
const settlePendingPayment = async (
  tx,
  payment,
  { paymentData, bookingData, bookingStatus = 'PENDING_VERIFICATION' },
) => {
  const bookingMoved = await tx.booking.updateMany({
    where: { id: payment.bookingId, status: bookingStatus },
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

/**
 * อนุมัติสลิป → ออกตั๋ว
 *
 * ยกเว้นสลิปที่ส่งมาหลังการจองหมดเวลาแล้วและเอาที่นั่งคืนไม่ได้ (การจองยังเป็น EXPIRED)
 * ยืนยันยอดแล้วแปลว่าเงินเข้ามาจริงแต่ไม่มีที่นั่งให้ จึงเข้าคิวคืนเงินแทนการออกตั๋ว
 */
export const approvePayment = async ({ paymentId, adminId }) => {
  const payment = await loadPendingPayment(paymentId);
  const late = payment.booking.status === 'EXPIRED';
  const notification = {
    userId: payment.booking.userId,
    data: { bookingId: payment.bookingId },
  };

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    if (late) {
      await settlePendingPayment(tx, payment, {
        bookingStatus: 'EXPIRED',
        bookingData: { cancelReason: 'โอนหลังหมดเวลา ที่นั่งไม่ว่างแล้ว — คืนเงิน' },
        paymentData: {
          status: 'REFUND_PENDING',
          verifiedById: adminId,
          verifiedAt: now,
          rejectReason: null,
          refundDueAt: now,
        },
      });
      await notify(
        {
          ...notification,
          type: 'LATE_PAYMENT_REFUND',
          context: { code: payment.booking.code, amount: payment.amount },
        },
        tx,
      );
      return;
    }

    await settlePendingPayment(tx, payment, {
      paymentData: { status: 'APPROVED', verifiedById: adminId, verifiedAt: now, rejectReason: null },
      bookingData: { status: 'PAID', paidAt: now, holdExpiresAt: null },
    });
    await notify(
      { ...notification, type: 'PAYMENT_APPROVED', context: { code: payment.booking.code } },
      tx,
    );
  });

  return getBookingById(payment.bookingId);
};

/**
 * ปฏิเสธสลิป — ปกติคืนการจองกลับไปสถานะรอชำระเงิน พร้อมให้เวลาใหม่
 * (ไม่ยกเลิกทิ้งทันที เพราะผู้ใช้อาจแค่แนบสลิปผิดรูป)
 *
 * ยกเว้นสองกรณีที่ปิดการจองไปเลย
 * - สลิปที่ส่งหลังหมดเวลา — การจองหมดเวลาไปแล้ว ไม่มีอะไรให้จ่ายใหม่
 * - รอบเริ่มฉายไปแล้ว — เดิมระบบเปิดให้จ่ายใหม่อีก 10 นาทีสำหรับรอบที่ฉายไปแล้ว
 *   ตอนนี้ปิดเป็นหมดเวลาแทน ถ้าเงินโอนมาจริง ลูกค้ายังส่งสลิปที่ถูกต้องได้ในช่วงผ่อนผันแล้วได้เงินคืน
 */
export const rejectPayment = async ({ paymentId, adminId, reason }) => {
  const payment = await loadPendingPayment(paymentId);
  const now = new Date();
  const late = payment.booking.status === 'EXPIRED';
  const showtimeStarted = payment.booking.showtime.startsAt <= now;
  const paymentData = { status: 'REJECTED', rejectReason: reason, verifiedById: adminId, verifiedAt: now };

  await prisma.$transaction(async (tx) => {
    if (late) {
      await settlePendingPayment(tx, payment, {
        bookingStatus: 'EXPIRED',
        bookingData: { cancelReason: `สลิปไม่ผ่านการตรวจสอบ: ${reason}` },
        paymentData,
      });
    } else if (showtimeStarted) {
      await settlePendingPayment(tx, payment, {
        bookingData: {
          status: 'EXPIRED',
          expiredAt: now,
          holdExpiresAt: null,
          cancelReason: `สลิปไม่ผ่านการตรวจสอบหลังรอบเริ่มฉาย: ${reason}`,
        },
        paymentData,
      });
      await tx.bookingSeat.deleteMany({ where: { bookingId: payment.bookingId } });
    } else {
      await settlePendingPayment(tx, payment, {
        bookingData: {
          status: 'PENDING_PAYMENT',
          holdExpiresAt: addMinutes(now, env.REJECTED_RETRY_MINUTES),
        },
        paymentData,
      });
    }
    await notify(
      {
        userId: payment.booking.userId,
        type: 'PAYMENT_REJECTED',
        context: { code: payment.booking.code, reason, closed: late || showtimeStarted },
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
    include: {
      booking: {
        select: {
          id: true,
          code: true,
          userId: true,
          status: true,
          showtime: { select: { startsAt: true } },
        },
      },
    },
  });
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
  if (payment.status !== 'PENDING_VERIFICATION') {
    throw ApiError.conflict('PAYMENT_NOT_PENDING', 'รายการนี้ถูกตรวจสอบไปแล้ว');
  }
  // EXPIRED = สลิปที่ส่งมาหลังหมดเวลา (ดู acceptLateSlip) ยังตรวจได้ตามปกติ
  if (!['PENDING_VERIFICATION', 'EXPIRED'].includes(payment.booking.status)) {
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
export const listRefunds = async ({ status = 'REFUND_PENDING', page, pageSize } = {}) => {
  const paging = toPage({ page, pageSize });
  const where =
    status === 'ALL' ? { status: { in: ['REFUND_PENDING', 'REFUNDED'] } } : { status };
  const query = {
    where,
    // รอคืน: ค้างนานสุดขึ้นก่อน · คืนแล้ว: ล่าสุดขึ้นก่อน — id ต่อท้ายให้ลำดับคงที่ระหว่างหน้า
    orderBy:
      status === 'REFUNDED'
        ? [{ refundedAt: 'desc' }, { id: 'desc' }]
        : [{ refundDueAt: 'asc' }, { id: 'asc' }],
    skip: paging.skip,
    take: paging.take,
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
  };
  const [refunds, total] = await prisma.$transaction([
    prisma.payment.findMany(query),
    prisma.payment.count({ where }),
  ]);

  const items = refunds.map((payment) => ({
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
  return { items, total, page: paging.page, pageSize: paging.pageSize };
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
