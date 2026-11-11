import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma.js';
import { env } from '../../src/config/env.js';
import { formatBangkokShort } from '../../src/utils/datetime.js';
import { generateBookingCode, generatePaymentReference } from '../../src/utils/codes.js';
import { createPromptPayPayload } from '../../src/utils/promptpay.js';
import { formatReceiptNo, receiptYear } from '../../src/utils/receipt.js';
import { compareIds, seatLabels, snapshotSeat, sortSeats } from '../../src/utils/seats.js';
import { planSeatChange } from '../../src/utils/seatChange.js';
import { buildNotification } from '../../src/services/notifications.js';
import { REFUND_BANKS } from './catalog.js';
import { bangkokHour, bangkokWeekday } from './schedule.js';
import { pickSeats } from './seating.js';
import { nextSlipName, renderPaymentSlip, renderRefundSlip, storeSlips } from './slipImage.js';

/**
 * ประวัติการขาย — การจองที่ "จบแล้ว" (จ่ายแล้ว ยกเลิก หมดเวลา คืนเงินแล้ว) ทั้งรอบที่ฉายไปแล้วและรอบที่กำลังจะฉาย
 *
 * เขียนลงฐานตรง ๆ ทีละกลุ่ม (createMany) เพราะต้องย้อนเวลาได้ — service จริงประทับเวลาเป็น "ตอนนี้" เสมอ
 * และจองรอบที่ฉายไปแล้วไม่ได้ ทุกแถวจึงต้องสร้างให้ตรงกับที่ service จะสร้างเอง:
 * ที่นั่งของใบที่จ่ายแล้วอยู่ใน BookingSeat (ใบที่ปิดแล้วไม่มี) · ยอดรวม = ผลรวมราคาใน seatSnapshot
 * · เลขใบเสร็จเรียงตามเวลาอนุมัติ และตัวนับ ReceiptCounter ต่อจากเลขสุดท้าย · ข้อความแจ้งเตือนจาก buildNotification ชุดเดียวกับระบบ
 *
 * สถานะที่ยังเดินอยู่ (กันที่นั่งรอจ่าย สลิปรอตรวจ คำขอเปลี่ยนที่นั่ง ยกเลิกทั้งรอบ) ทำผ่าน service จริงใน scenarios.js
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * ความต้องการรวม (ที่นั่ง) ที่สุ่มให้รอบที่ฉายไปแล้วกับรอบที่กำลังจะฉาย — ตัวนี้คุมปริมาณการจองทั้งหมดของ seed
 * รอบที่กำลังจะฉายได้ไปแค่ส่วนที่จองมาแล้ว (ราวครึ่งเดียว) งบจึงต้องสูงกว่าที่เห็นจริง
 * ไม่นับรอบพิเศษที่ scenarios.js เลือกไว้ (ขายหมด เกือบเต็ม รอบขายดีในสัปดาห์ที่ผ่านมา) ซึ่งเติมตามสัดส่วนของตัวเอง
 */
export const SEAT_BUDGET = { past: 300, upcoming: 420 };

/** จองล่วงหน้าได้ไกลสุดกี่วัน */
const ADVANCE_DAYS = 8;

const PARTY_SIZES = [
  [1, 18],
  [2, 42],
  [3, 14],
  [4, 16],
  [5, 6],
  [6, 4],
];
const ZONE_WEIGHTS = { NORMAL: 45, PREMIUM: 42, SOFA: 13 };
const ZONES = Object.keys(ZONE_WEIGHTS);

/** ผลของการจองที่สุ่มขึ้นมา — ส่วนใหญ่จ่ายจบ ที่เหลือหมดเวลา ยกเลิกก่อนจ่าย หรือจ่ายแล้วยกเลิกขอเงินคืน */
const OUTCOMES = [
  ['PAID', 86],
  ['EXPIRED', 6],
  ['ABANDONED', 3],
  ['CANCELLED', 5],
];


const at = (ms) => new Date(Math.round(ms));
const latestOf = (...dates) => at(Math.max(...dates.filter(Boolean).map((date) => date.getTime())));

const takenOf = (world, showtime) => {
  if (!world.taken.has(showtime.id)) world.taken.set(showtime.id, new Set());
  return world.taken.get(showtime.id);
};

const reserve = (world, showtime, seats) => {
  const taken = takenOf(world, showtime);
  for (const seat of seats) taken.add(seat.id);
};

/** ลูกค้าที่มีการจองในรอบนี้แล้ว (รวมใบที่ pin ไว้) */
const bookedUsersOf = (world, showtime) => {
  if (!world.bookedUsers.has(showtime.id)) world.bookedUsers.set(showtime.id, new Set());
  return world.bookedUsers.get(showtime.id);
};

