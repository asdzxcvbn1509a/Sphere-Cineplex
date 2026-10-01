import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes, bangkokDayRange, formatBangkokShort } from '../utils/datetime.js';
import { generateBookingCode, generatePaymentReference } from '../utils/codes.js';
import { priceSeats, toPriceMap } from '../utils/pricing.js';
import { createPromptPayPayload } from '../utils/promptpay.js';
import { buildNotification, notify } from './notifications.js';
import { getShowtimeById } from './showtimes.js';

const bookingInclude = {
  showtime: {
    include: {
      movie: { select: { id: true, titleTh: true, titleEn: true, posterUrl: true, durationMin: true } },
      theatre: { select: { id: true, name: true, screenType: true } },
    },
  },
  payment: true,
};

const sortSeats = (seats) => {
  return [...seats].sort(
    (a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber,
  );
};

export const seatLabel = (seat) => {
  return `${seat.rowLabel}${seat.seatNumber}`;
};

/** เวลาที่เหลือของ hold (วินาที) — null แปลว่าไม่ได้กำลังนับถอยหลัง */
const holdSecondsLeft = (booking) => {
  if (!booking.holdExpiresAt) return null;
  return Math.max(0, Math.floor((booking.holdExpiresAt.getTime() - Date.now()) / 1000));
};

const canCancel = (booking) => {
  if (booking.status === 'PENDING_PAYMENT') return true;
  // ส่งสลิปแล้วรอผู้ดูแลตัดสิน — ยกเลิกเองไม่ได้ ไม่งั้นเงินที่โอนมาแล้วจะหลุดออกนอกระบบ
  if (booking.status === 'PENDING_VERIFICATION') return false;
  if (booking.status !== 'PAID') return false;
  const cutoffMs = env.CANCEL_CUTOFF_HOURS * 60 * 60 * 1000;
  return booking.showtime.startsAt.getTime() - Date.now() >= cutoffMs;
};

export const shapeBooking = (booking) => {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    totalAmount: booking.totalAmount,
    holdExpiresAt: booking.holdExpiresAt,
    holdSecondsLeft: holdSecondsLeft(booking),
    seats: booking.seatSnapshot,
    createdAt: booking.createdAt,
    paidAt: booking.paidAt,
    cancelledAt: booking.cancelledAt,
    cancelReason: booking.cancelReason,
    canCancel: canCancel(booking),
    cancelCutoffHours: env.CANCEL_CUTOFF_HOURS,
    showtime: {
      id: booking.showtime.id,
      startsAt: booking.showtime.startsAt,
      endsAt: booking.showtime.endsAt,
      movie: booking.showtime.movie,
      theatre: booking.showtime.theatre,
    },
    payment: booking.payment
      ? {
          id: booking.payment.id,
          status: booking.payment.status,
          amount: booking.payment.amount,
          reference: booking.payment.reference,
          slipUploadedAt: booking.payment.slipUploadedAt,
          refundBankName: booking.payment.refundBankName,
          refundAccountNo: booking.payment.refundAccountNo,
          hasSlip: Boolean(booking.payment.slipPath),
          rejectReason: booking.payment.rejectReason,
          refundedAt: booking.payment.refundedAt,
          refundNote: booking.payment.refundNote,
          hasRefundSlip: Boolean(booking.payment.refundSlipPath),
        }
      : null,
    ...(booking.user && {
      user: { id: booking.user.id, name: booking.user.name, phone: booking.user.phone },
    }),
  };
};

/**
 * สร้างการจอง
 *
 * ด่านกันจองซ้ำอยู่ที่ @@unique([showtimeId, seatId]) บนตาราง BookingSeat
 * ถ้าสองคนกดพร้อมกัน PostgreSQL จะปล่อยให้ transaction เดียวผ่าน อีกอันได้ P2002
 * แล้วเราแปลงเป็น 409 พร้อมบอกว่าที่นั่งไหนโดนตัดหน้าไป
 */
