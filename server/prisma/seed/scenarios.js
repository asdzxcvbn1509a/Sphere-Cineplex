import prisma from '../../src/lib/prisma.js';
import {
  cancelBooking,
  cancelShowtime,
  createBooking,
  updateRefundAccount,
} from '../../src/services/bookings.js';
import { completeRefund, rejectPayment, uploadSlip } from '../../src/services/payments.js';
import {
  adminChangeSeats,
  cancelSeatChange,
  expireSeatChange,
  requestSeatChange,
  uploadSeatChangeSlip,
} from '../../src/services/seatChanges.js';
import { bangkokHour, dayKeyFrom } from './schedule.js';
import { bangkokDateKey } from '../../src/utils/datetime.js';
import { pickSeats } from './seating.js';
import { renderPaymentSlip, renderRefundSlip, storeSlip } from './slipImage.js';

/**
 * สถานการณ์ที่ยัง "เดินอยู่" ตอน seed เสร็จ — เรียก service ตัวจริงทุกขั้น สถานะ ที่นั่งที่กันไว้ รายการเงิน และแจ้งเตือน
 * จึงเป็นแบบเดียวกับที่ระบบสร้างเองทุกอย่าง (ประวัติที่จบแล้วอยู่ใน sales.js)
 *
 * ไม่เรียก approvePayment/approveTopUp เพราะ service ส่งอีเมลใบเสร็จหลังอนุมัติ (ตอนพัฒนาพิมพ์เมลทั้งฉบับลง console
 * ถ้าตั้ง SMTP ไว้จะส่งจริงไปที่ @example.test) — ใบที่อนุมัติแล้วทั้งหมดมาจาก sales.js แทน เลขใบเสร็จจึงออกที่เดียว
 *
 * หมายเหตุ: การกันที่นั่งรอจ่าย (ทั้งค่าตั๋วและส่วนต่าง) นับถอยหลังจริง 10 นาที — เปิด API แล้ว job จะปิดให้เป็นหมดเวลาตามกติกา
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// ---------- เลือกรอบให้แต่ละสถานการณ์ ----------

/**
 * รอบที่ใช้ทำสถานการณ์ต่าง ๆ — เลือกตามกติกา (อีกกี่ชั่วโมงฉาย กี่โมง โรงไหน) ไม่ผูกกับวันที่
 * seed ตอนดึกหรือวันไหนก็ได้รอบที่เข้าเงื่อนไข และแต่ละสถานการณ์ได้คนละรอบ
 */
