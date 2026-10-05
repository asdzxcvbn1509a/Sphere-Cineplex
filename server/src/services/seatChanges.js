import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { generatePaymentReference } from '../utils/codes.js';
import { toPriceMap } from '../utils/pricing.js';
import { createPromptPayPayload } from '../utils/promptpay.js';
import { planSeatChange, sameZones } from '../utils/seatChange.js';
import { removeSlip } from '../lib/slipStorage.js';
import { notify } from './notifications.js';
import { emailReceipt, issueReceiptNo } from './receipts.js';
import {
  OPEN_SEAT_CHANGE_STATUSES,
  SLIP_ACCEPTING_PAYMENT_STATUSES,
  bookingStateChanged,
  countsTowardSeatChangeQuota,
  getBookingById,
  isSeatConflict,
  seatChangeBlocker,
  seatTakenError,
  shapeSeatChange,
} from './bookings.js';

/**
 * เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว (จำนวนที่นั่งเท่าเดิม)
 *
 * - ราคาเท่าเดิม / ถูกลง → ย้ายทันทีในคราวเดียว (ถูกลง = ส่วนต่างเข้าคิวคืนเงินที่ /admin/refunds)
 * - แพงขึ้น → กันที่นั่งใหม่ไว้ SEAT_HOLD_MINUTES รอโอนส่วนต่าง ระหว่างนี้ที่นั่งเดิมยังเป็นของลูกค้า
 *   ย้ายจริงเมื่อผู้ดูแลอนุมัติสลิปส่วนต่าง (คิวตรวจสลิปเดียวกับค่าตั๋ว) แล้วออกใบเสร็จส่วนต่างให้
 *
 * ลำดับล็อกทั้งระบบ: Showtime (FOR SHARE) → Booking → SeatChange → BookingSeat → Payment → ReceiptCounter
 * ทุกฟังก์ชันในไฟล์นี้ล็อกตามลำดับนี้ สองรายการที่ชนกันจึงต่อคิวกัน ไม่รอกันเองจน deadlock
 */

const seatIdsKey = (seats) => {
  return (seats ?? [])
    .map((seat) => seat.id)
    .sort()
    .join();
};

const labels = (seats) => (seats ?? []).map((seat) => seat.label).join(', ');

const pendingError = (seatChangeId) => {
  return ApiError.conflict(
    'SEAT_CHANGE_PENDING',
    'มีคำขอเปลี่ยนที่นั่งที่ยังไม่เสร็จอยู่ กรุณาชำระส่วนต่างหรือยกเลิกคำขอเดิมก่อน',
    { seatChangeId },
  );
};

const limitError = () => {
  return ApiError.conflict(
    'SEAT_CHANGE_LIMIT',
    `เปลี่ยนที่นั่งได้สูงสุด ${env.MAX_SEAT_CHANGES_PER_BOOKING} ครั้งต่อการจอง`,
    { max: env.MAX_SEAT_CHANGES_PER_BOOKING },
  );
};

const notAllowedError = () => {
  return ApiError.conflict('SEAT_CHANGE_NOT_ALLOWED', 'เปลี่ยนที่นั่งได้เฉพาะการจองที่ชำระเงินแล้ว');
};

const showtimeCancelledError = () => {
  return ApiError.badRequest('SHOWTIME_CANCELLED', 'รอบฉายนี้ถูกยกเลิกแล้ว');
};

const notPayable = () => {
  return ApiError.conflict('SEAT_CHANGE_NOT_PAYABLE', 'คำขอนี้ไม่อยู่ในสถานะที่ชำระส่วนต่างได้แล้ว');
};

/** แปลงเหตุผลจาก seatChangeBlocker เป็น error ที่หน้าเว็บเลือกข้อความได้ */
const blockedError = (reason, booking) => {
  switch (reason) {
    case 'NOT_PAID':
      return notAllowedError();
    case 'SHOWTIME_CANCELLED':
      return showtimeCancelledError();
    case 'WINDOW_CLOSED':
      return ApiError.forbidden(
        'SEAT_CHANGE_WINDOW_CLOSED',
        `เปลี่ยนที่นั่งได้ก่อนรอบฉายอย่างน้อย ${env.SEAT_CHANGE_CUTOFF_MINUTES} นาทีเท่านั้น`,
        { cutoffMinutes: env.SEAT_CHANGE_CUTOFF_MINUTES },
      );
    case 'PENDING':
      return pendingError(
        booking.seatChanges.find((change) => OPEN_SEAT_CHANGE_STATUSES.includes(change.status))?.id,
      );
    default:
      return limitError();
  }
};

const loadBooking = (bookingId) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      showtime: { include: { zonePrices: true } },
      seatChanges: { select: { id: true, status: true, byAdmin: true } },
    },
  });
};