export const createBooking = async ({ userId, showtimeId, seatIds }) => {
  const uniqueSeatIds = [...new Set(seatIds)];
  if (uniqueSeatIds.length === 0) {
    throw ApiError.badRequest('NO_SEATS', 'กรุณาเลือกที่นั่งอย่างน้อย 1 ที่');
  }
  if (uniqueSeatIds.length > env.MAX_SEATS_PER_BOOKING) {
    throw ApiError.badRequest(
      'TOO_MANY_SEATS',
      `จองได้สูงสุด ${env.MAX_SEATS_PER_BOOKING} ที่นั่งต่อครั้ง`,
    );
  }

  const showtime = await prisma.showtime.findUnique({
    where: { id: showtimeId },
    include: { zonePrices: true },
  });
  if (!showtime) throw ApiError.notFound('SHOWTIME_NOT_FOUND', 'ไม่พบรอบฉายนี้');
  if (showtime.status !== 'SCHEDULED') {
    throw ApiError.badRequest('SHOWTIME_CANCELLED', 'รอบฉายนี้ถูกยกเลิกแล้ว');
  }
  if (showtime.startsAt <= new Date()) {
    throw ApiError.badRequest('SHOWTIME_STARTED', 'รอบฉายนี้เริ่มไปแล้ว กรุณาเลือกรอบอื่น');
  }

  const seats = await prisma.seat.findMany({
    where: { id: { in: uniqueSeatIds }, theatreId: showtime.theatreId, isActive: true },
  });
  if (seats.length !== uniqueSeatIds.length) {
    throw ApiError.badRequest('INVALID_SEATS', 'มีที่นั่งบางที่ไม่ถูกต้องสำหรับรอบฉายนี้');
  }

  const priceMap = toPriceMap(showtime.zonePrices, showtime.basePrice);
  const { items, total } = priceSeats(seats, priceMap);
  const seatSnapshot = sortSeats(seats).map((seat) => ({
    id: seat.id,
    rowLabel: seat.rowLabel,
    seatNumber: seat.seatNumber,
    label: seatLabel(seat),
    zone: seat.zone,
    price: priceMap[seat.zone],
  }));

  try {
    const created = await prisma.$transaction(async (tx) => {
      // ล็อกแถวรอบฉายแบบแชร์ไว้จนจบ transaction — ถ้าผู้ดูแลกำลังยกเลิกรอบนี้อยู่ ตรงนี้จะรอจนเขาเสร็จ
      // แล้วเห็นสถานะใหม่ ไม่งั้นการจองที่เข้ามาพอดีจังหวะจะหลุดไปค้างอยู่ในรอบที่ถูกยกเลิกแล้ว
      const [live] = await tx.$queryRaw`
        SELECT "status" FROM "Showtime" WHERE "id" = ${showtimeId} FOR SHARE`;
      if (live?.status !== 'SCHEDULED') {
        throw ApiError.badRequest('SHOWTIME_CANCELLED', 'รอบฉายนี้ถูกยกเลิกแล้ว');
      }

      const booking = await tx.booking.create({
        data: {
          code: generateBookingCode(),
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: total,
          holdExpiresAt: addMinutes(new Date(), env.SEAT_HOLD_MINUTES),
          seatSnapshot,
          seats: {
            create: items.map((item) => ({
              showtimeId,
              seatId: item.seatId,
              price: item.price,
            })),
          },
        },
      });

      await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount: total,
          qrPayload: createPromptPayPayload(total),
          reference: generatePaymentReference(),
        },
      });

      return booking;
    });

    return getBookingById(created.id);
  } catch (err) {
    if (err?.code === 'P2002' && String(err.meta?.target ?? '').includes('showtimeId')) {
      const taken = await prisma.bookingSeat.findMany({
        where: { showtimeId, seatId: { in: uniqueSeatIds } },
        include: { seat: true },
      });
      throw ApiError.conflict(
        'SEAT_TAKEN',
        'มีผู้อื่นจองที่นั่งนี้ไปก่อนแล้ว กรุณาเลือกที่นั่งใหม่',
        { seats: sortSeats(taken.map((row) => row.seat)).map(seatLabel) },
      );
    }
    throw err;
  }
};

export const getBookingById = async (id, { userId } = {}) => {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      ...bookingInclude,
      user: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (userId && booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }
  return shapeBooking(booking);
};

export const listMyBookings = async (userId, { scope = 'all' } = {}) => {
  const now = new Date();
  const where = { userId };

  if (scope === 'upcoming') {
    where.status = { in: ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID'] };
    where.showtime = { startsAt: { gte: now } };
  } else if (scope === 'history') {
    where.OR = [
      { status: { in: ['CANCELLED', 'EXPIRED'] } },
      { showtime: { startsAt: { lt: now } } },
    ];
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: bookingInclude,
    orderBy: { createdAt: 'desc' },
  });
  return bookings.map(shapeBooking);
};