export const chooseTargets = (world) => {
  const { now } = world;
  const used = new Set();

  const matches = (showtime, { theatreName, screenType, minHours = 0, minHour = 0 }) => {
    return (
      showtime.status === 'SCHEDULED' &&
      (!theatreName || showtime.theatre.name === theatreName) &&
      (!screenType || showtime.theatre.screenType === screenType) &&
      showtime.startsAt.getTime() - now.getTime() >= minHours * HOUR &&
      bangkokHour(showtime.startsAt) >= minHour
    );
  };

  const take = (showtime, label) => {
    if (!showtime) throw new Error(`seed: ไม่มีรอบที่ใช้ทำสถานการณ์ "${label}" ได้`);
    used.add(showtime.id);
    return showtime;
  };

  /** รอบที่จะฉายรอบแรกที่เข้าเงื่อนไข — ไม่มีรอบตรงช่วงเวลาที่อยากได้ก็ยอมรับรอบเวลาอื่น */
  const upcoming = (label, criteria) => {
    const free = world.showtimes.filter((showtime) => !used.has(showtime.id)).sort((a, b) => a.startsAt - b.startsAt);
    const found =
      free.find((showtime) => matches(showtime, criteria)) ??
      free.find((showtime) => matches(showtime, { ...criteria, minHour: 0 }));
    return take(found, label);
  };

  /** รอบที่ฉายไปแล้วเมื่อ daysAgo วันก่อน */
  const past = (label, { daysAgo, theatreName, minHour = 0 }) => {
    const dayKey = dayKeyFrom(now, -daysAgo);
    const candidates = world.showtimes.filter(
      (showtime) =>
        !used.has(showtime.id) &&
        showtime.endsAt < now &&
        bangkokDateKey(showtime.startsAt) === dayKey &&
        (!theatreName || showtime.theatre.name === theatreName),
    );
    return take(
      candidates.find((showtime) => bangkokHour(showtime.startsAt) >= minHour) ?? candidates.at(-1),
      label,
    );
  };

  return {
    soldOut: upcoming('ขายหมด', { screenType: '4DX', minHours: 3, minHour: 17 }),
    nearlyFull: upcoming('เกือบเต็ม', { screenType: 'IMAX', minHours: 20, minHour: 18 }),
    cancelUpcoming: upcoming('ยกเลิกทั้งรอบ', { theatreName: 'โรงที่ 2', minHours: 26, minHour: 16 }),
    cancelledPast: past('รอบที่ถูกยกเลิกไปแล้ว', { daysAgo: 3, theatreName: 'โรงที่ 5', minHour: 17 }),
    // รอบที่ขายดีในสัปดาห์ที่ผ่านมา — หน้ารายงานเปิดมาที่ 7 วันล่าสุด อัตราการเต็มจะได้มีครบทั้งแดง (≥80%) เหลือง และเขียว
    busyPast: [
      { showtime: past('รอบขายดี 1', { daysAgo: 1, theatreName: 'โรงที่ 4 (4DX)', minHour: 18 }), fill: 0.93 },
      { showtime: past('รอบขายดี 2', { daysAgo: 2, theatreName: 'โรงที่ 1', minHour: 19 }), fill: 0.84 },
      { showtime: past('รอบขายดี 3', { daysAgo: 2, theatreName: 'โรงที่ 4 (4DX)', minHour: 18 }), fill: 0.66 },
      { showtime: past('รอบขายดี 4', { daysAgo: 3, theatreName: 'โรงที่ 2', minHour: 18 }), fill: 0.52 },
      { showtime: past('รอบขายดี 5', { daysAgo: 4, theatreName: 'โรงที่ 1', minHour: 18 }), fill: 0.47 },
      { showtime: past('รอบขายดี 6', { daysAgo: 5, theatreName: 'โรงที่ 4 (4DX)', minHour: 19 }), fill: 0.58 },
      { showtime: past('รอบขายดี 7', { daysAgo: 6, theatreName: 'โรงที่ 2', minHour: 19 }), fill: 0.44 },
    ],

    somchaiPaid: upcoming('somchai จ่ายแล้ว', { screenType: 'IMAX', minHours: 44, minHour: 17 }),
    somchaiSwap: upcoming('somchai ย้ายที่นั่งราคาเดิม', { theatreName: 'โรงที่ 5', minHours: 28, minHour: 15 }),
    somchaiUpgraded: upcoming('somchai อัปเกรดที่นั่ง', { theatreName: 'โรงที่ 1', minHours: 70, minHour: 14 }),
    somchaiTopUp: upcoming('somchai รอโอนส่วนต่าง', { theatreName: 'โรงที่ 2', minHours: 30, minHour: 17 }),
    somchaiExpired: upcoming('somchai หมดเวลาชำระ', { theatreName: 'โรงที่ 2', minHours: 30 }),
    somchaiRejected: upcoming('somchai สลิปถูกปฏิเสธ', { theatreName: 'โรงที่ 5', minHours: 5, minHour: 18 }),
    somchaiReview: upcoming('somchai รอตรวจสลิป', { theatreName: 'โรงที่ 1', minHours: 30, minHour: 17 }),
    somchaiHistory: [
      past('somchai ประวัติ 1', { daysAgo: 1, minHour: 18 }),
      past('somchai ประวัติ 2', { daysAgo: 4, minHour: 13 }),
      past('somchai ประวัติ 3', { daysAgo: 8, minHour: 19 }),
    ],
    somchaiRefunded: past('somchai คืนเงินแล้ว', { daysAgo: 6, minHour: 17 }),

    cancelWithAccount: upcoming('ลูกค้ายกเลิกเอง', { theatreName: 'โรงที่ 1', minHours: 30 }),
    refundDone: upcoming('โอนคืนแล้ว', { theatreName: 'โรงที่ 5', minHours: 30 }),
    adminCancel: upcoming('ผู้ดูแลยกเลิกให้', { screenType: 'IMAX', minHours: 50 }),
    cheaperChange: upcoming('ย้ายไปที่ถูกกว่า', { theatreName: 'โรงที่ 5', minHours: 28, minHour: 17 }),
    topUpHold: upcoming('รอโอนส่วนต่าง', { theatreName: 'โรงที่ 1', minHours: 26 }),
    topUpReview: upcoming('สลิปส่วนต่างรอตรวจ', { theatreName: 'โรงที่ 5', minHours: 50 }),
    topUpCancelled: upcoming('ยกเลิกคำขอเปลี่ยนที่นั่ง', { theatreName: 'โรงที่ 2', minHours: 30 }),
    topUpRejected: upcoming('สลิปส่วนต่างถูกปฏิเสธ', { theatreName: 'โรงที่ 1', minHours: 30 }),
    topUpExpired: upcoming('หมดเวลาโอนส่วนต่าง', { theatreName: 'โรงที่ 5', minHours: 30 }),
    adminMove: upcoming('ผู้ดูแลย้ายที่นั่งให้', { screenType: 'IMAX', minHours: 26 }),

    queue: [
      upcoming('คิวสลิป 1', { screenType: 'IMAX', minHours: 6 }),
      upcoming('คิวสลิป 2', { theatreName: 'โรงที่ 2', minHours: 20 }),
      upcoming('คิวสลิป 3', { screenType: '4DX', minHours: 28 }),
      upcoming('คิวสลิป 4', { theatreName: 'โรงที่ 5', minHours: 30 }),
      upcoming('คิวสลิป 5', { theatreName: 'โรงที่ 1', minHours: 40 }),
    ],
    hold: upcoming('รอชำระเงิน', { theatreName: 'โรงที่ 1', minHours: 2 }),
  };
};