/** คิดชุดที่นั่งใหม่จาก id ที่ลูกค้าเลือก — ที่นั่งต้องอยู่ในโรงของรอบนี้ และที่นั่งใหม่ต้องเปิดใช้งาน */
const planFor = async (booking, seatIds) => {
  const ids = [...new Set(seatIds)];
  const seats = await prisma.seat.findMany({
    where: { id: { in: ids }, theatreId: booking.showtime.theatreId },
  });
  // ที่นั่งที่คงไว้ใช้ต่อได้แม้ผู้ดูแลเพิ่งปิดใช้งาน (เป็นของลูกค้าอยู่แล้ว) ส่วนที่นั่งใหม่ต้องยังเปิดขายอยู่
  const current = new Set(booking.seatSnapshot.map((seat) => seat.id));
  if (seats.length !== ids.length || seats.some((seat) => !current.has(seat.id) && !seat.isActive)) {
    throw ApiError.badRequest('INVALID_SEATS', 'มีที่นั่งบางที่ไม่ถูกต้องสำหรับรอบฉายนี้');
  }
  return planSeatChange({
    fromSeats: booking.seatSnapshot,
    newSeats: seats,
    priceMap: toPriceMap(booking.showtime.zonePrices, booking.showtime.basePrice),
  });
};

const seatsChangedContext = (booking, change, extra = {}) => {
  return {
    code: booking.code,
    from: labels(change.fromSeats),
    to: labels(change.toSeats),
    diff: change.diffAmount,
    byAdmin: change.byAdmin,
    reason: change.reason,
    ...extra,
  };
};

const changeData = (booking, plan, extra) => {
  return {
    bookingId: booking.id,
    fromSeats: booking.seatSnapshot,
    toSeats: plan.toSeats,
    fromAmount: plan.fromAmount,
    toAmount: plan.toAmount,
    diffAmount: plan.diffAmount,
    ...extra,
  };
};

/** ราคาเท่าเดิมหรือถูกลง — ย้ายเสร็จในคราวเดียว */
const completeNow = async (tx, { booking, plan, now, refundAccount, admin }) => {
  const change = await tx.seatChange.create({
    data: changeData(booking, plan, {
      status: 'COMPLETED',
      completedAt: now,
      byAdmin: Boolean(admin),
      adminId: admin?.id ?? null,
      reason: admin?.reason ?? null,
    }),
  });

  // ปล่อยที่นั่งเดิมที่ไม่ได้ไปต่อ แล้วจองที่นั่งใหม่ — ที่นั่งใหม่ชนกับคนอื่น = P2002 แล้วทั้ง transaction ย้อนกลับ
  // การจองจึงยังอยู่ที่นั่งเดิมครบ ไม่มีจังหวะที่ลูกค้าเสียที่นั่งเดิมไปก่อนได้ที่ใหม่
  await tx.bookingSeat.deleteMany({
    where: { bookingId: booking.id, seatChangeId: null, seatId: { in: plan.released } },
  });
  await tx.bookingSeat.createMany({
    data: plan.added.map((item) => ({
      bookingId: booking.id,
      showtimeId: booking.showtimeId,
      seatId: item.seatId,
      price: item.price,
    })),
  });
  await tx.booking.update({
    where: { id: booking.id },
    data: { seatSnapshot: plan.toSeats, totalAmount: plan.toAmount },
  });

  let payment = null;
  if (plan.diffAmount < 0) {
    // ส่วนต่างที่ต้องคืน — ระบบไม่ได้ตัดเงินเอง จึงเข้าคิวให้ผู้ดูแลโอนคืนเหมือนยกเลิกหลังจ่ายเงิน
    payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        kind: 'SEAT_CHANGE_REFUND',
        seatChangeId: change.id,
        amount: -plan.diffAmount,
        refundAmount: -plan.diffAmount,
        reference: generatePaymentReference(),
        status: 'REFUND_PENDING',
        refundDueAt: now,
        refundBankName: refundAccount.bankName,
        refundAccountNo: refundAccount.accountNo,
      },
    });
  }

  await notify(
    {
      userId: booking.userId,
      type: 'SEATS_CHANGED',
      context: seatsChangedContext(booking, change),
      data: { bookingId: booking.id, seatChangeId: change.id },
    },
    tx,
  );
  return { ...change, payment };
};

/** แพงขึ้น — กันที่นั่งใหม่ไว้รอโอนส่วนต่าง ที่นั่งเดิมยังเป็นของลูกค้าจนกว่าผู้ดูแลจะยืนยันยอด */
const holdForTopUp = async (tx, { booking, plan, now }) => {
  const change = await tx.seatChange.create({
    data: changeData(booking, plan, {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: addMinutes(now, env.SEAT_HOLD_MINUTES),
    }),
  });
  await tx.bookingSeat.createMany({
    data: plan.added.map((item) => ({
      bookingId: booking.id,
      showtimeId: booking.showtimeId,
      seatId: item.seatId,
      price: item.price,
      seatChangeId: change.id,
    })),
  });
  const payment = await tx.payment.create({
    data: {
      bookingId: booking.id,
      kind: 'SEAT_CHANGE_TOPUP',
      seatChangeId: change.id,
      amount: plan.diffAmount,
      qrPayload: createPromptPayPayload(plan.diffAmount),
      reference: generatePaymentReference(),
    },
  });
  return { ...change, payment };
};

