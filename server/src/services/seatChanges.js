import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { generatePaymentReference } from '../utils/codes.js';
import { toPriceMap } from '../utils/pricing.js';
import { createPromptPayPayload } from '../utils/promptpay.js';
import { planSeatChange, sameZones } from '../utils/seatChange.js';
import { seatLabels } from '../utils/seats.js';
import {
  bookingNotFound,
  canAccessBooking,
  notBookingOwner,
  seatChangeNotFound,
} from '../utils/bookingAccess.js';
import { removeSlip } from '../lib/slipStorage.js';
import { notify } from './notifications.js';
import { emailReceipt, issueReceiptNo } from './receipts.js';
import {
  bookingStateChanged,
  isSeatConflict,
  lockBooking,
  lockShowtime,
  paymentNotPending,
  seatTakenError,
} from './locks.js';
import {
  approvedPaymentData,
  canUploadSlip,
  discardSlipOnError,
  queueSlipForReview,
  rejectedPaymentData,
} from './slips.js';
import { openSeatChange, seatChangeBlocker, seatChangesUsed, shapeSeatChange } from './seatChangeRules.js';
import { getBookingById, readRefundAccount } from './bookings.js';

/**
 * เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว (จำนวนที่นั่งเท่าเดิม)
 *
 * - ราคาเท่าเดิม / ถูกลง → ย้ายทันทีในคราวเดียว (ถูกลง = ส่วนต่างเข้าคิวคืนเงินที่ /admin/refunds)
 * - แพงขึ้น → กันที่นั่งใหม่ไว้ SEAT_HOLD_MINUTES รอโอนส่วนต่าง ระหว่างนี้ที่นั่งเดิมยังเป็นของลูกค้า
 *   ย้ายจริงเมื่อผู้ดูแลอนุมัติสลิปส่วนต่าง (คิวตรวจสลิปเดียวกับค่าตั๋ว) แล้วออกใบเสร็จส่วนต่างให้
 *
 * ทุกฟังก์ชันในไฟล์นี้ล็อกตามลำดับล็อกทั้งระบบ (ดู services/locks.js)
 * สองรายการที่ชนกันจึงต่อคิวกัน ไม่รอกันเองจน deadlock
 */

const seatIdsKey = (seats) => {
  return (seats ?? [])
    .map((seat) => seat.id)
    .sort()
    .join();
};

const labels = (seats) => seatLabels(seats).join(', ');

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
      return pendingError(openSeatChange(booking.seatChanges)?.id);
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
        refundAccountName: refundAccount.accountName || null,
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
      if ((await lockShowtime(tx, booking.showtimeId)) !== 'SCHEDULED') throw showtimeCancelledError();

      // ล็อกแถวการจอง แล้วยืนยันว่ายังเป็นที่นั่งชุดเดียวกับที่ใช้คิดส่วนต่าง — สองคำขอที่มาพร้อมกันต่อคิวกันตรงนี้
      // คำขอที่ช้ากว่าเห็นที่นั่งชุดใหม่แล้วจึงตกไป แทนที่จะลบที่นั่งตามชุดเก่า จนเหลือที่นั่งค้างที่ไม่มีใครจ่าย
      const live = await lockBooking(tx, booking.id);
      if (live?.status !== 'PAID' || seatIdsKey(live.seatSnapshot) !== seatIdsKey(booking.seatSnapshot)) {
        throw bookingStateChanged();
      }

      const changes = await tx.seatChange.findMany({
        where: { bookingId: booking.id },
        select: { id: true, status: true, byAdmin: true },
      });
      const open = openSeatChange(changes);
      if (open) throw pendingError(open.id);
      if (!admin && seatChangesUsed(changes) >= env.MAX_SEAT_CHANGES_PER_BOOKING) {
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
  if (!booking) throw bookingNotFound();
  if (booking.userId !== userId) throw notBookingOwner('ไม่มีสิทธิ์เปลี่ยนที่นั่งของรายการจองนี้');
  const blocked = seatChangeBlocker(booking);
  if (blocked) throw blockedError(blocked, booking);

  const plan = await planFor(booking, seatIds);

  // ย้ายไปที่นั่งที่ถูกกว่า — ส่วนต่างต้องโอนคืนด้วยมือ จึงต้องรู้บัญชีปลายทางก่อน (แบบเดียวกับยกเลิกหลังจ่ายเงิน)
  const { bankName, accountNo, accountName } = readRefundAccount(refundAccount);
  if (plan.diffAmount < 0 && !(bankName && accountNo)) {
    throw ApiError.badRequest(
      'REFUND_ACCOUNT_REQUIRED',
      'กรุณาระบุธนาคารและเลขที่บัญชีสำหรับรับเงินส่วนต่างคืน',
      { diffAmount: plan.diffAmount },
    );
  }

  return applySeatChange({ booking, plan, refundAccount: { bankName, accountNo, accountName } });
};

/**
 * ผู้ดูแลย้ายที่นั่งแทนลูกค้า (ที่นั่งชำรุด ลูกค้าโทรมาขอ) — ได้เฉพาะโซนเดิมทุกที่ จึงไม่มีส่วนต่างราคา
 * ไม่ติดเส้นตายและไม่นับโควตาของลูกค้า แต่ย้อนหลังหลังรอบฉายจบแล้วไม่ได้
 */