/** การจองที่ sales.js ต้องสร้างไว้ก่อน (จ่ายแล้ว/จบแล้ว) ให้สถานการณ์ด้านล่างใช้ต่อ */
export const pinsFor = (world, targets) => {
  const { users, now } = world;
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * HOUR);
  return [
    { key: 'somchaiPaid', user: users.somchai, showtime: targets.somchaiPaid, zone: 'PREMIUM', count: 2 },
    { key: 'somchaiSwap', user: users.somchai, showtime: targets.somchaiSwap, zone: 'NORMAL', count: 2 },
    {
      key: 'somchaiUpgraded',
      user: users.somchai,
      showtime: targets.somchaiUpgraded,
      zone: 'NORMAL',
      count: 2,
      outcome: 'UPGRADED',
      upgradeTo: 'PREMIUM',
      latestAt: daysAgo(2),
    },
    { key: 'somchaiTopUp', user: users.somchai, showtime: targets.somchaiTopUp, zone: 'NORMAL', count: 2 },
    { key: 'somchaiCancelledShow', user: users.somchai, showtime: targets.cancelUpcoming, zone: 'PREMIUM', count: 2 },
    { key: 'nattawutCancelledShow', user: users.nattawut, showtime: targets.cancelUpcoming, zone: 'NORMAL', count: 3 },
    ...targets.somchaiHistory.map((showtime, i) => ({
      key: `somchaiHistory${i + 1}`,
      user: users.somchai,
      showtime,
      zone: i === 1 ? 'SOFA' : 'NORMAL',
      count: i === 1 ? 1 : 2,
    })),
    {
      key: 'somchaiRefunded',
      user: users.somchai,
      showtime: targets.somchaiRefunded,
      zone: 'PREMIUM',
      count: 2,
      outcome: 'REFUNDED',
      latestAt: new Date(targets.somchaiRefunded.startsAt.getTime() - 2 * 24 * HOUR),
    },
    {
      key: 'somchaiExpired',
      user: users.somchai,
      showtime: targets.somchaiExpired,
      zone: 'NORMAL',
      count: 2,
      outcome: 'EXPIRED',
      latestAt: new Date(now.getTime() - 20 * HOUR),
    },
    { key: 'cancelWithAccount', user: users.somying, showtime: targets.cancelWithAccount, zone: 'NORMAL', count: 3 },
    { key: 'refundDone', user: users.panuwat, showtime: targets.refundDone, zone: 'NORMAL', count: 2 },
    { key: 'adminCancel', user: users.thanakorn, showtime: targets.adminCancel, zone: 'PREMIUM', count: 2 },
    { key: 'cheaperChange', user: users.kamonchanok, showtime: targets.cheaperChange, zone: 'PREMIUM', count: 2 },
    { key: 'topUpHold', user: users.weerapong, showtime: targets.topUpHold, zone: 'NORMAL', count: 2 },
    { key: 'topUpReview', user: users.siriporn, showtime: targets.topUpReview, zone: 'NORMAL', count: 2 },
    { key: 'topUpCancelled', user: users.chayapon, showtime: targets.topUpCancelled, zone: 'NORMAL', count: 1 },
    { key: 'topUpRejected', user: users.piyanuch, showtime: targets.topUpRejected, zone: 'NORMAL', count: 2 },
    { key: 'topUpExpired', user: users.malee, showtime: targets.topUpExpired, zone: 'NORMAL', count: 2 },
    { key: 'adminMove', user: users.emily, showtime: targets.adminMove, zone: 'PREMIUM', count: 2 },
  ];
};

