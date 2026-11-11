import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { getBookingById, releaseExpiredHolds } from '../../src/services/bookings.js';
import { getPaymentForBooking, rejectPayment, uploadSlip } from '../../src/services/payments.js';
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

/** เลื่อนเส้นตายของการจองไปในอดีต (job ยังไม่ได้ทำงาน) */
const passDeadline = (booking) => {
  return prisma.booking.update({
    where: { id: booking.id },
    data: { holdExpiresAt: minutesFromNow(-1) },
  });
};

/** 409 HOLD_EXPIRED ที่บอกรหัสการจองไว้ให้ลูกค้าติดต่อเจ้าหน้าที่ */
const holdExpired = (booking) => (error) => {
  apiErrorWith('HOLD_EXPIRED', 409)(error);
  assert.ok(error.message.includes(booking.code), 'ข้อความต้องมีรหัสการจองไว้ติดต่อเจ้าหน้าที่');
  return true;
};

describe('ไม่มีการโอนหลังหมดเวลา', () => {
  test('หมดเวลาแล้ว — ส่งสลิปไม่ได้ และไฟล์ที่อัปโหลดมาถูกลบทิ้ง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await passDeadline(booking);
    assert.equal(await releaseExpiredHolds(), 1);

    const view = await getPaymentForBooking({ bookingId: booking.id, userId: user.id });
    assert.equal(view.canUploadSlip, false);
    assert.equal((await getBookingById(booking.id)).canUploadSlip, false);

    const file = await makeSlipFile();
    await assert.rejects(uploadSlip({ bookingId: booking.id, userId: user.id, file }), holdExpired(booking));
    assert.equal(await fileExists(file.path), false);
    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    assert.equal((await paymentOf(booking.id)).status, 'REJECTED');
  });

  test('เลยกำหนดแล้วแต่ job ยังไม่ปล่อยที่นั่ง — รับสลิปตามปกติ (ที่นั่งยังเป็นของคนนี้)', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await passDeadline(booking);

    await submitSlip(booking, user);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
    assert.equal(await releaseExpiredHolds(), 0, 'job ต้องไม่ทับการจองที่ส่งสลิปแล้ว');
  });

  test('ส่งสลิปพร้อมกับที่ job กำลังปิดการจอง — ชนะได้ฝั่งเดียว ไม่มีสลิปค้างบนการจองที่หมดเวลา', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ — บางรอบ job ปิดก่อน บางรอบสลิปเข้าก่อน
    for (let i = 0; i < 5; i += 1) {
      const user = await createUser();
      const booking = await book({ user, showtime, seats: [seats[i]] });
      await passDeadline(booking);
      const file = await makeSlipFile();

      const [, upload] = await Promise.allSettled([
        releaseExpiredHolds(),
        uploadSlip({ bookingId: booking.id, userId: user.id, file }),
      ]);

      const current = await bookingOf(booking.id);
      const payment = await paymentOf(booking.id);
      const held = await prisma.bookingSeat.count({ where: { bookingId: booking.id } });
      if (upload.status === 'fulfilled') {
        assert.equal(current.status, 'PENDING_VERIFICATION');
        assert.equal(payment.status, 'PENDING_VERIFICATION');
        assert.equal(held, 1, 'สลิปเข้าก่อน — ที่นั่งต้องยังถูกยึดไว้');
      } else {
        holdExpired(booking)(upload.reason);
        assert.equal(current.status, 'EXPIRED');
        assert.equal(payment.status, 'REJECTED');
        assert.equal(held, 0, 'job ปิดก่อน — ที่นั่งต้องถูกปล่อย');
        assert.equal(await fileExists(file.path), false);
      }
    }
  });
});

describe('ปฏิเสธสลิปหลังรอบเริ่มฉาย', () => {
  test('ปิดการจองและปล่อยที่นั่ง ไม่เปิดให้จ่ายใหม่ และส่งสลิปใหม่ไม่ได้', async () => {
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
    assert.equal(rejected.canUploadSlip, false);
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 0);
    const note = await prisma.notification.findFirst({ where: { type: 'PAYMENT_REJECTED' } });
    assert.match(note.bodyTh, /ปิดแล้ว/);
    assert.match(note.bodyTh, /ติดต่อเจ้าหน้าที่/);

    // โอนจริงแต่แนบรูปผิด — ส่งสลิปใหม่ไม่ได้แล้ว ต้องติดต่อเจ้าหน้าที่ตามที่แจ้งเตือนบอก
    await assert.rejects(submitSlip(booking, user), holdExpired(booking));
    assert.equal((await paymentOf(booking.id)).status, 'REJECTED');
  });
});