/**
 * คนที่จองใบนี้ — ไม่ให้คนเดิมจองรอบเดียวกันซ้ำถ้ายังมีลูกค้าคนอื่นเหลือ (ไม่งั้นได้แจ้งเตือนก่อนฉายซ้ำสองอันจากรอบเดียว)
 * รอบที่คนจองเยอะกว่าจำนวนลูกค้าตัวอย่างจึงซ้ำได้ ยกเว้นบัญชี somchai ที่คนเปิดดูหน้าการจอง/แจ้งเตือนบ่อยที่สุด
 */
const pickBooker = (world, showtime) => {
  const booked = bookedUsersOf(world, showtime);
  const user =
    world.random.weighted(world.bookers, (booker) => (booked.has(booker.id) ? 0 : booker.activity)) ??
    world.random.weighted(world.bookers, (booker) => (booker.id === world.users.somchai.id ? 0 : booker.activity));
  booked.add(user.id);
  return user;
};

const pickFor = (world, showtime, zone, count) => {
  return pickSeats(world.inventory.get(showtime.theatre.id), takenOf(world, showtime), {
    zone,
    count,
    random: world.random,
  });
};

/**
 * จองก่อนรอบฉายนานแค่ไหน — ราวครึ่งหนึ่งจองวันเดียวกับที่ดู ที่เหลือจองล่วงหน้าเป็นวัน
 * [สัดส่วน, ล่วงหน้าน้อยสุด, มากสุด] หน่วยนาที
 */
const LEAD_BANDS = [
  [45, 20, 8 * 60],
  [30, 8 * 60, 48 * 60],
  [25, 48 * 60, ADVANCE_DAYS * 24 * 60],
];

/**
 * เวลากดจองของรอบนี้ — สุ่มระยะจองล่วงหน้านับถอยจากเวลาฉาย คนส่วนใหญ่จองช่วง 8 โมงเช้าถึงเที่ยงคืน
 * ได้เวลาที่ยังมาไม่ถึง (หลัง "ตอนนี้" − 15 นาที หรือหลัง latestAt) = คนนี้ยังไม่ได้จอง → null
 * รอบที่อีกหลายวันกว่าจะฉายจึงมีคนจองน้อยกว่ารอบใกล้ ๆ เอง เหมือนยอดที่ค่อย ๆ สะสมจริง
 */
const bookingTime = (world, showtime, latestAt) => {
  const { random } = world;
  const start = showtime.startsAt.getTime();
  const [, minLead, maxLead] = random.weighted(LEAD_BANDS, ([weight]) => weight);
  // บวกวินาทีสุ่ม — เวลาไม่ลงนาทีเต็มพร้อมกันหลายใบ (ลำดับเลขใบเสร็จจะได้ตรงกับเวลาอนุมัติชัดเจน)
  let created = start - random.int(minLead, maxLead) * MINUTE - random.int(0, 59_999);
  const hour = bangkokHour(at(created));
  // ตีหนึ่งถึงเจ็ดโมงส่วนใหญ่หลับอยู่ — ย้ายไปเป็นช่วงสามทุ่มถึงเที่ยงคืนของคืนก่อน
  if (hour < 8 && random.chance(0.85)) created -= (hour + random.int(1, 3)) * HOUR;
  const latest = Math.min(world.now.getTime() - 15 * MINUTE, latestAt?.getTime() ?? Infinity);
  return created <= latest ? at(created) : null;
};

/** เวลาจองของใบที่ pin ไว้ — ต้องได้แน่นอน สุ่มไม่ได้ก็ใช้เวลาก่อนเส้นตายเล็กน้อย */
const pinnedBookingTime = (world, showtime, latestAt) => {
  for (let i = 0; i < 30; i += 1) {
    const created = bookingTime(world, showtime, latestAt);
    if (created) return created;
  }
  const latest = Math.min(
    world.now.getTime() - 15 * MINUTE,
    latestAt.getTime(),
    showtime.startsAt.getTime() - 20 * MINUTE,
  );
  return at(latest - world.random.int(10, 180) * MINUTE);
};

const newPlan = ({ user, showtime, seats, createdAt }) => {
  const seatSnapshot = sortSeats(seats).map((seat) => snapshotSeat(seat, showtime.priceMap[seat.zone]));
  const totalAmount = seatSnapshot.reduce((sum, seat) => sum + seat.price, 0);
  return {
    code: generateBookingCode(),
    user,
    showtime,
    seatSnapshot,
    totalAmount,
    createdAt,
    status: 'PENDING_PAYMENT',
    holdsSeats: false,
    payment: { amount: totalAmount, reference: generatePaymentReference(), status: 'AWAITING_SLIP' },
  };
};

// ---------- ผลของการจอง ----------