// ---------- ตัวช่วย ----------

/** ที่นั่งว่างจริงในฐานตอนนี้ (รวมที่นั่งที่คำขอเปลี่ยนที่นั่งกันไว้) */
const freeSeatIds = async (world, showtime, zone, count) => {
  const rows = await prisma.bookingSeat.findMany({ where: { showtimeId: showtime.id }, select: { seatId: true } });
  const taken = new Set(rows.map((row) => row.seatId));
  const seats = pickSeats(world.inventory.get(showtime.theatre.id), taken, { zone, count, random: world.random });
  if (!seats) {
    throw new Error(`seed: รอบ ${showtime.theatre.name} ${showtime.startsAt.toISOString()} ที่นั่ง ${zone} ไม่พอ`);
  }
  return seats.map((seat) => seat.id);
};

const book = async (world, user, showtime, zone, count) => {
  const seatIds = await freeSeatIds(world, showtime, zone, count);
  return createBooking({ userId: user.id, showtimeId: showtime.id, seatIds });
};

/** สลิปค่าตั๋ว — amount = ยอดที่เขียนบนสลิป (ไม่ใส่ = ยอดที่ต้องจ่ายพอดี) */
const ticketSlip = (booking, { amount = booking.payment.amount, at = new Date() } = {}) => {
  return storeSlip('payment', () =>
    renderPaymentSlip({ amount, reference: booking.payment.reference, code: booking.code, at }),
  );
};

/**
 * ส่งสลิปค่าตั๋วผ่าน service แล้วย้อนเวลาส่งไป minutesAgo นาที — คิวตรวจสลิปจะได้มีทั้งใบที่เพิ่งเข้ามาและใบที่รอนานแล้ว
 * ย้อนได้เพราะระหว่างรอตรวจไม่มีอะไรนับถอยหลัง (holdExpiresAt = null)
 */
const submitSlip = async (booking, user, { minutesAgo = 0, amountDelta = 0 } = {}) => {
  const uploadedAt = new Date(Date.now() - minutesAgo * MINUTE);
  const file = await ticketSlip(booking, { amount: booking.payment.amount + amountDelta, at: uploadedAt });
  await uploadSlip({ bookingId: booking.id, userId: user.id, file });
  if (minutesAgo > 0) {
    const createdAt = new Date(uploadedAt.getTime() - 4 * MINUTE);
    await prisma.booking.update({ where: { id: booking.id }, data: { createdAt } });
    await prisma.payment.update({
      where: { mainBookingId: booking.id },
      data: { createdAt, slipUploadedAt: uploadedAt },
    });
  }
};

