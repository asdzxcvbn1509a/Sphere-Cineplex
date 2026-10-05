import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import prisma from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { updateProfile } from '../../src/services/auth.js';
import { cancelBooking, listAllBookings, releaseExpiredHolds } from '../../src/services/bookings.js';
import { approvePayment, completeRefund, rejectPayment } from '../../src/services/payments.js';
import { getReceipt, issueReceiptNo } from '../../src/services/receipts.js';
import { bahtText } from '../../src/utils/bahtText.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { formatReceiptNo, receiptYear } from '../../src/utils/receipt.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
  bookingOf,
  createAdmin,
  createPaidBooking,
  createShowtimeFixture,
  createUser,
  makeSlipFile,
  minutesFromNow,
  paymentOf,
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

/** เลขที่ใบเสร็จที่ควรได้ — ปีคิดจากเวลาที่จ่ายจริง เทสต์จะได้ไม่พังตอนรันคร่อมเที่ยงคืนวันขึ้นปีใหม่ */
const receiptNoFor = (paidAt, sequence) => formatReceiptNo(receiptYear(paidAt), sequence);

const approve = async (booking, admin) => {
  const payment = await paymentOf(booking.id);
  return approvePayment({ paymentId: payment.id, adminId: admin.id });
};

/** ทำให้การจองหมดเวลาด้วย job จริง (แบบเดียวกับ late-slip.test.js) */
const expireNow = async (booking) => {
  await prisma.booking.update({
    where: { id: booking.id },
    data: { holdExpiresAt: minutesFromNow(-1) },
  });
  assert.equal(await releaseExpiredHolds(), 1);
};

describe('ออกเลขที่ใบเสร็จตอนอนุมัติสลิป', () => {
  test('ได้เลขเรียงกันตามลำดับการอนุมัติ เก็บชื่อผู้จ่ายไว้ และแจ้งเตือนบอกเลขที่ใบเสร็จ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);

    const first = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const second = await createPaidBooking({ user, admin, showtime, seats: [seats[1]] });

    assert.equal(first.payment.receiptNo, receiptNoFor(first.paidAt, 1));
    assert.equal(second.payment.receiptNo, receiptNoFor(second.paidAt, 2));
    assert.equal((await paymentOf(first.id)).receiptName, user.name);

    const counter = await prisma.receiptCounter.findUnique({ where: { year: receiptYear(second.paidAt) } });
    assert.equal(counter.lastNo, 2);

    const bodies = (await prisma.notification.findMany({ where: { type: 'PAYMENT_APPROVED' } })).map(
      (notification) => notification.bodyTh,
    );
    assert.ok(bodies.some((body) => body.includes(first.payment.receiptNo)));
    assert.ok(bodies.some((body) => body.includes(second.payment.receiptNo)));
  });

  test('อนุมัติหลายใบพร้อมกัน — เลขไม่ซ้ำ ไม่ข้าม', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const admin = await createAdmin();
    const users = await Promise.all(Array.from({ length: 5 }, () => createUser()));

    const bookings = [];
    for (const [index, user] of users.entries()) {
      const booking = await book({ user, showtime, seats: [seats[index]] });
      await submitSlip(booking, user);
      bookings.push(booking);
    }
    await Promise.all(bookings.map((booking) => approve(booking, admin)));

    const { paidAt } = await bookingOf(bookings[0].id);
    const numbers = (await prisma.payment.findMany({ select: { receiptNo: true } }))
      .map((payment) => payment.receiptNo)
      .sort();
    assert.deepEqual(
      numbers,
      [1, 2, 3, 4, 5].map((sequence) => receiptNoFor(paidAt, sequence)),
    );
  });

  test('transaction ที่ล้มหลังออกเลข — เลขนั้นถูกคืน ใบถัดไปได้เลขเดิม (เลขไม่ข้าม)', async () => {
    const at = new Date();
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await issueReceiptNo(tx, at);
        throw new Error('rollback');
      }),
      /rollback/,
    );

    assert.equal(await issueReceiptNo(prisma, at), receiptNoFor(at, 1));
  });

  test('ผู้ดูแลสองคนกดอนุมัติใบเดียวกันพร้อมกัน — ได้ใบเสร็จใบเดียว ตัวนับไม่กระโดด', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [adminA, adminB, user] = await Promise.all([createAdmin(), createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);
    const payment = await paymentOf(booking.id);

    const results = await Promise.allSettled([
      approvePayment({ paymentId: payment.id, adminId: adminA.id }),
      approvePayment({ paymentId: payment.id, adminId: adminB.id }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);

    const { paidAt } = await bookingOf(booking.id);
    assert.equal((await paymentOf(booking.id)).receiptNo, receiptNoFor(paidAt, 1));
    assert.equal((await prisma.receiptCounter.findFirst()).lastNo, 1);
  });

  test('สลิปที่ส่งหลังหมดเวลาและที่นั่งไม่ว่างแล้ว — อนุมัติแล้วเข้าคิวคืนเงิน ไม่มีใบเสร็จ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, late, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const booking = await book({ user: late, showtime, seats: [seats[0]] });
    await expireNow(booking);
    await book({ user: other, showtime, seats: [seats[0]] });
    await submitSlip(booking, late);

    await approve(booking, admin);

    const payment = await paymentOf(booking.id);
    assert.equal(payment.status, 'REFUND_PENDING');
    assert.equal(payment.receiptNo, null);
    assert.equal(await prisma.receiptCounter.count(), 0);
    await assert.rejects(
      getReceipt({ bookingId: booking.id, requester: late }),
      apiErrorWith('RECEIPT_NOT_READY', 403),
    );
  });

  test('สลิปที่ถูกปฏิเสธไม่มีใบเสร็จ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);
    const payment = await paymentOf(booking.id);

    await rejectPayment({ paymentId: payment.id, adminId: admin.id, reason: 'ยอดไม่ตรง' });

    assert.equal((await paymentOf(booking.id)).receiptNo, null);
    await assert.rejects(
      getReceipt({ bookingId: booking.id, requester: user }),
      apiErrorWith('RECEIPT_NOT_READY', 403),
    );
  });
});