/** ส่งสลิปภายในเวลา แล้วผู้ดูแลอนุมัติ (ได้ใบเสร็จ) */
const pay = (world, plan) => {
  const { random, now } = world;
  const start = plan.showtime.startsAt.getTime();
  const uploaded = plan.createdAt.getTime() + random.int(2, 8) * MINUTE + random.int(0, 59_999);
  const latest = Math.min(now.getTime() - MINUTE, start - 2 * MINUTE);
  const wanted = uploaded + random.int(3, 50) * MINUTE + random.int(0, 59_999);
  // ไม่ทันช่วงที่อยากได้ (ใกล้ "ตอนนี้" หรือใกล้รอบเริ่ม) ก็สุ่มในช่วงที่เหลือ — ไม่ตัดให้ทุกใบไปกองที่เวลาเดียวกัน
  const verified =
    wanted <= latest ? wanted : uploaded + MINUTE + random.next() * Math.max(0, latest - uploaded - MINUTE);

  Object.assign(plan.payment, {
    status: 'APPROVED',
    slipPath: nextSlipName('payment'),
    slipUploadedAt: at(uploaded),
    verifiedAt: at(verified),
    verifiedBy: random.chance(0.7) ? world.admins.admin : world.admins.staff,
    receipt: true,
    receiptSeats: plan.seatSnapshot,
  });
  plan.status = 'PAID';
  plan.paidAt = at(verified);
  plan.holdsSeats = true;

  // job แจ้งเตือนล่วงหน้า 1 ชั่วโมง — จ่ายหลังจากนั้นก็ได้แจ้งเตือนรอบถัดไปของ job ทันที
  const remindAt = Math.max(start - HOUR, verified + MINUTE);
  if (remindAt < start && remindAt <= now.getTime()) plan.reminderSentAt = at(remindAt);
};

/** ไม่ได้ส่งสลิปภายในเวลากันที่นั่ง — job ปิดการจองและปล่อยที่นั่ง */
const expire = (world, plan) => {
  const expiredAt = plan.createdAt.getTime() + env.SEAT_HOLD_MINUTES * MINUTE + world.random.int(0, 30) * 1000;
  plan.status = 'EXPIRED';
  plan.expiredAt = at(expiredAt);
  plan.cancelReason = 'หมดเวลาชำระเงิน';
  Object.assign(plan.payment, { status: 'REJECTED', rejectReason: 'หมดเวลาชำระเงิน' });
};

/** ลูกค้ากดยกเลิกเองก่อนจ่าย */
const abandon = (world, plan) => {
  plan.status = 'CANCELLED';
  plan.cancelledAt = at(plan.createdAt.getTime() + world.random.int(1, 8) * MINUTE);
  plan.cancelReason = 'ผู้ใช้ยกเลิกเอง';
  plan.cancelledBy = 'customer';
  Object.assign(plan.payment, { status: 'REJECTED', rejectReason: 'ผู้ใช้ยกเลิกเอง' });
};

const refundAccountFor = (random, user) => ({
  bankName: random.pick(REFUND_BANKS),
  accountNo: Array.from({ length: 10 }, () => random.int(0, 9)).join(''),
  accountName: user.name,
});

/**
 * ใบที่จ่ายแล้วถูกยกเลิก → เข้าคิวคืนเงินเต็มยอดสุทธิ แล้วถ้าผ่านมานานพอผู้ดูแลโอนคืนไปแล้ว (มีสลิปโอนคืน)
 * ยังไม่มีบัญชีรับเงินคืน = ค้างคิวจนกว่าลูกค้าจะแจ้ง (เคสยกเลิกทั้งรอบ)
 */
const queueRefund = (world, plan, { dueAt, account, refundAfterHours }) => {
  const { random, now } = world;
  Object.assign(plan.payment, {
    status: 'REFUND_PENDING',
    refundDueAt: dueAt,
    refundAmount: plan.totalAmount,
    account,
  });
  const refundedAt = dueAt.getTime() + refundAfterHours * HOUR + random.int(0, 59) * MINUTE;
  if (account && refundedAt <= now.getTime() - 5 * MINUTE) {
    Object.assign(plan.payment, {
      status: 'REFUNDED',
      refundedAt: at(refundedAt),
      refundedBy: random.chance(0.5) ? world.admins.admin : world.admins.staff,
      refundSlipPath: nextSlipName('refund'),
      refundNote: random.pick([null, 'โอนคืนเต็มจำนวนแล้ว', 'โอนคืนตามบัญชีที่ลูกค้าแจ้ง']),
    });
  }
};

const dropReminderAfter = (plan, cancelledAt) => {
  if (plan.reminderSentAt && plan.reminderSentAt > cancelledAt) plan.reminderSentAt = null;
};