const mainPayment = (bookingId) => prisma.payment.findUnique({ where: { mainBookingId: bookingId } });

/** ส่งสลิปส่วนต่างของคำขอเปลี่ยนที่นั่งผ่าน service — คืนรายการเงินส่วนต่าง (ก่อนส่ง) ไว้ใช้อนุมัติ/ปฏิเสธต่อ */
const sendTopUpSlip = async (seatChangeId, booking, { amountDelta = 0 } = {}) => {
  const topUp = await prisma.payment.findUnique({ where: { seatChangeId } });
  await uploadSeatChangeSlip({
    seatChangeId,
    userId: booking.user.id,
    file: await storeSlip('payment', () =>
      renderPaymentSlip({
        amount: topUp.amount + amountDelta,
        reference: topUp.reference,
        code: booking.code,
        at: new Date(),
      }),
    ),
  });
  return topUp;
};

const account = (bankName, accountNo, user) => ({ bankName, accountNo, accountName: user.name });

/**
 * ย้อนเวลาของสิ่งที่ service เพิ่งเขียนให้การจองชุดนี้ไป minutesAgo นาที (service ประทับเวลา "ตอนนี้" เสมอ)
 * คิวคืนเงินจะได้มีทั้งเรื่องที่เพิ่งเข้ามาและเรื่องที่รอมาสักพัก แทนที่ทุกใบจะเข้าคิวนาทีเดียวกันตอน seed
 * ไม่เกิน 55 นาที — ใบที่ pin ไว้จ่ายเงินก่อน "ตอนนี้" อย่างน้อยหนึ่งชั่วโมง (sales.js) ยกเลิก/ย้ายย้อนไปก็ยังหลังเวลาจ่าย
 */
const backdate = async (world, bookingIds, minutesAgo) => {
  const at = new Date(Date.now() - minutesAgo * MINUTE);
  // การจองที่เพิ่งสร้างผ่าน service ในสถานการณ์เดียวกัน ต้องเกิดก่อนเวลาที่ย้อนไป
  const before = new Date(at.getTime() - 5 * MINUTE);
  const since = { gte: world.now };
  const ids = { in: bookingIds };
  await prisma.booking.updateMany({ where: { id: ids, createdAt: since }, data: { createdAt: before } });
  await prisma.payment.updateMany({ where: { mainBookingId: ids, createdAt: since }, data: { createdAt: before } });
  await prisma.booking.updateMany({ where: { id: ids, cancelledAt: since }, data: { cancelledAt: at } });
  await prisma.payment.updateMany({
    where: { bookingId: ids, refundDueAt: since },
    data: { refundDueAt: at, updatedAt: at },
  });
  await prisma.payment.updateMany({
    where: { bookingId: ids, seatChangeId: { not: null }, createdAt: since },
    data: { createdAt: at },
  });
  await prisma.seatChange.updateMany({
    where: { bookingId: ids, completedAt: since },
    data: { createdAt: at, completedAt: at, updatedAt: at },
  });
  await prisma.notification.updateMany({
    where: { createdAt: since, OR: bookingIds.map((id) => ({ data: { path: ['bookingId'], equals: id } })) },
    data: { createdAt: at },
  });
};

// ---------- สถานการณ์ ----------

/**
 * รันทุกสถานการณ์ตามลำดับ — pinned = การจองที่ sales.js สร้างไว้ให้ (key → plan ที่มี id)
 * @returns {string[]} คำอธิบายสั้น ๆ ของแต่ละสถานการณ์ ไว้พิมพ์สรุปท้าย seed
 */
