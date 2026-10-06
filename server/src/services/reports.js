import prisma from '../lib/prisma.js';
import { bangkokDateKey, bangkokDayRange } from '../utils/datetime.js';
import { PENDING_SLIP_WHERE } from './payments.js';
import { SELLABLE_SEAT_COUNTS } from './showtimes.js';

const PAID = 'PAID';

/**
 * เงื่อนไขของ "งานค้าง" ที่ต้องนับ — ใช้ร่วมกันระหว่างหน้าภาพรวม ป้ายตัวเลขบน sidebar และคิวตรวจสลิป
 * ถ้าแยกกันเขียนแล้วแก้ที่เดียว ตัวเลขสองที่จะไม่ตรงกันโดยไม่มีใครรู้
 * (PENDING_SLIP_WHERE อยู่ใน payments.js คู่กับ listPayments ที่ใช้เงื่อนไขเดียวกัน)
 */
const PENDING_REFUND_WHERE = { status: 'REFUND_PENDING' };

/**
 * ตัวเลขงานค้างสำหรับป้ายบน sidebar (+ ยอดรวมที่ต้องโอนคืน ใช้เป็นบรรทัดสรุปของหน้าคืนเงิน)
 * แยกจาก getOverview เพราะถูกเรียกถี่กว่ามาก จึงนับแค่ไม่กี่ตัวเลขให้เบาที่สุด
 */
export const getQueueCounts = async () => {
  const [pendingSlips, refunds] = await Promise.all([
    prisma.payment.count({ where: PENDING_SLIP_WHERE }),
    // ยอดที่ต้องโอนจริง (refundAmount) — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
    prisma.payment.aggregate({ where: PENDING_REFUND_WHERE, _count: true, _sum: { refundAmount: true } }),
  ]);
  return {
    pendingSlips,
    pendingRefunds: refunds._count,
    pendingRefundAmount: refunds._sum.refundAmount ?? 0,
  };
};

/** แถวในแผงสลิป/คืนเงินของหน้าภาพรวม ต้องการแค่รหัส ชื่อผู้จอง ยอด และสถานะ */
const QUEUE_ROW_SELECT = {
  id: true,
  status: true,
  amount: true,
  refundAmount: true,
  booking: { select: { id: true, code: true, user: { select: { name: true } } } },
};

const toQueueRow = (payment) => ({
  id: payment.id,
  bookingId: payment.booking.id,
  code: payment.booking.code,
  customer: payment.booking.user.name,
  // แถวคืนเงินแสดงยอดที่ต้องโอนคืนจริง ส่วนแถวสลิปไม่มี refundAmount จึงเป็นยอดที่โอนเข้ามา
  amount: payment.refundAmount ?? payment.amount,
  status: payment.status,
});