describe('เปิดดูใบเสร็จ', () => {
  test('เจ้าของเปิดดูได้ — แยกรายการตามโซน ยอดรวมและจำนวนเงินเป็นตัวอักษรถูกต้อง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    // A1 = ธรรมดา 200 · B1, B2 = พรีเมียม 280 (ราคาฐาน 200 ของ fixture)
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[4], seats[5]] });

    const receipt = await getReceipt({ bookingId: paid.id, requester: user });

    assert.equal(receipt.receiptNo, paid.payment.receiptNo);
    assert.deepEqual(receipt.issuedAt, paid.paidAt);
    assert.deepEqual(receipt.lines, [
      { kind: 'SEATS', zone: 'NORMAL', unitPrice: 200, quantity: 1, amount: 200, seats: ['A1'] },
      { kind: 'SEATS', zone: 'PREMIUM', unitPrice: 280, quantity: 2, amount: 560, seats: ['B1', 'B2'] },
    ]);
    assert.equal(receipt.totalAmount, 760);
    assert.equal(receipt.amountTextTh, bahtText(760));
    assert.equal(receipt.issuer.name, env.RECEIPT_ISSUER_NAME);
    assert.equal(receipt.customer.name, user.name);
    assert.equal(receipt.booking.code, paid.code);
    assert.equal(receipt.booking.userId, user.id);
    assert.equal(receipt.payment.reference, paid.payment.reference);
    assert.equal(receipt.refund, null);
  });

  test('ผู้ใช้เปลี่ยนชื่อหลังจ่ายเงิน — ใบเสร็จที่ออกไปแล้วยังเป็นชื่อตอนจ่าย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await updateProfile(user.id, { name: 'ชื่อใหม่หลังจ่ายเงิน' });

    const receipt = await getReceipt({ bookingId: paid.id, requester: user });
    assert.equal(receipt.customer.name, user.name);
  });

  test('คนอื่นเปิดไม่ได้ · ผู้ดูแลเปิดได้ทุกใบ · ใบที่ยังไม่จ่ายยังไม่มีใบเสร็จ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await assert.rejects(
      getReceipt({ bookingId: paid.id, requester: other }),
      apiErrorWith('NOT_BOOKING_OWNER', 403),
    );
    const asAdmin = await getReceipt({ bookingId: paid.id, requester: admin });
    assert.equal(asAdmin.receiptNo, paid.payment.receiptNo);
    await assert.rejects(
      getReceipt({ bookingId: 'no-such-booking', requester: admin }),
      apiErrorWith('BOOKING_NOT_FOUND', 404),
    );

    const unpaid = await book({ user, showtime, seats: [seats[1]] });
    await assert.rejects(
      getReceipt({ bookingId: unpaid.id, requester: user }),
      apiErrorWith('RECEIPT_NOT_READY', 403),
    );
  });

  test('ยกเลิกหลังจ่ายเงิน — ใบเสร็จยังเปิดได้ บอกสถานะคืนเงิน และเลขที่เดิมไม่เปลี่ยน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await cancelBooking({ bookingId: paid.id, byAdmin: true });

    const pending = await getReceipt({ bookingId: paid.id, requester: user });
    assert.equal(pending.booking.status, 'CANCELLED');
    assert.deepEqual(pending.refund, { status: 'REFUND_PENDING', refundedAt: null });

    const payment = await paymentOf(paid.id);
    await completeRefund({
      paymentId: payment.id,
      adminId: admin.id,
      file: await makeSlipFile({ kind: 'refund' }),
    });

    const refunded = await getReceipt({ bookingId: paid.id, requester: user });
    assert.equal(refunded.refund.status, 'REFUNDED');
    assert.ok(refunded.refund.refundedAt instanceof Date);
    assert.equal(refunded.receiptNo, paid.payment.receiptNo);
  });

  test('ผู้ดูแลค้นการจองด้วยเลขที่ใบเสร็จได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await createPaidBooking({ user: other, admin, showtime, seats: [seats[1]] });

    const result = await listAllBookings({ q: paid.payment.receiptNo });

    assert.deepEqual(
      result.items.map((booking) => booking.id),
      [paid.id],
    );
    assert.equal(result.items[0].payment.receiptNo, paid.payment.receiptNo);
  });
});

describe('GET /api/bookings/:id/receipt', () => {
  test('เจ้าของและผู้ดูแลได้ 200 · คนอื่นได้ 403 · ไม่มี token ได้ 401', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    const getAs = (account) =>
      fetch(`${base}/api/bookings/${paid.id}/receipt`, {
        headers: account ? { Authorization: `Bearer ${signAccessToken(account)}` } : {},
      });

    const own = await getAs(user);
    assert.equal(own.status, 200);
    assert.equal((await own.json()).receipt.receiptNo, paid.payment.receiptNo);

    assert.equal((await getAs(admin)).status, 200);

    const stranger = await getAs(other);
    assert.equal(stranger.status, 403);
    assert.equal((await stranger.json()).error.code, 'NOT_BOOKING_OWNER');

    assert.equal((await getAs(null)).status, 401);
  });
});