/**
 * บันทึกการเปลี่ยนที่นั่ง — ใช้ทั้งลูกค้าย้ายเองและผู้ดูแลย้ายแทน (admin = { id, reason })
 * ด่านจริงอยู่ใน transaction หลังล็อกแถวการจองแล้ว: ยัง PAID อยู่ ที่นั่งยังเป็นชุดที่ใช้คิดส่วนต่าง ไม่มีคำขอค้าง และโควตายังเหลือ
 */
const applySeatChange = async ({ booking, plan, refundAccount, admin = null }) => {
  const now = new Date();
  try {
    const change = await prisma.$transaction(async (tx) => {
      // ล็อกแถวรอบฉายแบบแชร์แบบเดียวกับตอนจอง — ถ้าผู้ดูแลกำลังยกเลิกทั้งรอบ ตรงนี้รอจนเขาเสร็จแล้วเห็นสถานะใหม่
      const [showtime] = await tx.$queryRaw`
        SELECT "status" FROM "Showtime" WHERE "id" = ${booking.showtimeId} FOR SHARE`;
      if (showtime?.status !== 'SCHEDULED') throw showtimeCancelledError();

      // ล็อกแถวการจอง แล้วยืนยันว่ายังเป็นที่นั่งชุดเดียวกับที่ใช้คิดส่วนต่าง — สองคำขอที่มาพร้อมกันต่อคิวกันตรงนี้
      // คำขอที่ช้ากว่าเห็นที่นั่งชุดใหม่แล้วจึงตกไป แทนที่จะลบที่นั่งตามชุดเก่า จนเหลือที่นั่งค้างที่ไม่มีใครจ่าย
      const [live] = await tx.$queryRaw`
        SELECT "status", "seatSnapshot" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
      if (live?.status !== 'PAID' || seatIdsKey(live.seatSnapshot) !== seatIdsKey(booking.seatSnapshot)) {
        throw bookingStateChanged();
      }

      const changes = await tx.seatChange.findMany({
        where: { bookingId: booking.id },
        select: { id: true, status: true, byAdmin: true },
      });
      const open = changes.find((item) => OPEN_SEAT_CHANGE_STATUSES.includes(item.status));
      if (open) throw pendingError(open.id);
      if (!admin && changes.filter(countsTowardSeatChangeQuota).length >= env.MAX_SEAT_CHANGES_PER_BOOKING) {
        throw limitError();
      }

      return plan.diffAmount > 0
        ? holdForTopUp(tx, { booking, plan, now })
        : completeNow(tx, { booking, plan, now, refundAccount, admin });
    });

    return { booking: await getBookingById(booking.id), seatChange: shapeSeatChange(change) };
  } catch (err) {
    if (isSeatConflict(err)) {
      throw await seatTakenError(
        booking.showtimeId,
        plan.added.map((item) => item.seatId),
      );
    }
    throw err;
  }
};

/** ลูกค้าขอเปลี่ยนที่นั่งเอง */
export const requestSeatChange = async ({ bookingId, userId, seatIds, refundAccount }) => {
  const booking = await loadBooking(bookingId);
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เปลี่ยนที่นั่งของรายการจองนี้');
  }
  const blocked = seatChangeBlocker(booking);
  if (blocked) throw blockedError(blocked, booking);

  const plan = await planFor(booking, seatIds);

  // ย้ายไปที่นั่งที่ถูกกว่า — ส่วนต่างต้องโอนคืนด้วยมือ จึงต้องรู้บัญชีปลายทางก่อน (แบบเดียวกับยกเลิกหลังจ่ายเงิน)
  const bankName = refundAccount?.bankName?.trim();
  const accountNo = refundAccount?.accountNo?.trim();
  if (plan.diffAmount < 0 && !(bankName && accountNo)) {
    throw ApiError.badRequest(
      'REFUND_ACCOUNT_REQUIRED',
      'กรุณาระบุธนาคารและเลขที่บัญชีสำหรับรับเงินส่วนต่างคืน',
      { diffAmount: plan.diffAmount },
    );
  }

  return applySeatChange({ booking, plan, refundAccount: { bankName, accountNo } });
};

/**
 * ผู้ดูแลย้ายที่นั่งแทนลูกค้า (ที่นั่งชำรุด ลูกค้าโทรมาขอ) — ได้เฉพาะโซนเดิมทุกที่ จึงไม่มีส่วนต่างราคา
 * ไม่ติดเส้นตายและไม่นับโควตาของลูกค้า แต่ย้อนหลังหลังรอบฉายจบแล้วไม่ได้
 */
export const adminChangeSeats = async ({ bookingId, adminId, seatIds, reason }) => {
  const booking = await loadBooking(bookingId);
  if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'ไม่พบรายการจองนี้');
  if (booking.status !== 'PAID') throw notAllowedError();
  if (booking.showtime.status !== 'SCHEDULED') throw showtimeCancelledError();
  if (booking.showtime.endsAt <= new Date()) {
    throw ApiError.conflict('SHOWTIME_ENDED', 'รอบนี้ฉายจบไปแล้ว เปลี่ยนที่นั่งย้อนหลังไม่ได้');
  }
  const open = booking.seatChanges.find((change) => OPEN_SEAT_CHANGE_STATUSES.includes(change.status));
  if (open) throw pendingError(open.id);

  const plan = await planFor(booking, seatIds);
  if (!sameZones(booking.seatSnapshot, plan.toSeats)) {
    throw ApiError.badRequest(
      'SEAT_ZONE_MISMATCH',
      'ผู้ดูแลย้ายแทนได้เฉพาะที่นั่งโซนเดียวกับที่จองไว้ (ไม่มีส่วนต่างราคา)',
    );
  }

  return applySeatChange({ booking, plan, admin: { id: adminId, reason: reason?.trim() || null } });
};

// ---------- ส่วนต่างที่ต้องโอนเพิ่ม ----------

/**
 * คำขอนี้ส่งสลิปส่วนต่างได้ไหม และถ้าเลยเวลาไปแล้ว ส่งช้าได้ถึงเมื่อไหร่ — กติกาเดียวกับ slipUploadWindow ของการจอง
 * change ต้อง include payment มาแล้ว
 */
export const topUpSlipWindow = (change, now = new Date()) => {
  const grace = env.LATE_SLIP_GRACE_MINUTES;
  if (change.payment?.kind !== 'SEAT_CHANGE_TOPUP') return { canUpload: false, lateUntil: null };

  if (change.status === 'PENDING_PAYMENT') {
    const overdue = change.holdExpiresAt && change.holdExpiresAt <= now;
    return {
      canUpload: true,
      lateUntil: overdue && grace > 0 ? addMinutes(change.holdExpiresAt, grace) : null,
    };
  }

  if (
    change.status === 'EXPIRED' &&
    change.expiredAt &&
    grace > 0 &&
    SLIP_ACCEPTING_PAYMENT_STATUSES.includes(change.payment.status)
  ) {
    const lateUntil = addMinutes(change.expiredAt, grace);
    if (lateUntil > now) return { canUpload: true, lateUntil };
  }

  return { canUpload: false, lateUntil: null };
};

const detailInclude = {
  payment: true,
  booking: {
    include: {
      showtime: {
        include: {
          movie: { select: { id: true, titleTh: true, titleEn: true, posterUrl: true } },
          theatre: { select: { id: true, name: true, screenType: true } },
        },
      },
    },
  },
};

/** ข้อมูลหน้าชำระส่วนต่าง (รวม payload สำหรับ render QR) */
const shapeSeatChangeDetail = (change) => {
  const { canUpload, lateUntil } = topUpSlipWindow(change);
  const { booking, payment } = change;
  const shaped = shapeSeatChange(change);
  return {
    ...shaped,
    canUploadSlip: canUpload,
    lateSlipUntil: lateUntil,
    lateSlipGraceMinutes: env.LATE_SLIP_GRACE_MINUTES,
    booking: {
      id: booking.id,
      code: booking.code,
      status: booking.status,
      showtime: {
        id: booking.showtime.id,
        startsAt: booking.showtime.startsAt,
        movie: booking.showtime.movie,
        theatre: booking.showtime.theatre,
      },
    },
    payment: payment
      ? {
          ...shaped.payment,
          reference: payment.reference,
          qrPayload: payment.qrPayload,
          promptPayId: env.PROMPTPAY_ID,
          merchantName: env.PROMPTPAY_MERCHANT_NAME,
          slipUploadedAt: payment.slipUploadedAt,
          hasSlip: Boolean(payment.slipPath),
        }
      : null,
  };
};

/** คำขอเปลี่ยนที่นั่งหนึ่งรายการ — เจ้าของการจองหรือผู้ดูแลเท่านั้น */
export const getSeatChange = async ({ seatChangeId, requester }) => {
  const change = await prisma.seatChange.findUnique({
    where: { id: seatChangeId },
    include: detailInclude,
  });
  if (!change) throw ApiError.notFound('SEAT_CHANGE_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนที่นั่งนี้');
  if (requester.role !== 'ADMIN' && change.booking.userId !== requester.id) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }
  return shapeSeatChangeDetail(change);
};

const loadForSlip = (seatChangeId) => {
  return prisma.seatChange.findUnique({
    where: { id: seatChangeId },
    include: {
      payment: true,
      booking: {
        select: {
          id: true,
          code: true,
          userId: true,
          status: true,
          showtimeId: true,
          seatSnapshot: true,
          showtime: { select: { status: true, startsAt: true } },
        },
      },
    },
  });
};

/** ที่นั่งใหม่ของคำขอที่หมดเวลาไปแล้วเอาคืนไม่ได้ (ถูกจองต่อ, ปิดใช้งาน, รอบเริ่ม/ถูกยกเลิก, การจองเปลี่ยนไปแล้ว) */
class SeatsUnavailableError extends Error {}

/**
 * ส่งสลิปส่วนต่างหลังคำขอหมดเวลาไปแล้ว (ภายในช่วงผ่อนผัน) — ทำแบบเดียวกับ acceptLateSlip ของการจอง
 * ลองกันที่นั่งใหม่อีกครั้งก่อน ถ้ายังว่างก็เข้าคิวตรวจตามปกติเหมือนไม่เคยหมดเวลา
 * ถ้าไม่ว่างแล้ว คำขอคงหมดเวลาไว้ แต่สลิปยังเข้าคิวตรวจ ผู้ดูแลยืนยันยอดแล้วจะคืนส่วนต่างให้ — เงินจึงไม่หลุดนอกระบบ
 */
const acceptLateTopUp = async (change, slipData) => {
  const now = new Date();
  const { booking } = change;
  const showtimeOpen = booking.showtime.status === 'SCHEDULED' && booking.showtime.startsAt > now;

  if (showtimeOpen && booking.status === 'PAID') {
    try {
      await prisma.$transaction(async (tx) => {
        const [showtime] = await tx.$queryRaw`
          SELECT "status" FROM "Showtime" WHERE "id" = ${booking.showtimeId} FOR SHARE`;
        if (showtime?.status !== 'SCHEDULED') throw new SeatsUnavailableError();

        // ส่วนต่างคิดจากที่นั่งชุดเดิมของคำขอนี้ — การจองที่ย้ายไปแล้ว (หรือมีคำขออื่นค้าง) ใช้ส่วนต่างนี้ไม่ได้แล้ว
        const [live] = await tx.$queryRaw`
          SELECT "status", "seatSnapshot" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
        if (live?.status !== 'PAID' || seatIdsKey(live.seatSnapshot) !== seatIdsKey(change.fromSeats)) {
          throw new SeatsUnavailableError();
        }
        const others = await tx.seatChange.findMany({
          where: { bookingId: booking.id, id: { not: change.id } },
          select: { status: true, byAdmin: true },
        });
        const quotaUsed = others.filter(countsTowardSeatChangeQuota).length;
        if (
          others.some((item) => OPEN_SEAT_CHANGE_STATUSES.includes(item.status)) ||
          (!change.byAdmin && quotaUsed >= env.MAX_SEAT_CHANGES_PER_BOOKING)
        ) {
          throw new SeatsUnavailableError();
        }

        const fromIds = new Set(change.fromSeats.map((seat) => seat.id));
        const added = change.toSeats
          .filter((seat) => !fromIds.has(seat.id))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const usable = await tx.seat.count({
          where: { id: { in: added.map((seat) => seat.id) }, isActive: true },
        });
        if (usable !== added.length) throw new SeatsUnavailableError();

        const { count } = await tx.seatChange.updateMany({
          where: { id: change.id, status: 'EXPIRED' },
          data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null, closeReason: null },
        });
        if (count === 0) throw notPayable();

        // ที่นั่งใหม่ถูกคนอื่นจองไปแล้ว = unique constraint ชน (P2002) แล้วทั้ง transaction ย้อนกลับ
        await tx.bookingSeat.createMany({
          data: added.map((seat) => ({
            bookingId: booking.id,
            showtimeId: booking.showtimeId,
            seatId: seat.id,
            price: seat.price,
            seatChangeId: change.id,
          })),
        });
        await tx.payment.update({ where: { id: change.payment.id }, data: slipData });
      });
      return;
    } catch (error) {
      if (!(error instanceof SeatsUnavailableError) && !isSeatConflict(error)) throw error;
      // ที่นั่งใหม่ไม่ว่างแล้ว — ไปทางเข้าคิวตรวจเพื่อคืนเงินด้านล่าง
    }
  }

  await prisma.$transaction(async (tx) => {
    // ล็อกคำขอก่อนรายการเงินตามลำดับเดียวกับที่อื่น และยืนยันว่ายังหมดเวลาอยู่จริง
    const { count } = await tx.seatChange.updateMany({
      where: { id: change.id, status: 'EXPIRED' },
      data: { closeReason: 'โอนส่วนต่างหลังหมดเวลา ที่นั่งใหม่ไม่ว่างแล้ว — รอตรวจสลิปเพื่อคืนเงิน' },
    });
    if (count === 0) throw notPayable();
    const moved = await tx.payment.updateMany({
      where: { id: change.payment.id, status: { in: SLIP_ACCEPTING_PAYMENT_STATUSES } },
      data: slipData,
    });
    if (moved.count === 0) throw notPayable();
  });
};