export const adminChangeSeats = async ({ bookingId, adminId, seatIds, reason }) => {
  const booking = await loadBooking(bookingId);
  if (!booking) throw bookingNotFound();
  if (booking.status !== 'PAID') throw notAllowedError();
  if (booking.showtime.status !== 'SCHEDULED') throw showtimeCancelledError();
  if (booking.showtime.endsAt <= new Date()) {
    throw ApiError.conflict('SHOWTIME_ENDED', 'รอบนี้ฉายจบไปแล้ว เปลี่ยนที่นั่งย้อนหลังไม่ได้');
  }
  const open = openSeatChange(booking.seatChanges);
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
 * คำขอนี้ส่งสลิปส่วนต่างได้ไหม — กติกาเดียวกับค่าตั๋ว (canUploadSlip: ได้เฉพาะตอนรอโอน หมดเวลาแล้วไม่รับ)
 * ใช้ได้เฉพาะคำขอที่มีรายการโอนส่วนต่าง · change ต้อง include payment มาแล้ว
 */
export const canUploadTopUpSlip = (change) => {
  return change.payment?.kind === 'SEAT_CHANGE_TOPUP' && canUploadSlip(change);
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
  const { booking, payment } = change;
  const shaped = shapeSeatChange(change);
  return {
    ...shaped,
    canUploadSlip: canUploadTopUpSlip(change),
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
  if (!change) throw seatChangeNotFound();
  if (!canAccessBooking(requester, change.booking.userId)) throw notBookingOwner();
  return shapeSeatChangeDetail(change);
};

const loadForSlip = (seatChangeId) => {
  return prisma.seatChange.findUnique({
    where: { id: seatChangeId },
    include: { payment: true, booking: { select: { code: true, userId: true } } },
  });
};

/**
 * ลูกค้าส่งสลิปส่วนต่าง — หยุดนับถอยหลังระหว่างรอผู้ดูแลตรวจ ที่นั่งใหม่ถูกกันไว้ต่อจนกว่าจะรู้ผล
 * ใช้ขั้นตอนเดียวกับ uploadSlip ของค่าตั๋ว (queueSlipForReview — หมดเวลาแล้วส่งไม่ได้ และลบไฟล์ทิ้งเมื่อทำรายการไม่สำเร็จ)
 */
export const uploadSeatChangeSlip = async ({ seatChangeId, userId, file }) => {
  if (!file) throw ApiError.badRequest('NO_FILE', 'กรุณาแนบรูปสลิปการโอนเงิน');

  const previousSlip = await discardSlipOnError('payment', file, async () => {
    const change = await loadForSlip(seatChangeId);
    if (!change?.payment) throw seatChangeNotFound();
    if (change.booking.userId !== userId) throw notBookingOwner();
    await queueSlipForReview({
      model: 'seatChange',
      holder: change,
      file,
      reload: () => loadForSlip(seatChangeId),
      canUpload: canUploadTopUpSlip,
      notPayable,
      alreadySentCode: 'SEAT_CHANGE_NOT_PAYABLE',
      bookingCode: change.booking.code,
    });
    return change.payment.slipPath;
  });

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
  if (!change) throw seatChangeNotFound();
  if (change.booking.userId !== userId) throw notBookingOwner();
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
      // หมดเวลาแล้วจบ — ส่งสลิปส่วนต่างไม่ได้อีก (canUploadTopUpSlip) · expiredAt เก็บไว้เป็นประวัติ
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

/**
 * อนุมัติสลิปส่วนต่าง → ย้ายที่นั่งจริง + ออกใบเสร็จส่วนต่าง (และส่งทางอีเมล)
 *
 * payment มาจาก loadPendingPayment (include booking และ seatChange)
 */
export const approveTopUp = async ({ payment, adminId }) => {
  const change = payment.seatChange;

  await prisma.$transaction(async (tx) => {
    const now = new Date();

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
      data: approvedPaymentData(adminId, now),
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
        userId: payment.booking.userId,
        type: 'SEATS_CHANGED',
        context: seatsChangedContext(payment.booking, change, { receiptNo }),
        data: { bookingId: payment.bookingId, seatChangeId: change.id },
      },
      tx,
    );
  });

  // ส่งหลัง commit แล้วเท่านั้น
  await emailReceipt(payment.bookingId, payment.id);

  return getBookingById(payment.bookingId);
};

/**
 * ปฏิเสธสลิปส่วนต่าง — ปกติคำขอกลับไปรอโอนใหม่ พร้อมเวลาใหม่ (REJECTED_RETRY_MINUTES) ที่นั่งใหม่ยังถูกกันไว้
 * ยกเว้นรอบเริ่มฉายแล้ว — ปิดคำขอ คืนที่นั่งที่กันไว้ (ที่นั่งเดิมของลูกค้าไม่ได้แตะ) และส่งสลิปใหม่ไม่ได้อีก
 */
export const rejectTopUp = async ({ payment, adminId, reason }) => {
  const change = payment.seatChange;
  const now = new Date();
  const closed = payment.booking.showtime.startsAt <= now;

  await prisma.$transaction(async (tx) => {
    let settled;
    if (closed) {
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
      data: rejectedPaymentData(adminId, now, reason),
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