/** สรุปภาพรวมหน้าแรกของ admin */
export const getOverview = async () => {
  const today = bangkokDayRange(bangkokDateKey(new Date()));

  const [
    paidToday,
    pendingSlips,
    showtimesToday,
    activeHolds,
    pendingRefunds,
    recentSlips,
    recentRefunds,
  ] = await Promise.all([
    prisma.booking.findMany({
      where: { status: PAID, paidAt: { gte: today.start, lt: today.end } },
      select: { totalAmount: true, seatSnapshot: true },
    }),
    prisma.payment.count({ where: PENDING_SLIP_WHERE }),
    prisma.showtime.count({
      where: { status: 'SCHEDULED', startsAt: { gte: today.start, lt: today.end } },
    }),
    prisma.booking.count({ where: { status: { in: ['PENDING_PAYMENT', 'PENDING_VERIFICATION'] } } }),
    // การจองที่จ่ายเงินแล้วแต่ถูกยกเลิก ยังต้องโอนเงินคืนลูกค้า
    prisma.payment.count({ where: PENDING_REFUND_WHERE }),
    // enum ใน Postgres เรียงตามลำดับที่ประกาศ เรียง status ก่อนจึงได้ใบที่รอตรวจขึ้นบนสุด
    prisma.payment.findMany({
      where: { OR: [PENDING_SLIP_WHERE, { status: { in: ['APPROVED', 'REJECTED'] } }] },
      orderBy: [{ status: 'asc' }, { slipUploadedAt: 'desc' }],
      take: 5,
      select: QUEUE_ROW_SELECT,
    }),
    prisma.payment.findMany({
      where: { status: { in: ['REFUND_PENDING', 'REFUNDED'] } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
      select: QUEUE_ROW_SELECT,
    }),
  ]);

  const ticketsToday = paidToday.reduce(
    (sum, booking) => sum + (Array.isArray(booking.seatSnapshot) ? booking.seatSnapshot.length : 0),
    0,
  );

  return {
    date: bangkokDateKey(new Date()),
    revenueToday: paidToday.reduce((sum, b) => sum + b.totalAmount, 0),
    bookingsToday: paidToday.length,
    ticketsToday,
    pendingSlips,
    showtimesToday,
    activeHolds,
    pendingRefunds,
    recentSlips: recentSlips.map(toQueueRow),
    recentRefunds: recentRefunds.map(toQueueRow),
  };
};

/**
 * รายงานยอดขาย — นับเฉพาะการจองที่ชำระเงินแล้ว (สถานะ PAID)
 * groupBy: 'day' | 'movie' | 'theatre'
 */
export const getSalesReport = async ({ from, to, groupBy = 'day' } = {}) => {
  const start = from ? bangkokDayRange(from)?.start : undefined;
  const end = to ? bangkokDayRange(to)?.end : undefined;

  const bookings = await prisma.booking.findMany({
    where: {
      status: PAID,
      ...(start || end ? { paidAt: { ...(start && { gte: start }), ...(end && { lt: end }) } } : {}),
    },
    include: {
      showtime: {
        include: {
          movie: { select: { id: true, titleTh: true, titleEn: true } },
          theatre: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { paidAt: 'asc' },
  });

  const groups = new Map();
  for (const booking of bookings) {
    const seatCount = Array.isArray(booking.seatSnapshot) ? booking.seatSnapshot.length : 0;
    let key;
    let label;

    if (groupBy === 'movie') {
      key = booking.showtime.movie.id;
      label = booking.showtime.movie.titleTh;
    } else if (groupBy === 'theatre') {
      key = booking.showtime.theatre.id;
      label = booking.showtime.theatre.name;
    } else {
      key = bangkokDateKey(booking.paidAt ?? booking.createdAt);
      label = key;
    }

    const current = groups.get(key) ?? {
      key,
      label,
      labelEn: groupBy === 'movie' ? booking.showtime.movie.titleEn : label,
      bookings: 0,
      tickets: 0,
      revenue: 0,
    };
    current.bookings += 1;
    current.tickets += seatCount;
    current.revenue += booking.totalAmount;
    groups.set(key, current);
  }

  const rows = [...groups.values()].sort((a, b) =>
    groupBy === 'day' ? a.key.localeCompare(b.key) : b.revenue - a.revenue,
  );

  // เงินที่ต้องคืน/คืนแล้วในช่วงเวลาเดียวกัน — ยกเลิกหลังจ่าย ยกเลิกทั้งรอบ หรือโอนมาหลังหมดเวลา
  // เดิมรายได้จะหายไปจากรายงานเงียบ ๆ ทำให้ตัวเลขไม่ตรงกับเงินที่อยู่ในบัญชีจริง
  // นับตามวันที่เข้าคิวคืนเงิน (refundDueAt) ไม่ใช่วันยกเลิก เพราะสลิปที่โอนมาหลังหมดเวลาไม่มีวันยกเลิก
  const refundPayments = await prisma.payment.findMany({
    where: {
      status: { in: ['REFUND_PENDING', 'REFUNDED'] },
      ...(start || end
        ? { refundDueAt: { ...(start && { gte: start }), ...(end && { lt: end }) } }
        : {}),
    },
    select: { amount: true, refundAmount: true, status: true },
  });
  // ยอดที่โอนคืนจริง — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
  const refundOf = (p) => p.refundAmount ?? p.amount;

  const refunds = {
    count: refundPayments.length,
    amount: refundPayments.reduce((sum, p) => sum + refundOf(p), 0),
    pendingCount: refundPayments.filter((p) => p.status === 'REFUND_PENDING').length,
    pendingAmount: refundPayments
      .filter((p) => p.status === 'REFUND_PENDING')
      .reduce((sum, p) => sum + refundOf(p), 0),
  };

  return {
    groupBy,
    from: from ?? null,
    to: to ?? null,
    rows,
    refunds,
    totals: rows.reduce(
      (acc, row) => ({
        bookings: acc.bookings + row.bookings,
        tickets: acc.tickets + row.tickets,
        revenue: acc.revenue + row.revenue,
      }),
      { bookings: 0, tickets: 0, revenue: 0 },
    ),
  };
};

/**
 * อัตราการเต็มของแต่ละรอบฉาย (ที่นั่งที่ถูกยึด ÷ ที่นั่งที่เปิดขาย)
 * นับชุดเดียวกับจำนวนว่างในรายการรอบฉาย รอบที่ขายหมดจึงเป็น 100% แม้โรงจะมีที่นั่งที่ปิดใช้งานอยู่
 */
export const getOccupancyReport = async ({ from, to } = {}) => {
  const start = from ? bangkokDayRange(from)?.start : new Date();
  const end = to ? bangkokDayRange(to)?.end : undefined;

  const showtimes = await prisma.showtime.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { ...(start && { gte: start }), ...(end && { lt: end }) },
    },
    orderBy: { startsAt: 'asc' },
    take: 200,
    include: {
      movie: { select: { titleTh: true, titleEn: true } },
      theatre: { select: { name: true, _count: { select: SELLABLE_SEAT_COUNTS.theatreSeats } } },
      _count: { select: SELLABLE_SEAT_COUNTS.bookingSeats },
    },
  });

  return showtimes.map((s) => {
    const total = s.theatre._count.seats;
    const sold = s._count.bookingSeats;
    return {
      showtimeId: s.id,
      startsAt: s.startsAt,
      movie: s.movie,
      theatre: s.theatre.name,
      totalSeats: total,
      soldSeats: sold,
      occupancy: total > 0 ? Math.round((sold / total) * 100) : 0,
    };
  });
};

export const salesReportToCsv = (report) => {
  const header = ['key', 'label', 'bookings', 'tickets', 'revenue_baht'];
  const lines = report.rows.map((row) =>
    [row.key, `"${String(row.label).replace(/"/g, '""')}"`, row.bookings, row.tickets, row.revenue].join(','),
  );
  const totals = ['TOTAL', '""', report.totals.bookings, report.totals.tickets, report.totals.revenue].join(',');
  // BOM ให้ Excel อ่านภาษาไทยถูก
  return `﻿${[header.join(','), ...lines, totals].join('\r\n')}\r\n`;
};
