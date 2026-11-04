import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import prisma from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';
import { cancelBooking, listAllBookings, releaseExpiredHolds } from '../../src/services/bookings.js';
import { completeRefund } from '../../src/services/payments.js';
import { requestSeatChange, uploadSeatChangeSlip } from '../../src/services/seatChanges.js';
import { DISPLAY_STATUSES } from '../../src/utils/bookingDisplayStatus.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  book,
  createAdmin,
  createPaidBooking,
  createShowtimeFixture,
  createSmallTheatre,
  createUser,
  makeSlipFile,
  minutesFromNow,
  paymentOf,
  paymentOfSeatChange,
  submitSlip,
} from '../helpers/fixtures.js';

let server;
let base;

before(async () => {
  setupDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(resetDb);
after(async () => {
  server.close();
  await disconnectDb();
});

const REFUND_ACCOUNT = { bankName: 'ธนาคารกสิกรไทย', accountNo: '1234567890', accountName: 'สมหมาย ใจดี' };

const sorted = (ids) => [...ids].sort();
const idsOf = (result) => sorted(result.items.map((item) => item.id));

/**
 * การจองอย่างน้อยหนึ่งใบต่อหนึ่งป้าย ทำผ่าน service จริงทั้งหมด ยกเว้นสลิปที่ส่งหลังหมดเวลาที่ตั้งสถานะเงินเอง
 * คืน expected = { [ป้ายที่ควรได้]: [bookingId...] } · คืนเงินสำเร็จมีสองใบ: คืนส่วนต่าง (ยัง PAID) กับยกเลิกแล้วคืน
 * โรง 3 แถว × 10 ที่: A1–A10 ธรรมดา 200 · B1–B10 พรีเมียม 280 — ลูกค้าคนละบัญชีทุกใบ ไม่ชนเพดานกักที่นั่งต่อคน
 */
const buildEveryStatus = async () => {
  const theatre = await createSmallTheatre({ rowsCount: 3, colsCount: 10 });
  const { showtime, seats } = await createShowtimeFixture({ theatre });
  const admin = await createAdmin();
  const A = (number) => seats[number - 1];
  const B = (number) => seats[9 + number];

  const expected = Object.fromEntries(DISPLAY_STATUSES.map((status) => [status, []]));
  const add = (status, booking) => expected[status].push(booking.id);
  const paidOn = async (seat) => {
    const user = await createUser();
    return { user, booking: await createPaidBooking({ user, admin, showtime, seats: [seat] }) };
  };
  const refundSlip = () => makeSlipFile({ kind: 'refund' });

  add('PENDING_PAYMENT', await book({ user: await createUser(), showtime, seats: [A(1)] }));

  {
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [A(2)] });
    await submitSlip(booking, user);
    add('PENDING_VERIFICATION', booking);
  }

  add('PAID', (await paidOn(A(3))).booking);

  // ขอย้ายไปที่แพงกว่า — ยังไม่โอนส่วนต่าง
  {
    const { user, booking } = await paidOn(A(4));
    await requestSeatChange({ bookingId: booking.id, userId: user.id, seatIds: [B(1).id] });
    add('TOPUP_PENDING_PAYMENT', booking);
  }

  // โอนส่วนต่างแล้ว สลิปรอผู้ดูแลตรวจ
  {
    const { user, booking } = await paidOn(A(5));
    const { seatChange } = await requestSeatChange({
      bookingId: booking.id,
      userId: user.id,
      seatIds: [B(2).id],
    });
    await uploadSeatChangeSlip({ seatChangeId: seatChange.id, userId: user.id, file: await makeSlipFile() });
    add('TOPUP_PENDING_VERIFICATION', booking);
  }

  // ย้ายไปที่ถูกกว่า — ส่วนต่างรอโอนคืน แล้วอีกใบโอนคืนไปแล้ว (การจองยังใช้ได้ทั้งคู่)
  const moveCheaper = async (from, to) => {
    const { user, booking } = await paidOn(from);
    const { seatChange } = await requestSeatChange({
      bookingId: booking.id,
      userId: user.id,
      seatIds: [to.id],
      refundAccount: REFUND_ACCOUNT,
    });
    return { booking, refund: await paymentOfSeatChange(seatChange.id) };
  };
  add('DIFF_REFUND_PENDING', (await moveCheaper(B(3), A(6))).booking);
  const diffRefunded = await moveCheaper(B(4), A(7));
  await completeRefund({ paymentId: diffRefunded.refund.id, adminId: admin.id, file: await refundSlip() });
  add('REFUNDED', diffRefunded.booking);

  // ผู้ดูแลยกเลิกใบที่จ่ายแล้ว — รอโอนคืน แล้วอีกใบโอนคืนไปแล้ว
  {
    const { booking } = await paidOn(A(8));
    await cancelBooking({ bookingId: booking.id, byAdmin: true });
    add('CANCELLED_REFUND_PENDING', booking);
  }
  const cancelledRefunded = (await paidOn(A(9))).booking;
  await cancelBooking({ bookingId: cancelledRefunded.id, byAdmin: true });
  await completeRefund({
    paymentId: (await paymentOf(cancelledRefunded.id)).id,
    adminId: admin.id,
    file: await refundSlip(),
  });
  add('REFUNDED', cancelledRefunded);

  // ลูกค้ายกเลิกเองก่อนจ่าย — ไม่มีเงินค้าง
  {
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [A(10)] });
    await cancelBooking({ bookingId: booking.id, userId: user.id });
    add('CANCELLED', booking);
  }

  // หมดเวลาชำระสามใบด้วย job จริง แล้วตั้งสถานะเงินสองใบให้เป็นทางของสลิปที่ส่งหลังหมดเวลา
  const unpaid = [];
  for (const seat of [B(5), B(6), B(7)]) {
    const booking = await book({ user: await createUser(), showtime, seats: [seat] });
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: minutesFromNow(-1) } });
    unpaid.push(booking);
  }
  assert.equal(await releaseExpiredHolds(), 3);
  const [expired, lateSlip, lateRefund] = unpaid;
  add('EXPIRED', expired);
  // ส่งสลิปหลังหมดเวลา ยังรอผู้ดูแลตรวจ
  await prisma.payment.update({
    where: { mainBookingId: lateSlip.id },
    data: { status: 'PENDING_VERIFICATION', slipUploadedAt: new Date() },
  });
  add('PENDING_VERIFICATION', lateSlip);
  // ยืนยันยอดแล้วแต่ที่นั่งไม่ว่างแล้ว — ต้องโอนคืน
  await prisma.payment.update({
    where: { mainBookingId: lateRefund.id },
    data: { status: 'REFUND_PENDING', refundDueAt: new Date(), refundAmount: lateRefund.totalAmount },
  });
  add('EXPIRED_REFUND_PENDING', lateRefund);

  return { expected, diffRefunded: diffRefunded.booking, cancelledRefunded };
};