/** ยกเลิกการจอง — ปล่อยที่นั่งคืนด้วยการลบแถว BookingSeat */
export const cancelBooking = async ({
  bookingId,
  userId,
  byAdmin = false,
  reason,
  refundAccount,
} = {}) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { showtime: true, payment: true },
  });
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (!byAdmin && booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์ยกเลิกรายการจองนี้');
  }
  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
    throw ApiError.conflict('ALREADY_CLOSED', 'รายการนี้ถูกยกเลิกหรือหมดอายุไปแล้ว');
  }

  // ระหว่างที่สลิปอยู่ในคิวตรวจ ห้ามผู้ใช้ยกเลิกเอง ต้องรอผลอนุมัติ/ปฏิเสธก่อน
  // ถ้าปล่อยให้ยกเลิกตรงนี้ ใบชำระเงินจะถูกปิดเป็น REJECTED ทั้งที่อาจโอนเงินมาแล้วจริง
  if (!byAdmin && booking.status === 'PENDING_VERIFICATION') {
    throw ApiError.conflict(
      'AWAITING_VERIFICATION',
      'สลิปกำลังรอผู้ดูแลตรวจสอบ กรุณารอผลอนุมัติหรือปฏิเสธก่อนจึงจะยกเลิกได้',
    );
  }

  if (!byAdmin && booking.status === 'PAID') {
    const hoursLeft = (booking.showtime.startsAt.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursLeft < env.CANCEL_CUTOFF_HOURS) {
      throw ApiError.forbidden(
        'CANCEL_WINDOW_CLOSED',
        `ยกเลิกได้ก่อนรอบฉายอย่างน้อย ${env.CANCEL_CUTOFF_HOURS} ชั่วโมงเท่านั้น`,
        { cancelCutoffHours: env.CANCEL_CUTOFF_HOURS, hoursLeft: Math.max(hoursLeft, 0) },
      );
    }
  }

  // ใบที่จ่ายเงินมาแล้วต้องรู้ปลายทางก่อน ไม่งั้นผู้ดูแลได้แต่คิวคืนเงินที่โอนคืนไม่ได้
  const willRefund = booking.payment?.status === 'APPROVED';
  const bankName = refundAccount?.bankName?.trim();
  const accountNo = refundAccount?.accountNo?.trim();
  if (willRefund && !byAdmin && !(bankName && accountNo)) {
    throw ApiError.badRequest(
      'REFUND_ACCOUNT_REQUIRED',
      'กรุณาระบุธนาคารและเลขที่บัญชีสำหรับรับเงินคืน',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.bookingSeat.deleteMany({ where: { bookingId } });
    const cancelReason = reason ?? (byAdmin ? 'ยกเลิกโดยผู้ดูแลระบบ' : 'ผู้ใช้ยกเลิกเอง');
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        holdExpiresAt: null,
        cancelReason,
      },
    });
    // ปิดใบชำระเงินที่ยังรอดำเนินการ ไม่งั้นสลิปจะค้างอยู่ในคิวตรวจของ admin ตลอดไป
    await tx.payment.updateMany({
      where: { bookingId, status: { in: ['AWAITING_SLIP', 'PENDING_VERIFICATION'] } },
      data: { status: 'REJECTED', rejectReason: cancelReason },
    });

    // ใบที่จ่ายเงินมาแล้วจริง ต้องเข้าคิวรอผู้ดูแลโอนเงินคืน
    // ระบบไม่ได้ตัดเงินเอง จึงคืนเองไม่ได้ หน้าที่ของระบบคือไม่ปล่อยให้ลืม
    await tx.payment.updateMany({
      where: { bookingId, status: 'APPROVED' },
      data: {
        status: 'REFUND_PENDING',
        refundDueAt: new Date(),
        ...(bankName && { refundBankName: bankName }),
        ...(accountNo && { refundAccountNo: accountNo }),
      },
    });
    await notify(
      {
        userId: booking.userId,
        type: 'BOOKING_CANCELLED',
        context: { code: booking.code },
        data: { bookingId },
      },
      tx,
    );
  });

  return getBookingById(bookingId);
};

/**
 * ลูกค้าแจ้ง (หรือแก้) บัญชีรับเงินคืนเอง ใช้ได้ตลอดที่ใบนั้นยังรอโอนคืนอยู่
 *
 * ใบที่ผู้ดูแลยกเลิกแทน — ยกเลิกทั้งรอบ หรือลูกค้าโทรมาให้ยกเลิก — ไม่มีบัญชีติดมาด้วย
 * ถ้าไม่มีช่องให้ลูกค้ากรอกเอง ผู้ดูแลต้องไล่โทรถามทีละคน ซึ่งยกเลิกทั้งรอบทีอาจเป็นร้อยสาย
 */