/**
 * ลูกค้าส่งสลิปส่วนต่าง — หยุดนับถอยหลังระหว่างรอผู้ดูแลตรวจ ที่นั่งใหม่ถูกกันไว้ต่อจนกว่าจะรู้ผล
 * โครงเดียวกับ uploadSlip ของค่าตั๋ว (รวมทางสลิปส่งช้า และลบไฟล์ทิ้งเมื่อทำรายการไม่สำเร็จ)
 */
export const uploadSeatChangeSlip = async ({ seatChangeId, userId, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบรูปสลิปการโอนเงิน');

  const cleanup = () => removeSlip('payment', file.filename);

  const change = await loadForSlip(seatChangeId);
  if (!change?.payment) {
    await cleanup();
    throw ApiError.notFound('SEAT_CHANGE_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนที่นั่งนี้');
  }
  if (change.booking.userId !== userId) {
    await cleanup();
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }

  if (!topUpSlipWindow(change).canUpload) {
    await cleanup();
    if (change.payment.status === 'PENDING_VERIFICATION') {
      throw ApiError.conflict('SEAT_CHANGE_NOT_PAYABLE', 'ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ');
    }
    if (change.status === 'EXPIRED') {
      throw ApiError.conflict(
        'HOLD_EXPIRED',
        `หมดเวลาส่งสลิปแล้ว หากโอนเงินไปแล้วกรุณาติดต่อเจ้าหน้าที่ พร้อมรหัสการจอง ${change.booking.code}`,
      );
    }
    throw notPayable();
  }

  const previousSlip = change.payment.slipPath;
  const slipData = {
    slipPath: file.filename,
    slipUploadedAt: new Date(),
    status: 'PENDING_VERIFICATION',
    rejectReason: null,
    verifiedById: null,
    verifiedAt: null,
  };

  try {
    let current = change;
    if (current.status === 'PENDING_PAYMENT') {
      const moved = await prisma.$transaction(async (tx) => {
        // เงื่อนไขสถานะอยู่ใน update — job หมดเวลาหรือการยกเลิกที่ชิงเปลี่ยนสถานะไปก่อนจะทำให้ไม่โดนแถวไหน
        const { count } = await tx.seatChange.updateMany({
          where: { id: change.id, status: 'PENDING_PAYMENT' },
          data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null },
        });
        if (count === 0) return false;
        await tx.payment.update({ where: { id: change.payment.id }, data: slipData });
        return true;
      });
      if (!moved) {
        // job เพิ่งปิดคำขอไปในจังหวะเดียวกันพอดี — อ่านใหม่แล้วไปทางสลิปส่งช้า
        current = await loadForSlip(seatChangeId);
        if (current.status !== 'EXPIRED' || !topUpSlipWindow(current).canUpload) throw notPayable();
      }
    }
    if (current.status === 'EXPIRED') await acceptLateTopUp(current, slipData);
  } catch (error) {
    await cleanup();
    throw error;
  }

  // ลบสลิปเก่าทิ้ง (ส่งใหม่หลังถูกปฏิเสธ) หลังบันทึกสำเร็จแล้วเท่านั้น
  if (previousSlip && previousSlip !== file.filename) {
    await removeSlip('payment', previousSlip);
  }

  return getSeatChange({ seatChangeId, requester: { id: userId } });
};

