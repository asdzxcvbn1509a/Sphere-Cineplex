import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { findPage } from '../utils/pagination.js';
import { bookingNotFound, canAccessBooking, notBookingOwner } from '../utils/bookingAccess.js';
import { removeSlip } from '../lib/slipStorage.js';
import { notify } from './notifications.js';
import { USER_CONTACT_SELECT, getBookingById } from './bookings.js';
import { paymentNotPending } from './locks.js';
import {
  approvedPaymentData,
  canUploadSlip,
  discardSlipOnError,
  holdSecondsLeft,
  queueSlipForReview,
  rejectedPaymentData,
} from './slips.js';
import { SEAT_CHANGE_SUMMARY_SELECT, seatChangeSummary } from './seatChangeRules.js';
import { emailReceipt, issueReceiptNo } from './receipts.js';
import { approveTopUp, rejectTopUp } from './seatChanges.js';

/**
 * สลิปที่รอผู้ดูแลตรวจ — ใช้ชุดเดียวกันทั้งคิวตรวจสลิป ป้ายตัวเลขบนเมนู และหน้าภาพรวม
 * ทั้งค่าตั๋วและส่วนต่างเปลี่ยนที่นั่ง โดยการจอง/คำขอเจ้าของสลิปต้องรอตรวจอยู่ด้วย
 */
export const PENDING_SLIP_WHERE = {
  status: 'PENDING_VERIFICATION',
  OR: [
    { kind: 'BOOKING', booking: { status: 'PENDING_VERIFICATION' } },
    { kind: 'SEAT_CHANGE_TOPUP', seatChange: { status: 'PENDING_VERIFICATION' } },
  ],
};

/** ข้อมูลหน้าชำระเงินของผู้ใช้ (รวม payload สำหรับ render QR ฝั่ง client) */
export const getPaymentForBooking = async ({ bookingId, userId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, showtime: { select: { startsAt: true } } },
  });
  if (!booking) throw bookingNotFound();
  if (booking.userId !== userId) throw notBookingOwner();
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
    holdSecondsLeft: holdSecondsLeft(booking),
    canUploadSlip: canUploadSlip(booking),
  };
};

const notPayable = () => {
  return ApiError.conflict('BOOKING_NOT_PAYABLE', 'รายการนี้ไม่อยู่ในสถานะที่ชำระเงินได้แล้ว');
};

const loadForSlip = (bookingId) => {
  return prisma.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
};

/**
 * ผู้ใช้ส่งสลิป — หยุดนับถอยหลังระหว่างรอ admin ตรวจ ที่นั่งถูกยึดไว้จนกว่าจะรู้ผล (ดู queueSlipForReview)
 * หมดเวลาแล้วส่งไม่ได้ (409 HOLD_EXPIRED) และลบไฟล์ทิ้งเมื่อทำรายการไม่สำเร็จ
 */
export const uploadSlip = async ({ bookingId, userId, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบรูปสลิปการโอนเงิน');

  const previousSlip = await discardSlipOnError('payment', file, async () => {
    const booking = await loadForSlip(bookingId);
    if (!booking?.payment) throw bookingNotFound();
    if (booking.userId !== userId) throw notBookingOwner();
    await queueSlipForReview({
      model: 'booking',
      holder: booking,
      file,
      reload: () => loadForSlip(bookingId),
      canUpload: canUploadSlip,
      notPayable,
      alreadySentCode: 'BOOKING_NOT_PAYABLE',
      bookingCode: booking.code,
    });
    return booking.payment.slipPath;
  });

  // ลบสลิปเก่าทิ้ง (กรณีส่งใหม่หลังถูกปฏิเสธ) หลังบันทึกสำเร็จแล้วเท่านั้น
  if (previousSlip && previousSlip !== file.filename) {
    await removeSlip('payment', previousSlip);
  }

  return getPaymentForBooking({ bookingId, userId });
};

/**
 * ชื่อไฟล์สลิปของรายการเงินในการจองนี้ — เฉพาะเจ้าของการจองหรือ admin
 * (สลิปไม่ได้เปิดเป็น static file แต่ controller ส่งให้ผ่าน sendSlip)
 *
 * paymentId ไม่ระบุ = ใบหลัก (ค่าตั๋วตอนจอง) · ระบุ = รายการส่วนต่างเปลี่ยนที่นั่ง ต้องเป็นของการจองนี้เท่านั้น
 * สิทธิ์จึงตรวจจากเจ้าของการจองเหมือนเดิม · field = 'slipPath' (สลิปโอนเข้า) หรือ 'refundSlipPath' (สลิปโอนคืน)
 * ยังไม่มีสลิปตอบ 404 ก่อนดูว่าผู้ขอเป็นใคร
 */
const slipFileName = async ({ bookingId, paymentId, requester, field, notFound }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  const payment =
    booking && paymentId
      ? await prisma.payment.findFirst({ where: { id: paymentId, bookingId } })
      : booking?.payment;
  if (!payment?.[field]) throw notFound();
  if (!canAccessBooking(requester, booking.userId)) {
    throw notBookingOwner('ไม่มีสิทธิ์ดูสลิปของรายการนี้');
  }
  return payment[field];
};

/** ชื่อไฟล์สลิปโอนเงิน — paymentId = สลิปส่วนต่างเปลี่ยนที่นั่ง */
export const getSlipFileName = ({ bookingId, paymentId, requester }) => {
  return slipFileName({
    bookingId,
    paymentId,
    requester,
    field: 'slipPath',
    notFound: () => ApiError.notFound('SLIP_NOT_FOUND', 'ยังไม่มีสลิปสำหรับรายการนี้'),
  });
};

// ---------- ฝั่ง Admin ----------

/** การจองที่คิวสลิปและคิวคืนเงินแสดงคู่กับรายการเงิน — ชื่อผู้จอง เบอร์ติดต่อ และรอบที่จอง */
const QUEUE_BOOKING_INCLUDE = {
  include: {
    user: USER_CONTACT_SELECT,
    showtime: {
      include: {
        movie: { select: { titleTh: true, titleEn: true, posterUrl: true } },
        theatre: { select: { name: true } },
      },
    },
  },
};

const shapeQueueBooking = (booking) => {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    totalAmount: booking.totalAmount,
    seats: booking.seatSnapshot,
    user: booking.user,
    showtime: {
      id: booking.showtime.id,
      startsAt: booking.showtime.startsAt,
      movie: booking.showtime.movie,
      theatre: booking.showtime.theatre,
    },
  };
};

