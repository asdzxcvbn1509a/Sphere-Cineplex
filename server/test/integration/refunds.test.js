import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { cancelBooking } from '../../src/services/bookings.js';
import {
  completeRefund,
  getRefundSlipFileName,
  getSlipFileName,
  listRefunds,
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
  minutesFromNow,
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

describe('ลำดับคิวคืนเงิน', () => {
  test('รอคืน: ค้างนานสุดก่อน · คืนแล้ว: โอนคืนล่าสุดก่อน · sort สลับทิศได้และแบ่งหน้าตามลำดับเดียวกัน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const admin = await createAdmin();
    const users = await Promise.all([createUser(), createUser(), createUser()]);
    const paymentIds = [];
    for (const [index, user] of users.entries()) {
      const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[index]] });
      await cancelBooking({ bookingId: paid.id, byAdmin: true });
      const payment = await paymentOf(paid.id);
      // ตั้งเวลาเข้าคิวเองให้ห่างกันชัด ๆ ไม่พึ่งว่าคำสั่งข้างบนใช้เวลาต่างกันพอ
      await prisma.payment.update({
        where: { id: payment.id },
        data: { refundDueAt: minutesFromNow(-30 + index * 10) },
      });
      paymentIds.push(payment.id);
    }

    const ids = (queue) => queue.items.map((item) => item.id);
    assert.deepEqual(ids(await listRefunds()), paymentIds);
    assert.deepEqual(ids(await listRefunds({ sort: 'oldest' })), paymentIds);
    assert.deepEqual(ids(await listRefunds({ sort: 'newest' })), [...paymentIds].reverse());
    assert.deepEqual(ids(await listRefunds({ sort: 'newest', page: 2, pageSize: 2 })), [paymentIds[0]]);

    // โอนคืนกลับลำดับกับตอนเข้าคิว (ใบที่เข้าคิวก่อนโอนคืนทีหลังสุด) — แท็บคืนแล้วต้องเรียงตามเวลาโอนคืน ไม่ใช่เวลาเข้าคิว
    for (const [index, paymentId] of paymentIds.entries()) {
      await completeRefund({ paymentId, adminId: admin.id, file: await makeSlipFile({ kind: 'refund' }) });
      await prisma.payment.update({ where: { id: paymentId }, data: { refundedAt: minutesFromNow(-index * 10) } });
    }
    const refunded = (options) => listRefunds({ status: 'REFUNDED', ...options });
    assert.deepEqual(ids(await refunded()), paymentIds);
    assert.deepEqual(ids(await refunded({ sort: 'newest' })), paymentIds);
    assert.deepEqual(ids(await refunded({ sort: 'oldest' })), [...paymentIds].reverse());
    assert.deepEqual(ids(await refunded({ sort: 'oldest', page: 2, pageSize: 2 })), [paymentIds[0]]);
    assert.equal((await listRefunds()).total, 0);
  });
});

describe('บัญชีรับเงินคืนในคิวคืนเงิน', () => {
  test('ลูกค้ายกเลิกใบที่จ่ายแล้ว — ต้องแจ้งบัญชี และคิวเห็นชื่อบัญชี (ตัดช่องว่างแล้ว) กับเวลาที่ส่งสลิป', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await assert.rejects(
      cancelBooking({ bookingId: paid.id, userId: user.id }),
      apiErrorWith('REFUND_ACCOUNT_REQUIRED', 400),
    );

    await cancelBooking({
      bookingId: paid.id,
      userId: user.id,
      refundAccount: { bankName: 'กสิกรไทย', accountNo: '1234567890', accountName: '  วรรณกร จิตณา  ' },
    });

    const { items } = await listRefunds();
    assert.equal(items.length, 1);
    assert.equal(items[0].refundBankName, 'กสิกรไทย');
    assert.equal(items[0].refundAccountNo, '1234567890');
    assert.equal(items[0].refundAccountName, 'วรรณกร จิตณา');
    assert.equal(items[0].slipUploadedAt.getTime(), (await paymentOf(paid.id)).slipUploadedAt.getTime());
  });

  test('client รุ่นก่อนที่ไม่ส่งชื่อบัญชี — ยังยกเลิกได้ตามเดิม และชื่อบัญชีเป็น null', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await cancelBooking({
      bookingId: paid.id,
      userId: user.id,
      refundAccount: { bankName: 'กสิกรไทย', accountNo: '1234567890' },
    });

    const [item] = (await listRefunds()).items;
    assert.equal(item.refundAccountNo, '1234567890');
    assert.equal(item.refundAccountName, null);
  });
});

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
