import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { releaseExpiredHolds } from '../../src/services/bookings.js';
import {
  approvePayment,
  getPaymentForBooking,
  listPayments,
  rejectPayment,
  uploadSlip,
} from '../../src/services/payments.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
  bookingOf,
  createAdmin,
  createShowtimeFixture,
  createUser,
  fileExists,
  makeSlipFile,
  minutesFromNow,
  paymentOf,
  submitSlip,
} from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

/** ทำให้การจองหมดเวลาด้วย job จริง */
const expireNow = async (booking) => {
  await prisma.booking.update({
    where: { id: booking.id },
    data: { holdExpiresAt: minutesFromNow(-1) },
  });
  assert.equal(await releaseExpiredHolds(), 1);
};

describe('ส่งสลิปหลังหมดเวลา (โอนแล้วแต่ส่งหลักฐานไม่ทัน)', () => {
  test('ที่นั่งยังว่าง — ได้ที่นั่งเดิมคืน แล้วเข้าคิวตรวจตามปกติ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0], seats[1]] });
    await expireNow(booking);

    const view = await getPaymentForBooking({ bookingId: booking.id, userId: user.id });
    assert.equal(view.canUploadSlip, true);
    assert.ok(view.lateSlipUntil > new Date());

    await submitSlip(booking, user);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 2);

    const payment = await paymentOf(booking.id);
    const approved = await approvePayment({ paymentId: payment.id, adminId: admin.id });
    assert.equal(approved.status, 'PAID');
  });

  test('ที่นั่งถูกคนอื่นจองไปแล้ว — สลิปยังเข้าคิวตรวจ อนุมัติแล้วเข้าคิวคืนเงิน (ไม่ออกตั๋ว)', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, late, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const booking = await book({ user: late, showtime, seats: [seats[0]] });
    await expireNow(booking);
    const otherBooking = await book({ user: other, showtime, seats: [seats[0]] });

    await submitSlip(booking, late);

    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    const payment = await paymentOf(booking.id);
    assert.equal(payment.status, 'PENDING_VERIFICATION');
    const queue = await listPayments();
    assert.ok(
      queue.items.some((item) => item.id === payment.id && item.booking.status === 'EXPIRED'),
      'ต้องโผล่ในคิวตรวจสลิป พร้อมบอกว่าเป็นการจองที่หมดเวลาแล้ว',
    );

    await approvePayment({ paymentId: payment.id, adminId: admin.id });
    const after = await paymentOf(booking.id);
    assert.equal(after.status, 'REFUND_PENDING');
    assert.ok(after.refundDueAt);
    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    assert.equal(await prisma.notification.count({ where: { type: 'LATE_PAYMENT_REFUND' } }), 1);

    // การจองของอีกคนต้องไม่โดนแตะ
    assert.equal((await bookingOf(otherBooking.id)).status, 'PENDING_PAYMENT');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: otherBooking.id } }), 1);
  });

  test('ปฏิเสธสลิปที่ส่งหลังหมดเวลา — ปิดจบ ไม่เปิดให้จ่ายใหม่', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, late, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const booking = await book({ user: late, showtime, seats: [seats[0]] });
    await expireNow(booking);
    await book({ user: other, showtime, seats: [seats[0]] });
    await submitSlip(booking, late);

    const payment = await paymentOf(booking.id);
    await rejectPayment({ paymentId: payment.id, adminId: admin.id, reason: 'ไม่พบยอดโอน' });

    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    assert.equal((await paymentOf(booking.id)).status, 'REJECTED');
    const note = await prisma.notification.findFirst({ where: { type: 'PAYMENT_REJECTED' } });
    assert.match(note.bodyTh, /ปิดแล้ว/);
  });

  test('เลยช่วงผ่อนผันแล้ว — ส่งไม่ได้ และไฟล์ที่อัปโหลดมาถูกลบทิ้ง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await expireNow(booking);
    await prisma.booking.update({ where: { id: booking.id }, data: { expiredAt: minutesFromNow(-31) } });

    const view = await getPaymentForBooking({ bookingId: booking.id, userId: user.id });
    assert.equal(view.canUploadSlip, false);

    const file = await makeSlipFile();
    await assert.rejects(
      uploadSlip({ bookingId: booking.id, userId: user.id, file }),
      apiErrorWith('HOLD_EXPIRED', 409),
    );
    assert.equal(await fileExists(file.path), false);
  });

  test('เลยกำหนดแล้วแต่ job ยังไม่ปล่อยที่นั่ง — รับสลิปตามปกติ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: minutesFromNow(-1) } });

    await submitSlip(booking, user);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
    assert.equal(await releaseExpiredHolds(), 0, 'job ต้องไม่ทับการจองที่ส่งสลิปแล้ว');
  });

  test('ส่งสลิปพร้อมกับที่ job กำลังปล่อยที่นั่ง — ลูกค้าไม่เห็น error และยังได้ที่นั่งเดิม', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    for (let i = 0; i < 5; i += 1) {
      const user = await createUser();
      const booking = await book({ user, showtime, seats: [seats[i]] });
      await prisma.booking.update({
        where: { id: booking.id },
        data: { holdExpiresAt: minutesFromNow(-1) },
      });

      const [, upload] = await Promise.allSettled([releaseExpiredHolds(), submitSlip(booking, user)]);

      assert.equal(upload.status, 'fulfilled', upload.reason?.message);
      assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
      assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 1);
    }
  });
});

describe('ปฏิเสธสลิปหลังรอบเริ่มฉาย', () => {
  test('ปิดการจองและปล่อยที่นั่ง ไม่เปิดให้จ่ายใหม่ — แต่ยังส่งสลิปที่ถูกต้องเพื่อขอเงินคืนได้', async () => {
    const { showtime, seats } = await createShowtimeFixture({ startsAt: minutesFromNow(60) });
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);
    // รอบเริ่มฉายไปแล้วระหว่างที่สลิปรอตรวจ
    await prisma.showtime.update({
      where: { id: showtime.id },
      data: { startsAt: minutesFromNow(-5), endsAt: minutesFromNow(115) },
    });

    const payment = await paymentOf(booking.id);
    const rejected = await rejectPayment({
      paymentId: payment.id,
      adminId: admin.id,
      reason: 'ยอดไม่ตรง',
    });

    assert.equal(rejected.status, 'EXPIRED');
    assert.equal(rejected.holdExpiresAt, null, 'ต้องไม่ได้เวลาจ่ายใหม่');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 0);
    const note = await prisma.notification.findFirst({ where: { type: 'PAYMENT_REJECTED' } });
    assert.match(note.bodyTh, /ปิดแล้ว/);

    // ลูกค้าโอนจริงแต่แนบรูปผิด — ส่งใหม่ได้ รอบเริ่มแล้วจึงไม่ได้ที่นั่ง อนุมัติแล้วเข้าคิวคืนเงิน
    await submitSlip(booking, user);
    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    await approvePayment({ paymentId: payment.id, adminId: admin.id });
    assert.equal((await paymentOf(booking.id)).status, 'REFUND_PENDING');
  });
});