export const listPayments = async ({
  status = 'PENDING_VERIFICATION',
  sort = 'oldest',
  page,
  pageSize,
} = {}) => {
  // คิวที่กดอนุมัติ/ปฏิเสธได้ = PENDING_SLIP_WHERE
  // กันสลิปค้างคิวกรณีการจองถูกยกเลิกไปแล้ว (ซึ่ง admin กดอะไรไม่ได้)
  const where =
    status === 'ALL' ? {} : status === 'PENDING_VERIFICATION' ? PENDING_SLIP_WHERE : { status };
  // ค่าเริ่มต้นเก่าสุดขึ้นก่อน (ใครส่งก่อนได้ตรวจก่อน) · newest ให้ผู้ดูแลดูใบที่เพิ่งเข้ามา
  const direction = sort === 'newest' ? 'desc' : 'asc';

  const { rows, ...pageInfo } = await findPage(
    prisma.payment,
    {
      where,
      // id ต่อท้ายทิศเดียวกัน ให้ลำดับคงที่ระหว่างหน้าแม้ส่งสลิปเวลาเดียวกัน
      orderBy: [{ slipUploadedAt: direction }, { id: direction }],
      include: {
        booking: QUEUE_BOOKING_INCLUDE,
        seatChange: SEAT_CHANGE_SUMMARY_SELECT,
        verifiedBy: { select: { id: true, name: true } },
      },
    },
    { page, pageSize },
  );

  const items = rows.map((payment) => ({
    id: payment.id,
    kind: payment.kind,
    seatChange: seatChangeSummary(payment.seatChange),
    status: payment.status,
    amount: payment.amount,
    reference: payment.reference,
    slipUploadedAt: payment.slipUploadedAt,
    hasSlip: Boolean(payment.slipPath),
    rejectReason: payment.rejectReason,
    verifiedAt: payment.verifiedAt,
    verifiedBy: payment.verifiedBy,
    booking: { ...shapeQueueBooking(payment.booking), createdAt: payment.booking.createdAt },
  }));
  return { items, ...pageInfo };
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
const settlePendingPayment = async (tx, payment, { paymentData, bookingData }) => {
  const bookingMoved = await tx.booking.updateMany({
    where: { id: payment.bookingId, status: 'PENDING_VERIFICATION' },
    data: bookingData,
  });
  const paymentMoved = await tx.payment.updateMany({
    where: { id: payment.id, status: 'PENDING_VERIFICATION' },
    data: paymentData,
  });
  if (paymentMoved.count === 0 || bookingMoved.count === 0) throw paymentNotPending();
};

/** อนุมัติสลิป → ออกตั๋ว + ใบเสร็จรับเงิน (และส่งใบเสร็จทางอีเมล) */
export const approvePayment = async ({ paymentId, adminId }) => {
  const payment = await loadPendingPayment(paymentId);
  // ส่วนต่างเปลี่ยนที่นั่งใช้คิวและปุ่มเดียวกัน แต่อนุมัติแล้วต้องย้ายที่นั่งจริง — มีขั้นตอนของตัวเอง
  if (payment.kind === 'SEAT_CHANGE_TOPUP') return approveTopUp({ payment, adminId });

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await settlePendingPayment(tx, payment, {
      paymentData: approvedPaymentData(adminId, now),
      bookingData: { status: 'PAID', paidAt: now, holdExpiresAt: null },
    });
    // ออกเลขหลังผ่านด่านเช็กสถานะแล้วเท่านั้น — ผู้ดูแลอีกคนที่กดใบเดียวกันพร้อมกันตกไปก่อนถึงตรงนี้ จึงไม่เปลืองเลข
    // ลำดับล็อก Booking → Payment → ReceiptCounter (แถว payment ถูกล็อกไว้แล้วตั้งแต่ settlePendingPayment)
    const receiptNo = await issueReceiptNo(tx, now);
    await tx.payment.update({
      where: { id: payment.id },
      // ตรึงชื่อและที่นั่งไว้กับใบเสร็จ — แก้ชื่อหรือเปลี่ยนที่นั่งทีหลัง ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม
      data: {
        receiptNo,
        receiptName: payment.booking.user.name,
        receiptSeats: payment.booking.seatSnapshot,
      },
    });
    await notify(
      {
        userId: payment.booking.userId,
        type: 'PAYMENT_APPROVED',
        context: { code: payment.booking.code, receiptNo },
        data: { bookingId: payment.bookingId },
      },
      tx,
    );
  });

  // ส่งหลัง commit แล้วเท่านั้น
  await emailReceipt(payment.bookingId);

  return getBookingById(payment.bookingId);
};