/** จ่ายแล้วยกเลิกเอง — ต้องก่อนรอบฉายอย่างน้อย CANCEL_CUTOFF_HOURS (กติกาเดียวกับ cancelBooking) ไม่ทันก็คงเป็นใบที่จ่ายแล้ว */
const cancelAfterPaying = (world, plan, refundAfterHours) => {
  const { random, now } = world;
  const paid = plan.paidAt.getTime();
  const latest = Math.min(
    plan.showtime.startsAt.getTime() - env.CANCEL_CUTOFF_HOURS * HOUR,
    now.getTime() - 5 * MINUTE,
  );
  if (latest - paid < 10 * MINUTE) return false;

  const cancelledAt = at(paid + 5 * MINUTE + (latest - paid - 5 * MINUTE) * random.next());
  plan.status = 'CANCELLED';
  plan.cancelledAt = cancelledAt;
  plan.cancelReason = 'ผู้ใช้ยกเลิกเอง';
  plan.cancelledBy = 'customer';
  plan.holdsSeats = false;
  dropReminderAfter(plan, cancelledAt);
  queueRefund(world, plan, {
    dueAt: cancelledAt,
    account: refundAccountFor(random, plan.user),
    refundAfterHours: refundAfterHours ?? random.int(2, 30),
  });
  return true;
};

/** รอบถูกยกเลิกทั้งรอบ — ใบที่จ่ายแล้วเข้าคิวคืนเงิน ลูกค้าส่วนใหญ่แจ้งบัญชีมาทีหลังแล้วได้เงินคืน */
const cancelWithShowtime = (world, plan, { cancelledAt, reason }) => {
  const { random } = world;
  plan.status = 'CANCELLED';
  plan.cancelledAt = cancelledAt;
  plan.cancelReason = `รอบฉายถูกยกเลิก: ${reason}`;
  plan.cancelledBy = 'showtime';
  plan.showtimeReason = reason;
  plan.holdsSeats = false;
  dropReminderAfter(plan, cancelledAt);
  queueRefund(world, plan, {
    dueAt: cancelledAt,
    account: random.chance(0.75) ? refundAccountFor(random, plan.user) : null,
    refundAfterHours: random.int(5, 40),
  });
};

/**
 * ย้ายไปที่นั่งที่แพงกว่า + จ่ายส่วนต่างแล้ว (ผู้ดูแลอนุมัติ ได้ใบเสร็จส่วนต่าง) — แบบเดียวกับ approveTopUp
 * ใบเสร็จค่าตั๋วยังเป็นที่นั่งชุดเดิม (receiptSeats) การจองเปลี่ยนเป็นชุดใหม่และยอดใหม่
 */
const upgrade = (world, plan, toSeats) => {
  const { random, now } = world;
  const change = planSeatChange({
    fromSeats: plan.seatSnapshot,
    newSeats: toSeats,
    priceMap: plan.showtime.priceMap,
  });
  const requested = Math.min(plan.paidAt.getTime() + DAY + random.int(0, 120) * MINUTE, now.getTime() - 3 * HOUR);
  const uploaded = requested + random.int(2, 7) * MINUTE;
  const completed = uploaded + random.int(5, 40) * MINUTE;

  plan.seatChange = {
    fromSeats: plan.seatSnapshot,
    toSeats: change.toSeats,
    fromAmount: change.fromAmount,
    toAmount: change.toAmount,
    diffAmount: change.diffAmount,
    createdAt: at(requested),
    completedAt: at(completed),
    payment: {
      amount: change.diffAmount,
      reference: generatePaymentReference(),
      slipPath: nextSlipName('payment'),
      slipUploadedAt: at(uploaded),
      verifiedAt: at(completed),
      verifiedBy: world.admins.staff,
      receipt: true,
    },
  };
  plan.seatSnapshot = change.toSeats;
  plan.totalAmount = change.toAmount;
};

const applyOutcome = (world, plan, outcome) => {
  if (outcome === 'EXPIRED') return expire(world, plan);
  if (outcome === 'ABANDONED') return abandon(world, plan);
  pay(world, plan);
  if (outcome === 'CANCELLED') cancelAfterPaying(world, plan);
};

// ---------- สุ่มยอดขายของแต่ละรอบ ----------

/**
 * ความต้องการรวมของรอบ (นับถึงวันฉาย) — รอบค่ำ เสาร์อาทิตย์ หนังดัง และ IMAX/4DX ขายได้มากกว่า
 * รอบที่ยังไม่ถึงวันฉายได้ไปแค่ส่วนที่ "จองมาแล้ว" (ดู bookingTime)
 */
const demandWeight = (showtime) => {
  const hour = bangkokHour(showtime.startsAt);
  const weekday = bangkokWeekday(showtime.startsAt);
  let weight = hour < 13 ? 0.35 : hour < 17 ? 0.7 : hour < 21 ? 1.6 : 0.9;
  if (weekday === 5) weight *= 1.2;
  if (weekday === 0 || weekday === 6) weight *= 1.6;
  weight *= showtime.movie.popularity;
  if (['IMAX', '4DX'].includes(showtime.theatre.screenType)) weight *= 1.3;
  return weight;
};