/** ปิดคำขอที่ยังรอโอนส่วนต่าง (ต้อง CAS สถานะคำขอสำเร็จก่อน) — คืนที่นั่งที่กันไว้ และปิดรายการเงินที่ยังไม่มีสลิป */
const releaseTopUpHold = async (tx, seatChangeId, rejectReason) => {
  await tx.bookingSeat.deleteMany({ where: { seatChangeId } });
  await tx.payment.updateMany({
    where: { seatChangeId, status: 'AWAITING_SLIP' },
    data: { status: 'REJECTED', rejectReason },
  });
};

/** ลูกค้ายกเลิกคำขอเอง — ได้เฉพาะก่อนส่งสลิปส่วนต่าง (ส่งแล้วต้องรอผลตรวจ เหตุผลเดียวกับการยกเลิกการจอง) */
export const cancelSeatChange = async ({ seatChangeId, userId }) => {
  const change = await prisma.seatChange.findUnique({
    where: { id: seatChangeId },
    include: { booking: { select: { userId: true } } },
  });
  if (!change) throw ApiError.notFound('SEAT_CHANGE_NOT_FOUND', 'ไม่พบคำขอเปลี่ยนที่นั่งนี้');
  if (change.booking.userId !== userId) {
    throw ApiError.forbidden('NOT_BOOKING_OWNER', 'ไม่มีสิทธิ์เข้าถึงรายการจองนี้');
  }
  if (change.status === 'PENDING_VERIFICATION') {
    throw ApiError.conflict(
      'SEAT_CHANGE_AWAITING_VERIFICATION',
      'สลิปส่วนต่างกำลังรอผู้ดูแลตรวจสอบ กรุณารอผลก่อน',
    );
  }
  if (change.status !== 'PENDING_PAYMENT') {
    throw ApiError.conflict('SEAT_CHANGE_CLOSED', 'คำขอเปลี่ยนที่นั่งนี้จบไปแล้ว');
  }

  const reason = 'ลูกค้ายกเลิกคำขอเปลี่ยนที่นั่ง';
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.seatChange.updateMany({
      where: { id: seatChangeId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', holdExpiresAt: null, closeReason: reason },
    });
    if (count === 0) throw bookingStateChanged();
    await releaseTopUpHold(tx, seatChangeId, reason);
  });

  return getSeatChange({ seatChangeId, requester: { id: userId } });
};