/**
 * ปฏิเสธสลิป — ปกติคืนการจองกลับไปสถานะรอชำระเงิน พร้อมให้เวลาใหม่
 * (ไม่ยกเลิกทิ้งทันที เพราะผู้ใช้อาจแค่แนบสลิปผิดรูป)
 *
 * ยกเว้นรอบเริ่มฉายไปแล้ว — เดิมระบบเปิดให้จ่ายใหม่อีก 10 นาทีสำหรับรอบที่ฉายไปแล้ว
 * ตอนนี้ปิดเป็นหมดเวลาแทน และส่งสลิปใหม่ไม่ได้อีก ถ้าเงินโอนมาจริง แจ้งเตือนบอกให้ติดต่อเจ้าหน้าที่
 */
export const rejectPayment = async ({ paymentId, adminId, reason }) => {
  const payment = await loadPendingPayment(paymentId);
  if (payment.kind === 'SEAT_CHANGE_TOPUP') return rejectTopUp({ payment, adminId, reason });
  const now = new Date();
  const showtimeStarted = payment.booking.showtime.startsAt <= now;
  const paymentData = rejectedPaymentData(adminId, now, reason);

  await prisma.$transaction(async (tx) => {
    if (showtimeStarted) {
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
        context: { code: payment.booking.code, reason, closed: showtimeStarted },
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
          // ชื่อผู้จ่ายและที่นั่งที่จะพิมพ์ลงใบเสร็จตอนอนุมัติ
          user: { select: { name: true } },
          seatSnapshot: true,
        },
      },
      // สลิปส่วนต่างเปลี่ยนที่นั่ง — อนุมัติแล้วต้องรู้ว่าย้ายจากไหนไปไหน
      seatChange: true,
    },
  });
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
  if (payment.status !== 'PENDING_VERIFICATION') {
    throw ApiError.conflict('PAYMENT_NOT_PENDING', 'รายการนี้ถูกตรวจสอบไปแล้ว');
  }
  // ส่วนต่างเปลี่ยนที่นั่งดูสถานะของคำขอ ไม่ใช่ของการจอง (การจองเป็น PAID ตลอดระหว่างนั้น)
  const live = payment.kind === 'SEAT_CHANGE_TOPUP' ? payment.seatChange?.status : payment.booking.status;
  if (live !== 'PENDING_VERIFICATION') {
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
export const listRefunds = async ({ status = 'REFUND_PENDING', sort, page, pageSize } = {}) => {
  const where =
    status === 'ALL' ? { status: { in: ['REFUND_PENDING', 'REFUNDED'] } } : { status };

  // คืนแล้วเรียงตามเวลาที่โอนคืน ที่เหลือเรียงตามเวลาที่เข้าคิว
  // ไม่ระบุ sort = รอคืน: ค้างนานสุดขึ้นก่อน (ใครรอก่อนได้ก่อน) · คืนแล้ว: ล่าสุดขึ้นก่อน
  const field = status === 'REFUNDED' ? 'refundedAt' : 'refundDueAt';
  const order = sort ?? (status === 'REFUNDED' ? 'newest' : 'oldest');
  const direction = order === 'newest' ? 'desc' : 'asc';

  const { rows, ...pageInfo } = await findPage(
    prisma.payment,
    {
      where,
      // id ต่อท้ายทิศเดียวกัน ให้ลำดับคงที่ระหว่างหน้าแม้เวลาเท่ากัน
      orderBy: [{ [field]: direction }, { id: direction }],
      include: {
        booking: QUEUE_BOOKING_INCLUDE,
        seatChange: SEAT_CHANGE_SUMMARY_SELECT,
        refundedBy: { select: { id: true, name: true } },
      },
    },
    { page, pageSize },
  );

  const items = rows.map((payment) => ({
    id: payment.id,
    // BOOKING = ยกเลิกหลังจ่ายเงิน · SEAT_CHANGE_REFUND = คืนส่วนต่างที่ย้ายไปที่ถูกกว่า
    kind: payment.kind,
    seatChange: seatChangeSummary(payment.seatChange),
    status: payment.status,
    amount: payment.amount,
    // ยอดที่ต้องโอนคืนจริง — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
    refundAmount: payment.refundAmount ?? payment.amount,
    reference: payment.reference,
    paidAt: payment.booking.paidAt,
    // เวลาที่ลูกค้าส่งสลิปของเงินก้อนนี้ (ส่วนต่างที่คืนจากการย้ายไปที่ถูกกว่าไม่มีสลิป = null)
    slipUploadedAt: payment.slipUploadedAt,
    refundDueAt: payment.refundDueAt,
    refundedAt: payment.refundedAt,
    refundedBy: payment.refundedBy,
    refundNote: payment.refundNote,
    refundBankName: payment.refundBankName,
    refundAccountNo: payment.refundAccountNo,
    refundAccountName: payment.refundAccountName,
    hasRefundSlip: Boolean(payment.refundSlipPath),
    booking: {
      ...shapeQueueBooking(payment.booking),
      cancelledAt: payment.booking.cancelledAt,
      cancelReason: payment.booking.cancelReason,
    },
  }));
  return { items, ...pageInfo };
};

/** ผู้ดูแลโอนคืนเองแล้วมาบันทึก ต้องแนบสลิปคืนเงิน เพราะลูกค้าเปิดดูเป็นหลักฐานได้ที่หน้าการจองของฉัน */
export const completeRefund = async ({ paymentId, adminId, note, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบสลิปการโอนคืน');

  await discardSlipOnError('refund', file, async () => {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { id: true, code: true, userId: true } } },
    });
    if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
    if (payment.status !== 'REFUND_PENDING') {
      throw ApiError.conflict(
        'REFUND_NOT_PENDING',
        payment.status === 'REFUNDED'
          ? 'รายการนี้คืนเงินไปแล้ว'
          : 'รายการนี้ไม่ได้อยู่ในสถานะรอคืนเงิน',
      );
    }

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
          context: { code: payment.booking.code, amount: payment.refundAmount ?? payment.amount },
          data: { bookingId: payment.bookingId },
        },
        tx,
      );
    });
  });
};