export const runScenarios = async (world, targets, pinned) => {
  const { users, admins } = world;
  const done = [];
  const pin = (key) => pinned.get(key);

  // ยกเลิกทั้งรอบ — ใบที่จ่ายแล้วเข้าคิวคืนเงิน (ยังไม่มีบัญชี) ใบที่ยังไม่จ่ายถูกปิด แล้วลูกค้าคนหนึ่งแจ้งบัญชีกลับมา
  await book(world, users.kamonchanok, targets.cancelUpcoming, 'NORMAL', 2);
  const cancelled = await cancelShowtime({
    showtimeId: targets.cancelUpcoming.id,
    reason: 'เครื่องฉายขัดข้อง รอช่างเปลี่ยนอะไหล่',
  });
  const natt = pin('nattawutCancelledShow');
  await updateRefundAccount({
    bookingId: natt.id,
    userId: natt.user.id,
    ...account('ไทยพาณิชย์', '4071234567', natt.user),
  });
  const closedByShowtime = await prisma.booking.findMany({
    where: { showtimeId: targets.cancelUpcoming.id },
    select: { id: true },
  });
  await backdate(
    world,
    closedByShowtime.map((booking) => booking.id),
    50,
  );
  done.push(
    `ยกเลิกทั้งรอบ ${targets.cancelUpcoming.theatre.name}: ปิด ${cancelled.cancelledBookings} การจอง ` +
      `เข้าคิวคืนเงิน ${cancelled.refundsQueued} ใบ`,
  );

  // เปลี่ยนที่นั่ง — ราคาเดิม (ย้ายทันที) · ถูกลง (คืนส่วนต่าง) · แพงขึ้น (รอโอน / สลิปรอตรวจ / ถูกปฏิเสธ / หมดเวลา / ยกเลิกคำขอ)
  // · ผู้ดูแลย้ายให้
  const swap = pin('somchaiSwap');
  await requestSeatChange({
    bookingId: swap.id,
    userId: swap.user.id,
    seatIds: await freeSeatIds(world, swap.showtime, 'NORMAL', 2),
  });
  await backdate(world, [swap.id], 30);

  const cheaper = pin('cheaperChange');
  await requestSeatChange({
    bookingId: cheaper.id,
    userId: cheaper.user.id,
    seatIds: await freeSeatIds(world, cheaper.showtime, 'NORMAL', 2),
    refundAccount: account('กรุงไทย', '9821234567', cheaper.user),
  });
  await backdate(world, [cheaper.id], 45);

  const topUpHold = pin('topUpHold');
  await requestSeatChange({
    bookingId: topUpHold.id,
    userId: topUpHold.user.id,
    seatIds: await freeSeatIds(world, topUpHold.showtime, 'PREMIUM', 2),
  });

  const topUpReview = pin('topUpReview');
  const { seatChange: review } = await requestSeatChange({
    bookingId: topUpReview.id,
    userId: topUpReview.user.id,
    seatIds: await freeSeatIds(world, topUpReview.showtime, 'PREMIUM', 2),
  });
  await sendTopUpSlip(review.id, topUpReview);

  // สลิปส่วนต่างยอดไม่ครบ → ผู้ดูแลปฏิเสธ คำขอกลับไปรอโอนใหม่ (ที่นั่งใหม่ยังถูกกันไว้)
  const topUpRejected = pin('topUpRejected');
  const { seatChange: rejectedChange } = await requestSeatChange({
    bookingId: topUpRejected.id,
    userId: topUpRejected.user.id,
    seatIds: await freeSeatIds(world, topUpRejected.showtime, 'PREMIUM', 2),
  });
  const rejectedTopUp = await sendTopUpSlip(rejectedChange.id, topUpRejected, { amountDelta: -40 });
  await rejectPayment({ paymentId: rejectedTopUp.id, adminId: admins.staff.id, reason: 'ยอดส่วนต่างในสลิปไม่ครบ' });

  // ไม่ได้โอนส่วนต่างภายในเวลา → คำขอหมดเวลา ที่นั่งใหม่ถูกปล่อย ที่นั่งเดิมยังอยู่ (ขั้นตอนเดียวกับ job)
  // ย้อนเวลาคำขอไป 40 นาที (กันที่นั่ง 10 นาที) ให้ดูเป็นเรื่องที่จบไปแล้ว ไม่ใช่เพิ่งหมดเวลาตอน seed
  const topUpExpired = pin('topUpExpired');
  const { seatChange: lapsed } = await requestSeatChange({
    bookingId: topUpExpired.id,
    userId: topUpExpired.user.id,
    seatIds: await freeSeatIds(world, topUpExpired.showtime, 'PREMIUM', 2),
  });
  const requestedAt = new Date(Date.now() - 40 * MINUTE);
  const lapsedAt = new Date(requestedAt.getTime() + 10 * MINUTE);
  await prisma.seatChange.update({
    where: { id: lapsed.id },
    data: { createdAt: requestedAt, holdExpiresAt: lapsedAt },
  });
  await prisma.payment.update({ where: { seatChangeId: lapsed.id }, data: { createdAt: requestedAt } });
  const expired = await expireSeatChange(
    {
      id: lapsed.id,
      bookingId: topUpExpired.id,
      userId: topUpExpired.user.id,
      code: topUpExpired.code,
    },
    new Date(lapsedAt.getTime() + 20 * 1000),
  );
  if (!expired) throw new Error(`seed: ปิดคำขอเปลี่ยนที่นั่งของ ${topUpExpired.code} เป็นหมดเวลาไม่ได้`);
  await prisma.notification.updateMany({
    where: { type: 'SEAT_CHANGE_EXPIRED', data: { path: ['seatChangeId'], equals: lapsed.id } },
    data: { createdAt: new Date(lapsedAt.getTime() + 20 * 1000) },
  });

  // somchai ขอย้ายไปที่นั่งที่แพงกว่า — กำลังนับถอยหลังรอโอนส่วนต่าง (หน้า "การจองของฉัน" มีปุ่มชำระส่วนต่าง)
  const somchaiTopUp = pin('somchaiTopUp');
  await requestSeatChange({
    bookingId: somchaiTopUp.id,
    userId: somchaiTopUp.user.id,
    seatIds: await freeSeatIds(world, somchaiTopUp.showtime, 'PREMIUM', 2),
  });

  const topUpCancelled = pin('topUpCancelled');
  const { seatChange: withdrawn } = await requestSeatChange({
    bookingId: topUpCancelled.id,
    userId: topUpCancelled.user.id,
    seatIds: await freeSeatIds(world, topUpCancelled.showtime, 'PREMIUM', 1),
  });
  await cancelSeatChange({ seatChangeId: withdrawn.id, userId: topUpCancelled.user.id });

  const moved = pin('adminMove');
  await adminChangeSeats({
    bookingId: moved.id,
    adminId: admins.admin.id,
    seatIds: await freeSeatIds(world, moved.showtime, 'PREMIUM', 2),
    reason: 'ลูกค้าโทรแจ้งขอย้ายไปนั่งติดทางเดิน',
  });
  await backdate(world, [moved.id], 40);
  done.push(
    'เปลี่ยนที่นั่ง: ราคาเดิม · ถูกลง (รอคืนส่วนต่าง) · รอโอนส่วนต่าง 2 ใบ · สลิปส่วนต่างรอตรวจ · สลิปส่วนต่างถูกปฏิเสธ ' +
      '· หมดเวลาโอนส่วนต่าง · ยกเลิกคำขอ · ผู้ดูแลย้ายให้',
  );

  // ยกเลิกหลังจ่ายเงิน — ลูกค้ายกเลิกเองพร้อมบัญชี · ลูกค้ายกเลิกแล้วผู้ดูแลโอนคืนเสร็จ · ผู้ดูแลยกเลิกให้ (ไม่มีบัญชี)
  const selfCancel = pin('cancelWithAccount');
  await cancelBooking({
    bookingId: selfCancel.id,
    userId: selfCancel.user.id,
    refundAccount: account('กสิกรไทย', '0531234567', selfCancel.user),
  });
  await backdate(world, [selfCancel.id], 35);

  // ยกเลิกเมื่อเกือบชั่วโมงก่อน แล้วผู้ดูแลเพิ่งโอนคืนเสร็จ
  const refundDone = pin('refundDone');
  await cancelBooking({
    bookingId: refundDone.id,
    userId: refundDone.user.id,
    refundAccount: account('กรุงเทพ', '1234509876', refundDone.user),
  });
  await backdate(world, [refundDone.id], 55);
  const refundPayment = await mainPayment(refundDone.id);
  await completeRefund({
    paymentId: refundPayment.id,
    adminId: admins.staff.id,
    note: 'โอนคืนเต็มจำนวนแล้ว',
    file: await storeSlip('refund', () =>
      renderRefundSlip({
        amount: refundPayment.refundAmount,
        accountNo: refundPayment.refundAccountNo,
        code: refundDone.code,
        at: new Date(),
      }),
    ),
  });

  const adminCancel = pin('adminCancel');
  await cancelBooking({ bookingId: adminCancel.id, byAdmin: true, reason: 'ลูกค้าโทรแจ้งยกเลิก (ติดธุระด่วน)' });
  await backdate(world, [adminCancel.id], 20);
  done.push('ยกเลิกหลังจ่ายเงิน: ลูกค้ายกเลิกเอง (รอคืนเงิน) · โอนคืนเสร็จแล้ว · ผู้ดูแลยกเลิกให้ (รอลูกค้าแจ้งบัญชี)');

  // somchai — สลิปถูกปฏิเสธแล้วกลับไปรอชำระ (หน้าชำระเงินมีแถบแดงบอกเหตุผล) + ส่งสลิปแล้วรอตรวจ
  // ค้างรอชำระ/รอตรวจรวม 2 ใบ ต่ำกว่าเพดาน MAX_PENDING_BOOKINGS_PER_USER (3) — ล็อกอินแล้วยังลองจองใหม่ได้
  const somchaiRejected = await book(world, users.somchai, targets.somchaiRejected, 'PREMIUM', 2);
  await submitSlip(somchaiRejected, users.somchai, { minutesAgo: 12, amountDelta: -50 });
  await rejectPayment({
    paymentId: (await mainPayment(somchaiRejected.id)).id,
    adminId: admins.staff.id,
    reason: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ',
  });
  const somchaiReview = await book(world, users.somchai, targets.somchaiReview, 'NORMAL', 3);
  await submitSlip(somchaiReview, users.somchai, { minutesAgo: 25 });

  // คิวตรวจสลิปของผู้ดูแล — ส่งมาคนละเวลา (ไม่กี่นาทีถึงข้ามคืน) ใบหนึ่งยอดบนสลิปไม่ตรง (ไว้ลองกดปฏิเสธ)
  const queue = [
    { user: users.nattawut, zone: 'PREMIUM', count: 2, minutesAgo: 8 },
    { user: users.piyanuch, zone: 'SOFA', count: 1, minutesAgo: 47 },
    { user: users.kenji, zone: 'NORMAL', count: 1, minutesAgo: 81, amountDelta: -100 },
    { user: users.onuma, zone: 'NORMAL', count: 4, minutesAgo: 3 * 60 + 10 },
    { user: users.nanthida, zone: 'PREMIUM', count: 2, minutesAgo: 20 * 60 + 35 },
  ];
  for (const [i, item] of queue.entries()) {
    const booking = await book(world, item.user, targets.queue[i], item.zone, item.count);
    await submitSlip(booking, item.user, item);
  }

  // กดจองแล้วยังไม่ได้จ่าย
  await book(world, users.somying, targets.hold, 'NORMAL', 2);
  done.push(
    'คิวตรวจสลิป 7 ใบ ส่งมาคนละเวลา (ใบหนึ่งยอดไม่ตรง) · somchai สลิปถูกปฏิเสธแล้วรอจ่ายใหม่ · กดจองแล้วยังไม่จ่าย',
  );

  return done;
};