/**
 * ปิดคำขอหนึ่งรายการที่หมดเวลาโอนส่วนต่าง — คืน true ถ้าปิดจริง
 * เงื่อนไข "ยังรอโอน + เลยเวลาแล้ว" อยู่ใน where เหมือน expireBooking ถ้าลูกค้าส่งสลิปเข้ามาพอดีก็ไม่ไปทับ
 * ที่นั่งเดิมของลูกค้าไม่ได้แตะเลย — แค่ที่นั่งใหม่ที่กันไว้ถูกปล่อย
 */
export const expireSeatChange = async ({ id, bookingId, userId, code }, now = new Date()) => {
  return prisma.$transaction(async (tx) => {
    const reason = 'หมดเวลาโอนส่วนต่าง';
    const { count } = await tx.seatChange.updateMany({
      where: { id, status: 'PENDING_PAYMENT', holdExpiresAt: { lt: now } },
      // จุดเริ่มนับช่วงผ่อนผันส่งสลิปช้า (topUpSlipWindow)
      data: { status: 'EXPIRED', holdExpiresAt: null, expiredAt: now, closeReason: reason },
    });
    if (count === 0) return false;

    await releaseTopUpHold(tx, id, reason);
    await notify(
      { userId, type: 'SEAT_CHANGE_EXPIRED', context: { code }, data: { bookingId, seatChangeId: id } },
      tx,
    );
    return true;
  });
};