/**
 * แบ่งงบที่นั่งให้แต่ละรอบตามความต้องการ บวกความผันผวน — ยกกำลังน้ำหนักให้รอบยอดนิยมกินส่วนแบ่งมากกว่าเส้นตรง
 * และราวหนึ่งในสี่ของรอบไม่มีคนจองเลย แบบโรงจริงที่รอบกลางวันวันธรรมดาว่างทั้งโรง
 */
const distribute = (world, showtimes, budget) => {
  const { random } = world;
  const weights = showtimes.map((showtime) => demandWeight(showtime) ** 1.6);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return showtimes.map((showtime, i) => {
    const capacity = world.inventory.get(showtime.theatre.id).total;
    const noise = random.chance(0.25) ? 0 : 0.4 + 1.5 * random.next();
    const target = Math.round(budget * (weights[i] / total) * noise);
    return { showtime, target: Math.min(target, Math.floor(capacity * 0.75)) };
  });
};

/**
 * ขายที่นั่งของรอบนี้จนได้ targetSeats ที่ (นับเฉพาะใบที่ยังถือที่นั่ง) — คนที่มาด้วยกันได้ที่นั่งติดกัน
 * allPaid = ทุกใบจ่ายจบ (รอบขายหมด) · mustFill = ขายให้ได้ตามเป้าจริง ไม่นับคนที่ยังไม่มาจอง (รอบขายหมด/เกือบเต็ม)
 * latestAt = ห้ามจองหลังเวลานี้ (รอบที่ถูกยกเลิกไปแล้ว)
 */
const fillShowtime = (world, showtime, targetSeats, { allPaid = false, mustFill = allPaid, latestAt } = {}) => {
  const { random } = world;
  const plans = [];
  let filled = 0;

  for (let guard = 0; filled < targetSeats && guard < 400; guard += 1) {
    const party = random.weighted(PARTY_SIZES, ([, weight]) => weight)[0];
    // กลุ่มสุดท้ายเกินเป้าได้ — ยกเว้นรอบขายหมดที่ต้องเติมช่องที่เหลือให้พอดี (เหลือที่เดี่ยว ๆ ก็ได้คนมาคนเดียว)
    const size = allPaid ? Math.min(party, targetSeats - filled) : party;
    const preferred = random.weighted(ZONES, (zone) => (zone === 'SOFA' && size === 1 ? 0 : ZONE_WEIGHTS[zone]));
    // โซฟาเป็นที่นั่งคู่ — มาสองคนใช้หนึ่งตัว
    const countIn = (zone) => (zone === 'SOFA' ? Math.ceil(size / 2) : size);
    let seats = pickFor(world, showtime, preferred, countIn(preferred));
    for (const zone of ZONES) {
      if (seats) break;
      if (zone !== preferred) seats = pickFor(world, showtime, zone, countIn(zone));
    }
    if (!seats) {
      if (size === 1) break; // เต็มแล้ว
      continue;
    }

    const createdAt = bookingTime(world, showtime, latestAt);
    if (!createdAt) {
      // คนกลุ่มนี้ยังไม่ได้มาจอง (จะจองทีหลัง) — นับเป็นความต้องการที่ยังไม่เกิด ยกเว้นรอบที่ต้องขายให้ถึงเป้าจริง
      if (!mustFill) filled += seats.length;
      continue;
    }
    const user = pickBooker(world, showtime);
    const plan = newPlan({ user, showtime, seats, createdAt });
    applyOutcome(world, plan, allPaid ? 'PAID' : random.weighted(OUTCOMES, ([, weight]) => weight)[0]);
    if (plan.holdsSeats) {
      reserve(world, showtime, seats);
      filled += seats.length;
    }
    plans.push(plan);
  }
  return plans;
};

/**
 * การจองที่สถานการณ์ใน scenarios.js ต้องใช้ต่อ (เช่น ใบที่จ่ายแล้วไว้ลองเปลี่ยนที่นั่ง/ยกเลิก)
 * pin = { key, user, showtime, zone, count, outcome?, upgradeTo?, latestAt? } — จองก่อนการสุ่ม ที่นั่งจึงได้แน่นอน
 */
