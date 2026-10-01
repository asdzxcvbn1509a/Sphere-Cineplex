import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { cancelBooking } from '../../src/services/bookings.js';
import { approvePayment, completeRefund, rejectPayment } from '../../src/services/payments.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  book,
  bookingOf,
  createAdmin,
  createPaidBooking,
  createShowtimeFixture,
  createUser,
  fileExists,
  makeSlipFile,
  paymentOf,
  submitSlip,
} from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

const settledSplit = (results) => ({
  ok: results.filter((r) => r.status === 'fulfilled'),
  failed: results.filter((r) => r.status === 'rejected'),
});

describe('ตรวจสลิปพร้อมกัน', () => {
  test('ผู้ดูแลสองคนกดอนุมัติใบเดียวกันพร้อมกัน — สำเร็จครั้งเดียว ลูกค้าได้แจ้งเตือนใบเดียว', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin1, admin2, user] = await Promise.all([createAdmin(), createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);
    const payment = await paymentOf(booking.id);

    const { ok, failed } = settledSplit(
      await Promise.allSettled([
        approvePayment({ paymentId: payment.id, adminId: admin1.id }),
        approvePayment({ paymentId: payment.id, adminId: admin2.id }),
      ]),
    );

    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].reason.code, 'PAYMENT_NOT_PENDING');
    assert.equal(await prisma.notification.count({ where: { type: 'PAYMENT_APPROVED' } }), 1);
  });

  test('อนุมัติชนกับปฏิเสธ — ผลสุดท้ายเป็นอย่างใดอย่างหนึ่งเท่านั้น', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);
    const payment = await paymentOf(booking.id);

    const { ok } = settledSplit(
      await Promise.allSettled([
        approvePayment({ paymentId: payment.id, adminId: admin.id }),
        rejectPayment({ paymentId: payment.id, adminId: admin.id, reason: 'ยอดไม่ตรง' }),
      ]),
    );

    assert.equal(ok.length, 1);
    const [finalBooking, finalPayment] = await Promise.all([bookingOf(booking.id), paymentOf(booking.id)]);
    const pair = `${finalBooking.status}/${finalPayment.status}`;
    assert.ok(['PAID/APPROVED', 'PENDING_PAYMENT/REJECTED'].includes(pair), `สถานะไม่สอดคล้องกัน: ${pair}`);
  });

  test('อนุมัติชนกับผู้ดูแลอีกคนกดยกเลิก — ต้องไม่มีการจองที่ PAID แต่ที่นั่งถูกปล่อยแล้ว', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);

    // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ
    for (let i = 0; i < 6; i += 1) {
      const booking = await book({ user, showtime, seats: [seats[i]] });
      await submitSlip(booking, user);
      const payment = await paymentOf(booking.id);

      const { failed } = settledSplit(
        await Promise.allSettled([
          approvePayment({ paymentId: payment.id, adminId: admin.id }),
          cancelBooking({ bookingId: booking.id, byAdmin: true }),
        ]),
      );
      // ฝั่งที่แพ้ต้องได้ 409 ที่อ่านรู้เรื่อง ไม่ใช่ deadlock ที่กลายเป็น 500
      for (const { reason } of failed) {
        assert.equal(reason.status, 409, `ได้ ${reason.code ?? reason.name}: ${reason.message}`);
      }

      const [finalBooking, finalPayment, heldSeats] = await Promise.all([
        bookingOf(booking.id),
        paymentOf(booking.id),
        prisma.bookingSeat.count({ where: { bookingId: booking.id } }),
      ]);
      if (finalBooking.status === 'PAID') {
        assert.equal(heldSeats, 1, 'จ่ายแล้วต้องยังถือที่นั่งอยู่');
        assert.equal(finalPayment.status, 'APPROVED');
      } else {
        assert.equal(finalBooking.status, 'CANCELLED');
        assert.equal(heldSeats, 0);
        assert.notEqual(finalPayment.status, 'APPROVED', 'ยกเลิกแล้วต้องไม่มีใบชำระเงินที่ถูกอนุมัติค้าง');
      }
    }
  });
});

describe('บันทึกคืนเงิน', () => {
  test('กดบันทึกคืนเงินซ้ำพร้อมกัน — สำเร็จครั้งเดียว ไฟล์ของครั้งที่ไม่ผ่านถูกลบ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await cancelBooking({ bookingId: paid.id, byAdmin: true });
    const payment = await paymentOf(paid.id);
    const [fileA, fileB] = await Promise.all([
      makeSlipFile({ kind: 'refund' }),
      makeSlipFile({ kind: 'refund' }),
    ]);

    const { ok, failed } = settledSplit(
      await Promise.allSettled([
        completeRefund({ paymentId: payment.id, adminId: admin.id, file: fileA }),
        completeRefund({ paymentId: payment.id, adminId: admin.id, file: fileB }),
      ]),
    );

    assert.equal(ok.length, 1);
    assert.equal(failed[0].reason.code, 'REFUND_NOT_PENDING');
    assert.equal(await prisma.notification.count({ where: { type: 'REFUND_COMPLETED' } }), 1);

    const stored = (await paymentOf(paid.id)).refundSlipPath;
    const [aExists, bExists] = await Promise.all([fileExists(fileA.path), fileExists(fileB.path)]);
    assert.equal(aExists, stored === fileA.filename);
    assert.equal(bExists, stored === fileB.filename);
  });
});