/**
 * แก้รายการที่บันทึกคืนเงินไปแล้ว — เปลี่ยนสลิป (ถ้าแนบมาใหม่) และหมายเหตุ
 * ไม่แตะสถานะ/เวลาคืนเงิน และไม่แจ้งเตือนลูกค้าซ้ำ เพราะเงินถูกโอนไปแล้วจริง แค่แก้หลักฐานให้ถูก
 */
export const updateRefund = async ({ paymentId, note, file }) => {
  const previousSlip = await discardSlipOnError('refund', file, async () => {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'ไม่พบรายการชำระเงินนี้');
    if (payment.status !== 'REFUNDED') {
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
      throw ApiError.conflict('REFUND_NOT_COMPLETED', 'รายการนี้ยังไม่ได้บันทึกการคืนเงิน');
    }
    return payment.refundSlipPath;
  });

  // สลิปเก่าไม่มีใครอ้างถึงแล้ว ลบทิ้งหลังบันทึกสำเร็จเท่านั้น
  if (file && previousSlip) {
    await removeSlip('refund', previousSlip);
  }
};

/** ชื่อไฟล์สลิปคืนเงิน — เจ้าของการจองหรือ admin เท่านั้น เหมือนสลิปฝั่งจ่ายเงิน (paymentId = คืนส่วนต่างเปลี่ยนที่นั่ง) */
export const getRefundSlipFileName = ({ bookingId, paymentId, requester }) => {
  return slipFileName({
    bookingId,
    paymentId,
    requester,
    field: 'refundSlipPath',
    notFound: () =>
      ApiError.notFound('REFUND_SLIP_NOT_FOUND', 'ยังไม่มีสลิปคืนเงินสำหรับรายการนี้'),
  });
};