export const updateRefundAccount = async ({ bookingId, userId, bankName, accountNo }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true },
  });
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์แก้ไขรายการจองนี้');
  }

  // เงื่อนไขสถานะอยู่ใน where เลย — ถ้าผู้ดูแลเพิ่งกดว่าโอนคืนแล้ว บัญชีที่ใช้โอนไปต้องไม่ถูกเขียนทับ
  const { count } = await prisma.payment.updateMany({
    where: { bookingId, status: 'REFUND_PENDING' },
    data: { refundBankName: bankName.trim(), refundAccountNo: accountNo },
  });
  if (count === 0) {
    throw ApiError.conflict(
      'REFUND_NOT_PENDING',
      'รายการนี้ไม่ได้รอคืนเงินอยู่แล้ว จึงแก้บัญชีรับเงินคืนไม่ได้',
    );
  }

  return getBookingById(bookingId, { userId });
};

/**
 * ปล่อยที่นั่งของการจองที่หมดเวลาชำระเงิน — เรียกจาก background job
 * นับเฉพาะ PENDING_PAYMENT เท่านั้น การจองที่รอ admin ตรวจสลิปมี holdExpiresAt = null จึงไม่โดน
 */
export const releaseExpiredHolds = async () => {
  const expired = await prisma.booking.findMany({
    where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } },
    select: { id: true, code: true, userId: true },
  });
  if (expired.length === 0) return 0;

  for (const booking of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.bookingSeat.deleteMany({ where: { bookingId: booking.id } });
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'EXPIRED',
          holdExpiresAt: null,
          cancelReason: 'หมดเวลาชำระเงิน',
        },
      });
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: 'AWAITING_SLIP' },
        data: { status: 'REJECTED', rejectReason: 'หมดเวลาชำระเงิน' },
      });
      await notify(
        {
          userId: booking.userId,
          type: 'BOOKING_EXPIRED',
          context: { code: booking.code },
          data: { bookingId: booking.id },
        },
        tx,
      );
    });
  }

  return expired.length;
};

/** ข้อมูลสำหรับ E-Ticket — ออกให้เฉพาะรายการที่ชำระเงินแล้ว */
export const getTicket = async ({ bookingId, userId }) => {
  const booking = await getBookingById(bookingId, { userId });
  if (booking.status !== 'PAID') {
    throw ApiError.forbidden('TICKET_NOT_READY', 'ตั๋วจะออกให้หลังการชำระเงินได้รับการยืนยันแล้ว');
  }
  return {
    ...booking,
    ticketQr: booking.code,
  };
};

// ---------- ฝั่ง Admin ----------

const pendingSlipsError = (count) => {
  return ApiError.conflict(
    'SHOWTIME_HAS_PENDING_SLIPS',
    `รอบนี้มีสลิปรอตรวจ ${count} รายการ กรุณาอนุมัติหรือปฏิเสธให้เสร็จก่อนจึงจะยกเลิกรอบได้`,
    { count },
  );
};

/**
 * ยกเลิกทั้งรอบ (เครื่องฉายเสีย โรงปิดซ่อม ฯลฯ) — ปิดทุกการจองของรอบนี้ในคราวเดียว
 *
 * ใบที่จ่ายแล้วเข้าคิวคืนเงินเหมือนตอนลูกค้ายกเลิกเอง ใบที่ยังไม่จ่ายถูกปิดและคืนที่นั่ง
 * ส่วนสลิปที่ยังรอตรวจต้องให้ผู้ดูแลตัดสินก่อน เพราะยังไม่รู้ว่าเงินเข้าจริงไหม
 * ถ้ายกเลิกทับไปเลย ใบนั้นจะไม่มีทางไปต่อ — จะคืนเงินก็ไม่รู้ว่ามีเงินให้คืนหรือเปล่า
 *
 * ทำทั้งหมดใน transaction เดียวด้วยคำสั่งแบบกลุ่ม จำนวน query จึงคงที่ไม่ว่ารอบนั้นจะมีกี่การจอง
 */