/** ปล่อยที่นั่งที่กันไว้ของคำขอที่ไม่ได้โอนส่วนต่างภายในเวลา — เรียกจาก background job */
export const releaseExpiredSeatChanges = async () => {
  const now = new Date();
  const candidates = await prisma.seatChange.findMany({
    where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: now } },
    select: { id: true, bookingId: true, booking: { select: { userId: true, code: true } } },
  });

  let released = 0;
  for (const change of candidates) {
    const expired = await expireSeatChange(
      { id: change.id, bookingId: change.bookingId, userId: change.booking.userId, code: change.booking.code },
      now,
    );
    if (expired) released += 1;
  }
  return released;
};

// ---------- ผู้ดูแลตรวจสลิปส่วนต่าง (เรียกจาก approvePayment / rejectPayment) ----------

const paymentNotPending = () => {
  return ApiError.conflict(
    'PAYMENT_NOT_PENDING',
    'รายการนี้ถูกตรวจสอบหรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
  );
};

/**
 * อนุมัติสลิปส่วนต่าง → ย้ายที่นั่งจริง + ออกใบเสร็จส่วนต่าง (และส่งทางอีเมล)
 * ยกเว้นสลิปที่ส่งหลังหมดเวลาและกันที่นั่งใหม่ไม่ได้ (คำขอยัง EXPIRED) — ยืนยันยอดแล้วคืนส่วนต่าง ไม่ได้ย้าย ไม่มีใบเสร็จ
 *
 * payment มาจาก loadPendingPayment (include booking และ seatChange)
 */