const buildPinned = (world, pin) => {
  const seats = pickFor(world, pin.showtime, pin.zone, pin.count);
  if (!seats) throw new Error(`seed: เตรียมการจอง "${pin.key}" ไม่ได้ (ที่นั่งไม่พอ)`);
  const createdAt = pinnedBookingTime(world, pin.showtime, pin.latestAt ?? new Date(world.now.getTime() - 2 * HOUR));

  const plan = newPlan({ user: pin.user, showtime: pin.showtime, seats, createdAt });
  plan.key = pin.key;
  bookedUsersOf(world, pin.showtime).add(pin.user.id);

  if (pin.outcome === 'EXPIRED') {
    expire(world, plan);
    return plan;
  }
  pay(world, plan);
  if (pin.outcome === 'REFUNDED' && !cancelAfterPaying(world, plan, world.random.int(3, 20))) {
    throw new Error(`seed: การจอง "${pin.key}" ยกเลิกก่อนรอบฉายตามกติกาไม่ทัน`);
  }
  if (pin.outcome === 'UPGRADED') {
    const toSeats = pickFor(world, pin.showtime, pin.upgradeTo, pin.count);
    if (!toSeats) throw new Error(`seed: หาที่นั่งใหม่ให้ "${pin.key}" ไม่ได้`);
    upgrade(world, plan, toSeats);
    reserve(world, pin.showtime, toSeats);
    return plan;
  }
  if (plan.holdsSeats) reserve(world, pin.showtime, seats);
  return plan;
};

// ---------- ใบเสร็จ แจ้งเตือน และแถวที่บันทึก ----------

/** เลขใบเสร็จเรียงตามเวลาอนุมัติจริง (แยกชุดตามปี) — คืนค่าตัวนับของแต่ละปีให้การอนุมัติครั้งถัดไปออกเลขต่อได้ */
const assignReceipts = (plans) => {
  const issued = plans
    .flatMap((plan) => [plan.payment, plan.seatChange?.payment])
    .filter((payment) => payment?.receipt)
    .sort((a, b) => a.verifiedAt - b.verifiedAt);
  const lastByYear = new Map();
  for (const payment of issued) {
    const year = receiptYear(payment.verifiedAt);
    const sequence = (lastByYear.get(year) ?? 0) + 1;
    lastByYear.set(year, sequence);
    payment.receiptNo = formatReceiptNo(year, sequence);
  }
  return [...lastByYear].map(([year, lastNo]) => ({ year, lastNo }));
};

const bookingRow = (plan) => ({
  code: plan.code,
  userId: plan.user.id,
  showtimeId: plan.showtime.id,
  status: plan.status,
  totalAmount: plan.totalAmount,
  holdExpiresAt: null,
  seatSnapshot: plan.seatSnapshot,
  cancelReason: plan.cancelReason ?? null,
  reminderSentAt: plan.reminderSentAt ?? null,
  paidAt: plan.paidAt ?? null,
  cancelledAt: plan.cancelledAt ?? null,
  expiredAt: plan.expiredAt ?? null,
  createdAt: plan.createdAt,
  updatedAt: latestOf(plan.createdAt, plan.paidAt, plan.cancelledAt, plan.expiredAt, plan.seatChange?.completedAt),
});

const paymentRow = (plan) => {
  const payment = plan.payment;
  return {
    bookingId: plan.id,
    // ใบหลัก (ค่าตั๋วตอนจอง) — booking.payment อ่านผ่านตัวนี้
    mainBookingId: plan.id,
    kind: 'BOOKING',
    amount: payment.amount,
    qrPayload: createPromptPayPayload(payment.amount),
    reference: payment.reference,
    slipPath: payment.slipPath ?? null,
    slipUploadedAt: payment.slipUploadedAt ?? null,
    status: payment.status,
    verifiedById: payment.verifiedBy?.id ?? null,
    verifiedAt: payment.verifiedAt ?? null,
    rejectReason: payment.rejectReason ?? null,
    receiptNo: payment.receiptNo ?? null,
    receiptName: payment.receiptNo ? plan.user.name : null,
    receiptSeats: payment.receiptNo ? payment.receiptSeats : Prisma.DbNull,
    refundDueAt: payment.refundDueAt ?? null,
    refundAmount: payment.refundAmount ?? null,
    refundBankName: payment.account?.bankName ?? null,
    refundAccountNo: payment.account?.accountNo ?? null,
    refundAccountName: payment.account?.accountName ?? null,
    refundedAt: payment.refundedAt ?? null,
    refundedById: payment.refundedBy?.id ?? null,
    refundSlipPath: payment.refundSlipPath ?? null,
    refundNote: payment.refundNote ?? null,
    createdAt: plan.createdAt,
    updatedAt: latestOf(
      plan.createdAt,
      payment.slipUploadedAt,
      payment.verifiedAt,
      payment.refundDueAt,
      payment.refundedAt,
      plan.cancelledAt,
      plan.expiredAt,
    ),
  };
};