describe('ป้ายสถานะในหน้าการจองของผู้ดูแล (displayStatus)', () => {
  test('ทุกใบได้ป้ายตามเรื่องเงินที่ค้างจริง และกรองแต่ละป้ายได้ใบชุดเดียวกับที่ป้ายบอก', async () => {
    const { expected, diffRefunded, cancelledRefunded } = await buildEveryStatus();
    // ทุกป้ายมีตัวอย่าง — เพิ่มป้ายใหม่แล้วลืมสร้างข้อมูลทดสอบ เทสต์นี้จะเตือน
    for (const status of DISPLAY_STATUSES) assert.ok(expected[status].length > 0, `ไม่มีตัวอย่างของ ${status}`);

    const all = await listAllBookings({ pageSize: 100 });
    const labelOf = Object.fromEntries(all.items.map((item) => [item.id, item.displayStatus]));
    for (const [status, ids] of Object.entries(expected)) {
      for (const id of ids) assert.equal(labelOf[id], status, `การจอง ${id} ควรได้ป้าย ${status}`);
    }
    assert.equal(all.total, Object.values(expected).flat().length);

    // เงื่อนไขกรองในฐานข้อมูลต้องตรงกับป้ายที่คิดจากแถว — ได้ครบทุกใบของป้ายนั้น และไม่มีใบป้ายอื่นปน
    for (const status of DISPLAY_STATUSES) {
      const filtered = await listAllBookings({ displayStatus: status, pageSize: 100 });
      assert.deepEqual(idsOf(filtered), sorted(expected[status]), `กรอง ${status}`);
      assert.equal(filtered.total, expected[status].length);
      assert.ok(filtered.items.every((item) => item.displayStatus === status));
    }

    // หลายป้ายในคำขอเดียว (กลุ่ม "รอดำเนินการ" ของตัวกรองหน้าการจอง) — ได้ใบของทุกป้ายรวมกันพอดี
    const inProgress = [
      'PENDING_VERIFICATION',
      'TOPUP_PENDING_VERIFICATION',
      'DIFF_REFUND_PENDING',
      'CANCELLED_REFUND_PENDING',
      'EXPIRED_REFUND_PENDING',
    ];
    const grouped = await listAllBookings({ displayStatus: inProgress, pageSize: 100 });
    assert.deepEqual(idsOf(grouped), sorted(inProgress.flatMap((status) => expected[status])));
    assert.ok(grouped.items.every((item) => inProgress.includes(item.displayStatus)));

    // status เดิมยังหมายถึงสถานะของการจอง — ใบที่จ่ายแล้วทุกใบ ไม่ว่าป้ายจะเป็นอะไร
    const paidIds = [
      ...expected.PAID,
      ...expected.TOPUP_PENDING_PAYMENT,
      ...expected.TOPUP_PENDING_VERIFICATION,
      ...expected.DIFF_REFUND_PENDING,
      diffRefunded.id,
    ];
    assert.deepEqual(idsOf(await listAllBookings({ status: 'PAID', pageSize: 100 })), sorted(paidIds));

    // ใช้คู่กับตัวกรองอื่นได้ (AND) — คำค้นที่มี OR ของตัวเองต้องไม่ไปลบล้างเงื่อนไขของป้าย
    assert.deepEqual(
      idsOf(await listAllBookings({ displayStatus: 'REFUNDED', q: diffRefunded.code })),
      [diffRefunded.id],
    );
    assert.equal((await listAllBookings({ displayStatus: 'PAID', q: diffRefunded.code })).total, 0);
    assert.deepEqual(
      idsOf(await listAllBookings({ displayStatus: ['PAID', 'REFUNDED'], q: diffRefunded.code })),
      [diffRefunded.id],
    );
    assert.deepEqual(
      idsOf(await listAllBookings({ status: 'CANCELLED', displayStatus: 'REFUNDED' })),
      [cancelledRefunded.id],
    );
  });

  test('HTTP: displayStatus ที่ไม่รู้จักได้ 422 · หลายค่าคั่นด้วยจุลภาคได้ · ป้ายติดมากับทุกแถว', async () => {
    const admin = await createAdmin();
    const { showtime, seats } = await createShowtimeFixture();
    const booking = await book({ user: await createUser(), showtime, seats: [seats[0]] });
    const get = (query) =>
      fetch(`${base}/api/admin/bookings?${query}`, {
        headers: { Authorization: `Bearer ${signAccessToken(admin)}` },
      });

    assert.equal((await get('displayStatus=NOPE')).status, 422);

    const res = await get('displayStatus=PENDING_PAYMENT');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.bookings.map((item) => [item.id, item.displayStatus]),
      [[booking.id, 'PENDING_PAYMENT']],
    );
    assert.equal((await (await get('displayStatus=PAID')).json()).total, 0);

    // กลุ่มในตัวกรอง — ตรงป้ายใดป้ายหนึ่งก็ได้ แต่มีค่าที่ไม่รู้จักแม้ตัวเดียวทั้งคำขอได้ 422
    const grouped = await (await get('displayStatus=PAID,PENDING_PAYMENT')).json();
    assert.deepEqual(grouped.bookings.map((item) => item.id), [booking.id]);
    assert.equal((await get('displayStatus=PAID,NOPE')).status, 422);
  });
});
