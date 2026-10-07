import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { cancelBooking } from '../../src/services/bookings.js';
import {
  completeRefund,
  getRefundSlipFileName,
  getSlipFileName,
  updateRefund,
} from '../../src/services/payments.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
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

/** จองแล้วจ่ายจนเป็น PAID จากนั้นผู้ดูแลยกเลิกแทน — ใบชำระเงินเข้าคิวรอคืนเงิน */
const refundPendingBooking = async () => {
  const { showtime, seats } = await createShowtimeFixture();
  const [admin, user] = await Promise.all([createAdmin(), createUser()]);
  const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
  await cancelBooking({ bookingId: paid.id, byAdmin: true });
  return { admin, user, booking: paid, payment: await paymentOf(paid.id) };
};

describe('แก้รายการที่คืนเงินแล้ว', () => {
  test('แนบสลิปใหม่ — สลิปเก่าถูกลบ สถานะยังคืนเงินแล้ว และไม่แจ้งเตือนลูกค้าซ้ำ', async () => {
    const { admin, booking, payment } = await refundPendingBooking();
    const first = await makeSlipFile({ kind: 'refund' });
    await completeRefund({ paymentId: payment.id, adminId: admin.id, note: 'โอนแล้ว', file: first });
    const refunded = await paymentOf(booking.id);

    const second = await makeSlipFile({ kind: 'refund' });
    await updateRefund({ paymentId: payment.id, note: '  แก้หมายเหตุ  ', file: second });

    const updated = await paymentOf(booking.id);
    assert.equal(updated.status, 'REFUNDED');
    assert.equal(updated.refundSlipPath, second.filename);
    assert.equal(updated.refundNote, 'แก้หมายเหตุ');
    assert.equal(updated.refundedAt.getTime(), refunded.refundedAt.getTime());
    assert.equal(await fileExists(first.path), false);
    assert.equal(await fileExists(second.path), true);
    assert.equal(await prisma.notification.count({ where: { type: 'REFUND_COMPLETED' } }), 1);

    // ไม่แนบไฟล์ = ใช้สลิปเดิม · หมายเหตุว่างเก็บเป็น null
    await updateRefund({ paymentId: payment.id, note: '   ' });
    const noteCleared = await paymentOf(booking.id);
    assert.equal(noteCleared.refundSlipPath, second.filename);
    assert.equal(noteCleared.refundNote, null);
    assert.equal(await fileExists(second.path), true);
  });

  test('รายการที่ยังไม่ได้บันทึกคืนเงิน หรือไม่มีอยู่จริง — แก้ไม่ได้ และไฟล์ที่แนบมาถูกลบ', async () => {
    const { payment } = await refundPendingBooking();

    const early = await makeSlipFile({ kind: 'refund' });
    await assert.rejects(
      updateRefund({ paymentId: payment.id, note: 'ยังไม่ได้โอน', file: early }),
      apiErrorWith('REFUND_NOT_COMPLETED', 409),
    );
    assert.equal(await fileExists(early.path), false);
    assert.equal((await paymentOf(payment.mainBookingId)).status, 'REFUND_PENDING');

    const orphan = await makeSlipFile({ kind: 'refund' });
    await assert.rejects(
      updateRefund({ paymentId: 'no-such-payment', file: orphan }),
      apiErrorWith('PAYMENT_NOT_FOUND', 404),
    );
    assert.equal(await fileExists(orphan.path), false);
  });
});

describe('ชื่อไฟล์สลิปสำหรับเปิดดู', () => {
  test('สลิปคืนเงิน — เจ้าของการจองและผู้ดูแลเปิดได้ คนอื่นได้ 403 · ยังไม่โอนคืนได้ 404', async () => {
    const { admin, user, booking, payment } = await refundPendingBooking();
    const stranger = await createUser();

    await assert.rejects(
      getRefundSlipFileName({ bookingId: booking.id, requester: user }),
      apiErrorWith('REFUND_SLIP_NOT_FOUND', 404),
    );

    const file = await makeSlipFile({ kind: 'refund' });
    await completeRefund({ paymentId: payment.id, adminId: admin.id, file });

    assert.equal(await getRefundSlipFileName({ bookingId: booking.id, requester: user }), file.filename);
    assert.equal(await getRefundSlipFileName({ bookingId: booking.id, requester: admin }), file.filename);
    await assert.rejects(
      getRefundSlipFileName({ bookingId: booking.id, requester: stranger }),
      apiErrorWith('NOT_BOOKING_OWNER', 403),
    );
  });

  test('สลิปโอนเงิน — ยังไม่ส่งสลิปได้ 404 (ก่อนเช็กสิทธิ์) · ส่งแล้วเจ้าของและผู้ดูแลเปิดได้ คนอื่นได้ 403', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, stranger] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const booking = await book({ user, showtime, seats: [seats[0]] });

    // ยังไม่มีสลิป — ตอบ 404 ก่อนดูว่าเป็นใคร (คนอื่นก็ได้ 404 ไม่ใช่ 403)
    await assert.rejects(
      getSlipFileName({ bookingId: booking.id, requester: stranger }),
      apiErrorWith('SLIP_NOT_FOUND', 404),
    );
    await assert.rejects(
      getSlipFileName({ bookingId: 'no-such-booking', requester: admin }),
      apiErrorWith('SLIP_NOT_FOUND', 404),
    );

    await submitSlip(booking, user);
    const { slipPath } = await paymentOf(booking.id);

    assert.equal(await getSlipFileName({ bookingId: booking.id, requester: user }), slipPath);
    assert.equal(await getSlipFileName({ bookingId: booking.id, requester: admin }), slipPath);
    await assert.rejects(
      getSlipFileName({ bookingId: booking.id, requester: stranger }),
      apiErrorWith('NOT_BOOKING_OWNER', 403),
    );
  });
});