/** แจ้งเตือนเก่าส่วนใหญ่ถูกเปิดอ่านไปแล้ว ของช่วงไม่กี่ชั่วโมงล่าสุดส่วนใหญ่ยังไม่อ่าน */
const readAtFor = (world, createdAt) => {
  const { random, now } = world;
  const age = now.getTime() - createdAt.getTime();
  const read = age > 2 * DAY || (age > 6 * HOUR && random.chance(0.6)) || random.chance(0.15);
  if (!read) return null;
  const readAt = Math.min(createdAt.getTime() + random.int(5, 600) * MINUTE, now.getTime() - MINUTE);
  return readAt > createdAt.getTime() ? at(readAt) : null;
};

const notice = (world, plan, type, createdAt, context, data = {}) => ({
  ...buildNotification({ userId: plan.user.id, type, context, data: { bookingId: plan.id, ...data } }),
  createdAt,
  readAt: readAtFor(world, createdAt),
});

const reminderTime = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

/** แจ้งเตือนที่ระบบจะส่งให้ตามเส้นทางของการจองใบนี้ (ข้อความชุดเดียวกับ notify ของ service) */
const notificationsFor = (world, plan) => {
  const { code, payment, showtime } = plan;
  const list = [];
  if (payment.receiptNo) {
    list.push(notice(world, plan, 'PAYMENT_APPROVED', payment.verifiedAt, { code, receiptNo: payment.receiptNo }));
  }
  if (plan.reminderSentAt) {
    list.push(
      notice(world, plan, 'SHOWTIME_REMINDER', plan.reminderSentAt, {
        movieTh: showtime.movie.titleTh,
        movieEn: showtime.movie.titleEn,
        theatre: showtime.theatre.name,
        timeText: reminderTime.format(showtime.startsAt),
      }),
    );
  }
  if (plan.status === 'EXPIRED') list.push(notice(world, plan, 'BOOKING_EXPIRED', plan.expiredAt, { code }));
  if (plan.cancelledBy === 'customer') list.push(notice(world, plan, 'BOOKING_CANCELLED', plan.cancelledAt, { code }));
  if (plan.cancelledBy === 'showtime') {
    list.push(
      notice(
        world,
        plan,
        'SHOWTIME_CANCELLED',
        plan.cancelledAt,
        {
          movieTh: showtime.movie.titleTh,
          movieEn: showtime.movie.titleEn,
          whenTh: formatBangkokShort(showtime.startsAt, 'th'),
          whenEn: formatBangkokShort(showtime.startsAt, 'en'),
          reason: plan.showtimeReason,
          code,
          refund: Boolean(payment.refundDueAt),
        },
        { showtimeId: showtime.id },
      ),
    );
  }
  if (payment.refundedAt) {
    list.push(notice(world, plan, 'REFUND_COMPLETED', payment.refundedAt, { code, amount: payment.refundAmount }));
  }
  return list;
};

const labels = (seats) => seatLabels(seats).join(', ');

/** คำขอเปลี่ยนที่นั่งที่จ่ายส่วนต่างจบแล้ว + รายการเงินส่วนต่าง (มีไม่กี่ใบ สร้างทีละใบได้) */
const writeSeatChange = async (world, plan) => {
  const change = plan.seatChange;
  const created = await prisma.seatChange.create({
    data: {
      bookingId: plan.id,
      status: 'COMPLETED',
      fromSeats: change.fromSeats,
      toSeats: change.toSeats,
      fromAmount: change.fromAmount,
      toAmount: change.toAmount,
      diffAmount: change.diffAmount,
      completedAt: change.completedAt,
      createdAt: change.createdAt,
      updatedAt: change.completedAt,
    },
  });
  const payment = change.payment;
  await prisma.payment.create({
    data: {
      bookingId: plan.id,
      kind: 'SEAT_CHANGE_TOPUP',
      seatChangeId: created.id,
      amount: payment.amount,
      qrPayload: createPromptPayPayload(payment.amount),
      reference: payment.reference,
      slipPath: payment.slipPath,
      slipUploadedAt: payment.slipUploadedAt,
      status: 'APPROVED',
      verifiedById: payment.verifiedBy.id,
      verifiedAt: payment.verifiedAt,
      receiptNo: payment.receiptNo,
      receiptName: plan.user.name,
      createdAt: change.createdAt,
      updatedAt: change.completedAt,
    },
  });
  return notice(
    world,
    plan,
    'SEATS_CHANGED',
    change.completedAt,
    {
      code: plan.code,
      from: labels(change.fromSeats),
      to: labels(change.toSeats),
      diff: change.diffAmount,
      byAdmin: false,
      reason: null,
      receiptNo: payment.receiptNo,
    },
    { seatChangeId: created.id },
  );
};