export const approveTopUp = async ({ payment, adminId }) => {
  const change = payment.seatChange;
  const refundOnly = change.status === 'EXPIRED';
  const notification = { userId: payment.booking.userId, data: { bookingId: payment.bookingId, seatChangeId: change.id } };

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    if (refundOnly) {
      const settled = await tx.seatChange.updateMany({
        where: { id: change.id, status: 'EXPIRED' },
        data: { closeReason: 'โอนส่วนต่างหลังหมดเวลา ที่นั่งใหม่ไม่ว่างแล้ว — คืนเงิน' },
      });
      const refunded = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING_VERIFICATION' },
        data: {
          status: 'REFUND_PENDING',
          verifiedById: adminId,
          verifiedAt: now,
          rejectReason: null,
          refundDueAt: now,
          refundAmount: payment.amount,
        },
      });
      if (settled.count === 0 || refunded.count === 0) throw paymentNotPending();
      await notify(
        {
          ...notification,
          type: 'SEAT_CHANGE_LATE_REFUND',
          context: { code: payment.booking.code, amount: payment.amount },
        },
        tx,
      );
      return;
    }

    // ระหว่างที่สลิปส่วนต่างรอตรวจ ไม่มีใครเปลี่ยนที่นั่งหรือยกเลิกการจองนี้ได้ (มีด่านกันไว้ทุกทาง)
    // ที่นั่งของการจองจึงยังเป็น fromSeats อยู่ — เขียนชุดใหม่ทับได้ตรง ๆ ตามลำดับล็อก Booking → SeatChange → BookingSeat → Payment
    const moved = await tx.booking.updateMany({
      where: { id: payment.bookingId, status: 'PAID' },
      data: { seatSnapshot: change.toSeats, totalAmount: change.toAmount },
    });
    const settled = await tx.seatChange.updateMany({
      where: { id: change.id, status: 'PENDING_VERIFICATION' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    if (moved.count === 0 || settled.count === 0) throw paymentNotPending();

    const toIds = new Set(change.toSeats.map((seat) => seat.id));
    const released = change.fromSeats.filter((seat) => !toIds.has(seat.id)).map((seat) => seat.id);
    await tx.bookingSeat.deleteMany({
      where: { bookingId: payment.bookingId, seatChangeId: null, seatId: { in: released } },
    });
    // ที่นั่งที่กันไว้กลายเป็นที่นั่งของการจองจริง
    await tx.bookingSeat.updateMany({ where: { seatChangeId: change.id }, data: { seatChangeId: null } });

    const paid = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING_VERIFICATION' },
      data: { status: 'APPROVED', verifiedById: adminId, verifiedAt: now, rejectReason: null },
    });
    if (paid.count === 0) throw paymentNotPending();
    // ออกเลขหลังผ่านด่านเช็กสถานะแล้วเท่านั้น (ผู้ดูแลที่กดซ้ำตกไปก่อนถึงตรงนี้ จึงไม่เปลืองเลข) — ReceiptCounter ล็อกเป็นลำดับสุดท้าย
    const receiptNo = await issueReceiptNo(tx, now);
    await tx.payment.update({
      where: { id: payment.id },
      data: { receiptNo, receiptName: payment.booking.user.name },
    });
    await notify(
      {
        ...notification,
        type: 'SEATS_CHANGED',
        context: seatsChangedContext(payment.booking, change, { receiptNo }),
      },
      tx,
    );
  });

  // ส่งหลัง commit แล้วเท่านั้น — สลิปส่งช้าที่เข้าคิวคืนเงินไม่มีใบเสร็จให้ส่ง
  if (!refundOnly) await emailReceipt(payment.bookingId, payment.id);

  return getBookingById(payment.bookingId);
};

/**
 * ปฏิเสธสลิปส่วนต่าง — ปกติคำขอกลับไปรอโอนใหม่ พร้อมเวลาใหม่ (REJECTED_RETRY_MINUTES) ที่นั่งใหม่ยังถูกกันไว้
 * ยกเว้นรอบเริ่มฉายแล้ว หรือเป็นสลิปที่ส่งหลังหมดเวลา — ปิดคำขอ คืนที่นั่งที่กันไว้ (ที่นั่งเดิมของลูกค้าไม่ได้แตะ)
 */
export const rejectTopUp = async ({ payment, adminId, reason }) => {
  const change = payment.seatChange;
  const now = new Date();
  const late = change.status === 'EXPIRED';
  const showtimeStarted = payment.booking.showtime.startsAt <= now;
  const closed = late || showtimeStarted;

  await prisma.$transaction(async (tx) => {
    let settled;
    if (late) {
      settled = await tx.seatChange.updateMany({
        where: { id: change.id, status: 'EXPIRED' },
        data: { closeReason: `สลิปส่วนต่างไม่ผ่านการตรวจสอบ: ${reason}` },
      });
    } else if (showtimeStarted) {
      settled = await tx.seatChange.updateMany({
        where: { id: change.id, status: 'PENDING_VERIFICATION' },
        data: {
          status: 'EXPIRED',
          expiredAt: now,
          holdExpiresAt: null,
          closeReason: `สลิปส่วนต่างไม่ผ่านการตรวจสอบหลังรอบเริ่มฉาย: ${reason}`,
        },
      });
      if (settled.count > 0) await tx.bookingSeat.deleteMany({ where: { seatChangeId: change.id } });
    } else {
      settled = await tx.seatChange.updateMany({
        where: { id: change.id, status: 'PENDING_VERIFICATION' },
        data: { status: 'PENDING_PAYMENT', holdExpiresAt: addMinutes(now, env.REJECTED_RETRY_MINUTES) },
      });
    }

    const rejected = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING_VERIFICATION' },
      data: { status: 'REJECTED', rejectReason: reason, verifiedById: adminId, verifiedAt: now },
    });
    if (settled.count === 0 || rejected.count === 0) throw paymentNotPending();

    await notify(
      {
        userId: payment.booking.userId,
        type: 'SEAT_CHANGE_REJECTED',
        context: { code: payment.booking.code, reason, closed },
        data: { bookingId: payment.bookingId, seatChangeId: change.id },
      },
      tx,
    );
  });

  return getBookingById(payment.bookingId);
};