export const cancelShowtime = async ({ showtimeId, reason }) => {
  const showtime = await prisma.showtime.findUnique({
    where: { id: showtimeId },
    include: { movie: { select: { titleTh: true, titleEn: true } } },
  });
  if (!showtime) throw ApiError.notFound('SHOWTIME_NOT_FOUND', 'ไม่พบรอบฉายนี้');
  if (showtime.status === 'CANCELLED') {
    throw ApiError.conflict('SHOWTIME_ALREADY_CANCELLED', 'รอบนี้ถูกยกเลิกไปแล้ว');
  }
  if (showtime.endsAt <= new Date()) {
    throw ApiError.conflict('SHOWTIME_ENDED', 'รอบนี้ฉายจบไปแล้ว ยกเลิกย้อนหลังไม่ได้');
  }

  const pendingSlips = await prisma.booking.count({
    where: { showtimeId, status: 'PENDING_VERIFICATION' },
  });
  if (pendingSlips > 0) throw pendingSlipsError(pendingSlips);

  const note = reason?.trim() || null;
  const cancelReason = note ? `รอบฉายถูกยกเลิก: ${note}` : 'รอบฉายถูกยกเลิก';
  const context = {
    movieTh: showtime.movie.titleTh,
    movieEn: showtime.movie.titleEn,
    whenTh: formatBangkokShort(showtime.startsAt, 'th'),
    whenEn: formatBangkokShort(showtime.startsAt, 'en'),
    reason: note,
  };

  const result = await prisma.$transaction(async (tx) => {
    // เปลี่ยนสถานะรอบก่อน — การจองใหม่ที่กำลังเข้ามาจะรอล็อกแถวนี้ แล้วเห็นว่ารอบถูกยกเลิก
    const closed = await tx.showtime.updateMany({
      where: { id: showtimeId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
    if (closed.count === 0) {
      throw ApiError.conflict('SHOWTIME_ALREADY_CANCELLED', 'รอบนี้ถูกยกเลิกไปแล้ว');
    }

    const bookings = await tx.booking.findMany({
      where: { showtimeId, status: { in: ['PENDING_PAYMENT', 'PAID'] } },
      select: { id: true, code: true, userId: true, status: true },
    });
    const ids = bookings.map((booking) => booking.id);
    const now = new Date();

    if (ids.length > 0) {
      const updated = await tx.booking.updateMany({
        where: { id: { in: ids }, status: { in: ['PENDING_PAYMENT', 'PAID'] } },
        data: { status: 'CANCELLED', cancelledAt: now, holdExpiresAt: null, cancelReason },
      });
      // มีใบไหนเปลี่ยนสถานะไประหว่างทาง (ส่งสลิปพอดี หมดเวลาพอดี) — ยกเลิกทั้งชุด ให้ผู้ดูแลกดใหม่
      if (updated.count !== ids.length) {
        throw ApiError.conflict(
          'BOOKING_STATE_CHANGED',
          'มีการจองในรอบนี้เปลี่ยนสถานะระหว่างยกเลิก กรุณาลองใหม่อีกครั้ง',
        );
      }
    }

    // สลิปที่ส่งเข้ามาหลังเช็กรอบแรก — ต้องให้ผู้ดูแลตรวจก่อนเหมือนกัน
    const slipsArrived = await tx.booking.count({
      where: { showtimeId, status: 'PENDING_VERIFICATION' },
    });
    if (slipsArrived > 0) throw pendingSlipsError(slipsArrived);

    if (ids.length === 0) return { cancelledBookings: 0, refundsQueued: 0 };

    await tx.bookingSeat.deleteMany({ where: { bookingId: { in: ids } } });
    await tx.payment.updateMany({
      where: { bookingId: { in: ids }, status: { in: ['AWAITING_SLIP', 'REJECTED'] } },
      data: { status: 'REJECTED', rejectReason: cancelReason },
    });
    // ไม่มีบัญชีปลายทางติดมา ลูกค้าแจ้งเองได้ที่หน้าการจองของฉัน (updateRefundAccount)
    const refunds = await tx.payment.updateMany({
      where: { bookingId: { in: ids }, status: 'APPROVED' },
      data: { status: 'REFUND_PENDING', refundDueAt: now },
    });
    await tx.notification.createMany({
      data: bookings.map((booking) =>
        buildNotification({
          userId: booking.userId,
          type: 'SHOWTIME_CANCELLED',
          context: { ...context, code: booking.code, refund: booking.status === 'PAID' },
          data: { bookingId: booking.id, showtimeId },
        }),
      ),
    });

    return { cancelledBookings: ids.length, refundsQueued: refunds.count };
  });

  return { showtime: await getShowtimeById(showtimeId), ...result };
};

export const listAllBookings = async ({ status, date, q, take = 100 } = {}) => {
  const where = {};
  if (status) where.status = status;
  if (date) {
    const range = bangkokDayRange(date);
    if (range) where.showtime = { startsAt: { gte: range.start, lt: range.end } };
  }
  if (q) {
    where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { user: { phone: { contains: q } } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: { ...bookingInclude, user: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return bookings.map(shapeBooking);
};