const writePlans = async (world, plans) => {
  const counters = assignReceipts(plans);

  // id ของการจองมาจากฐาน — จับคู่กลับด้วยรหัสการจอง (unique) ไม่พึ่งลำดับของแถวที่คืนมา
  const created = await prisma.booking.createManyAndReturn({
    data: plans.map(bookingRow),
    select: { id: true, code: true },
  });
  const idByCode = new Map(created.map((row) => [row.code, row.id]));
  for (const plan of plans) plan.id = idByCode.get(plan.code);

  await prisma.bookingSeat.createMany({
    data: plans
      .filter((plan) => plan.holdsSeats)
      .flatMap((plan) =>
        plan.seatSnapshot
          .map((seat) => ({ bookingId: plan.id, showtimeId: plan.showtime.id, seatId: seat.id, price: seat.price }))
          // เขียนที่นั่งเรียงตาม id แบบเดียวกับ createBooking
          .sort((a, b) => compareIds(a.seatId, b.seatId)),
      ),
  });
  await prisma.payment.createMany({ data: plans.map(paymentRow) });

  const notifications = plans.flatMap((plan) => notificationsFor(world, plan));
  for (const plan of plans.filter((item) => item.seatChange)) {
    notifications.push(await writeSeatChange(world, plan));
  }

  await prisma.receiptCounter.createMany({ data: counters });
  await prisma.notification.createMany({ data: notifications });
};

const slipJobs = (plans) => {
  const jobs = [];
  for (const plan of plans) {
    for (const payment of [plan.payment, plan.seatChange?.payment]) {
      if (payment?.slipPath) {
        jobs.push({
          kind: 'payment',
          name: payment.slipPath,
          render: () =>
            renderPaymentSlip({
              amount: payment.amount,
              reference: payment.reference,
              code: plan.code,
              at: payment.slipUploadedAt,
            }),
        });
      }
      if (payment?.refundSlipPath) {
        jobs.push({
          kind: 'refund',
          name: payment.refundSlipPath,
          render: () =>
            renderRefundSlip({
              amount: payment.refundAmount,
              accountNo: payment.account?.accountNo,
              code: plan.code,
              at: payment.refundedAt,
            }),
        });
      }
    }
  }
  return jobs;
};

/**
 * สร้างประวัติการขายทั้งหมด
 * targets มาจาก scenarios.js: soldOut (ขายหมด) · nearlyFull (เกือบเต็ม) · cancelledPast (รอบที่ถูกยกเลิกไปแล้ว)
 * · busyPast (รอบที่ฉายไปแล้วพร้อมสัดส่วนที่นั่งที่ขายได้)
 * @returns {Map<string, object>} การจองที่ pin ไว้ (key → plan ที่มี id แล้ว) ให้ scenarios.js ใช้ต่อ
 */
export const seedSales = async (world, { pins, targets }) => {
  const plans = [];
  const pinned = new Map();

  for (const pin of pins) {
    const plan = buildPinned(world, pin);
    plans.push(plan);
    pinned.set(pin.key, plan);
  }

  const { soldOut, nearlyFull, cancelledPast, busyPast } = targets;
  const capacityOf = (showtime) => world.inventory.get(showtime.theatre.id).total;
  plans.push(...fillShowtime(world, soldOut, capacityOf(soldOut), { allPaid: true }));
  plans.push(...fillShowtime(world, nearlyFull, Math.round(capacityOf(nearlyFull) * 0.85), { mustFill: true }));
  for (const { showtime, fill } of busyPast) {
    plans.push(...fillShowtime(world, showtime, Math.round(capacityOf(showtime) * fill), { mustFill: true }));
  }

  // รอบที่ถูกยกเลิกไปเมื่อไม่กี่วันก่อน (ก่อนฉายราวชั่วโมงครึ่ง) — การจองทั้งหมดเกิดก่อนเวลายกเลิก
  const cancelledAt = at(cancelledPast.startsAt.getTime() - 100 * MINUTE);
  const reason = 'ไฟฟ้าดับทั้งอาคาร';
  for (const plan of fillShowtime(world, cancelledPast, 16, { latestAt: at(cancelledAt.getTime() - 10 * MINUTE) })) {
    if (plan.status === 'PAID') cancelWithShowtime(world, plan, { cancelledAt, reason });
    plans.push(plan);
  }

  const special = new Set([
    soldOut.id,
    nearlyFull.id,
    cancelledPast.id,
    ...busyPast.map(({ showtime }) => showtime.id),
  ]);
  const rest = world.showtimes.filter((showtime) => !special.has(showtime.id));
  const past = rest.filter((showtime) => showtime.startsAt <= world.now);
  const upcoming = rest.filter((showtime) => showtime.startsAt > world.now);
  for (const { showtime, target } of [
    ...distribute(world, past, SEAT_BUDGET.past),
    ...distribute(world, upcoming, SEAT_BUDGET.upcoming),
  ]) {
    plans.push(...fillShowtime(world, showtime, target));
  }

  await writePlans(world, plans);
  await prisma.showtime.update({ where: { id: cancelledPast.id }, data: { status: 'CANCELLED' } });
  await storeSlips(slipJobs(plans));

  return pinned;
};
