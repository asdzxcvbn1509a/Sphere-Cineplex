import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import prisma from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';
import { cancelBooking, cancelShowtime, getBookingById } from '../../src/services/bookings.js';
import {
  approvePayment,
  completeRefund,
  listPayments,
  listRefunds,
  rejectPayment,
} from '../../src/services/payments.js';
import { getReceipt } from '../../src/services/receipts.js';
import { getQueueCounts } from '../../src/services/reports.js';
import {
  adminChangeSeats,
  cancelSeatChange,
  releaseExpiredSeatChanges,
  requestSeatChange,
  uploadSeatChangeSlip,
} from '../../src/services/seatChanges.js';
import { getSeatMap } from '../../src/services/showtimes.js';
import { updateSeats } from '../../src/services/theatres.js';
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
  paymentOfSeatChange,
} from '../helpers/fixtures.js';

/**
 * เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว — โรงทดสอบ 3 แถว × 4 ที่ ราคาฐาน 200
 * seats[0..3] = A1–A4 ธรรมดา 200 · seats[4..7] = B1–B4 พรีเมียม 280 · seats[8..11] = C1–C4 พรีเมียม 280
 */
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

const REFUND_ACCOUNT = { bankName: 'ธนาคารกสิกรไทย', accountNo: '1234567890' };

const change = (booking, user, seats, refundAccount) => {
  return requestSeatChange({
    bookingId: booking.id,
    userId: user.id,
    seatIds: seats.map((seat) => seat.id),
    refundAccount,
  });
};

const payTopUp = async (seatChangeId, user) => {
  return uploadSeatChangeSlip({ seatChangeId, userId: user.id, file: await makeSlipFile() });
};

const labelsOf = (booking) => booking.seats.map((seat) => seat.label);

/** ที่นั่งที่การจองถือไว้จริงในตาราง BookingSeat (ไม่รวมที่นั่งที่กันไว้ให้คำขอ) */
const heldSeatIds = async (bookingId) => {
  const rows = await prisma.bookingSeat.findMany({ where: { bookingId, seatChangeId: null } });
  return rows.map((row) => row.seatId).sort();
};

const seatStatus = async (showtime, label) => {
  const map = await getSeatMap(showtime.id);
  const row = map.rows.find((item) => item.rowLabel === label[0]);
  return row.seats.find((seat) => seat.seatNumber === Number(label.slice(1))).status;
};

/** ทำให้คำขอที่รอโอนส่วนต่างหมดเวลาด้วย job จริง */
const expireNow = async (seatChangeId) => {
  await prisma.seatChange.update({
    where: { id: seatChangeId },
    data: { holdExpiresAt: minutesFromNow(-1) },
  });
  assert.equal(await releaseExpiredSeatChanges(), 1);
};

describe('ย้ายไปที่นั่งราคาเท่าเดิม', () => {
  test('ย้ายทันที ที่นั่งเดิมว่างให้คนอื่นจองได้ ยอดเท่าเดิม และใบเสร็จเดิมไม่เปลี่ยน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[1]] });

    const result = await change(paid, user, [seats[0], seats[2]]);

    assert.equal(result.seatChange.status, 'COMPLETED');
    assert.equal(result.seatChange.diffAmount, 0);
    assert.deepEqual(labelsOf(result.booking), ['A1', 'A3']);
    assert.equal(result.booking.totalAmount, 400);
    assert.deepEqual(await heldSeatIds(paid.id), [seats[0].id, seats[2].id].sort());
    assert.equal(await prisma.payment.count({ where: { bookingId: paid.id } }), 1);
    assert.equal(await prisma.notification.count({ where: { type: 'SEATS_CHANGED' } }), 1);
    assert.equal(result.booking.seatChange.changesLeft, 1);

    // ที่นั่งเดิม (A2) กลับมาว่างทันที
    assert.equal(await seatStatus(showtime, 'A2'), 'AVAILABLE');
    await book({ user: other, showtime, seats: [seats[1]] });

    // ใบเสร็จที่ออกไปแล้วยังเป็นที่นั่งตอนจ่าย แต่บอกที่นั่งปัจจุบันไว้ให้
    const receipt = await getReceipt({ bookingId: paid.id, requester: user });
    assert.deepEqual(receipt.lines[0].seats, ['A1', 'A2']);
    assert.deepEqual(receipt.seatsChangedTo, ['A1', 'A3']);
    assert.equal(receipt.receiptNo, paid.payment.receiptNo);
  });
});

describe('ย้ายไปที่นั่งที่ถูกกว่า', () => {
  test('ส่วนต่างเข้าคิวคืนเงินพร้อมบัญชีที่แจ้ง ยอดการจองลดลง และแจ้งยอดส่วนต่างตอนโอนคืน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[4], seats[5]] });

    await assert.rejects(
      change(paid, user, [seats[4], seats[0]]),
      apiErrorWith('REFUND_ACCOUNT_REQUIRED', 400),
    );

    const result = await change(paid, user, [seats[4], seats[0]], REFUND_ACCOUNT);
    assert.equal(result.seatChange.status, 'COMPLETED');
    assert.equal(result.seatChange.diffAmount, -80);
    assert.equal(result.booking.totalAmount, 480);
    assert.deepEqual(labelsOf(result.booking), ['A1', 'B1']);

    const refund = await paymentOfSeatChange(result.seatChange.id);
    assert.equal(refund.kind, 'SEAT_CHANGE_REFUND');
    assert.equal(refund.status, 'REFUND_PENDING');
    assert.equal(refund.refundAmount, 80);
    assert.equal(refund.refundBankName, REFUND_ACCOUNT.bankName);
    assert.equal(refund.refundAccountNo, REFUND_ACCOUNT.accountNo);
    // ค่าตั๋วหลักไม่ถูกแตะ
    assert.equal((await paymentOf(paid.id)).status, 'APPROVED');

    const queue = await listRefunds();
    assert.deepEqual(
      queue.items.map((item) => [item.kind, item.refundAmount]),
      [['SEAT_CHANGE_REFUND', 80]],
    );
    assert.equal((await getQueueCounts()).pendingRefundAmount, 80);

    await completeRefund({
      paymentId: refund.id,
      adminId: admin.id,
      file: await makeSlipFile({ kind: 'refund' }),
    });
    const notice = await prisma.notification.findFirst({ where: { type: 'REFUND_COMPLETED' } });
    assert.ok(notice.bodyTh.includes('80 บาท'));
  });
});

describe('ย้ายไปที่นั่งที่แพงกว่า (โอนส่วนต่าง)', () => {
  test('ระหว่างรอโอน ที่นั่งใหม่ถูกกัน ที่นั่งเดิมยังเป็นของลูกค้า → อนุมัติแล้วย้ายจริงพร้อมใบเสร็จส่วนต่าง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[1]] });

    const pending = await change(paid, user, [seats[0], seats[4]]);
    assert.equal(pending.seatChange.status, 'PENDING_PAYMENT');
    assert.equal(pending.seatChange.diffAmount, 80);
    assert.ok(pending.seatChange.holdSecondsLeft > 0);
    // ยังไม่ย้าย — การจองอยู่ที่นั่งเดิมครบ ยอดเท่าเดิม
    assert.deepEqual(labelsOf(pending.booking), ['A1', 'A2']);
    assert.equal(pending.booking.totalAmount, 400);
    assert.equal(pending.booking.seatChange.open.id, pending.seatChange.id);
    assert.equal(await seatStatus(showtime, 'B1'), 'HELD');
    assert.equal(await seatStatus(showtime, 'A2'), 'BOOKED');
    await assert.rejects(book({ user: other, showtime, seats: [seats[4]] }), apiErrorWith('SEAT_TAKEN', 409));

    const topUp = await paymentOfSeatChange(pending.seatChange.id);
    assert.equal(topUp.kind, 'SEAT_CHANGE_TOPUP');
    assert.equal(topUp.status, 'AWAITING_SLIP');
    assert.equal(topUp.amount, 80);
    assert.ok(topUp.qrPayload);

    const uploaded = await payTopUp(pending.seatChange.id, user);
    assert.equal(uploaded.status, 'PENDING_VERIFICATION');
    assert.equal(uploaded.holdSecondsLeft, null);
    assert.equal((await getQueueCounts()).pendingSlips, 1);
    const queue = await listPayments();
    assert.equal(queue.items[0].kind, 'SEAT_CHANGE_TOPUP');
    assert.deepEqual(queue.items[0].seatChange.toSeats, ['A1', 'B1']);

    // ระหว่างที่สลิปส่วนต่างรอตรวจ ยกเลิกการจองไม่ได้ทั้งลูกค้าและผู้ดูแล
    await assert.rejects(
      cancelBooking({ bookingId: paid.id, userId: user.id, refundAccount: REFUND_ACCOUNT }),
      apiErrorWith('SEAT_CHANGE_AWAITING_VERIFICATION', 409),
    );
    await assert.rejects(
      cancelBooking({ bookingId: paid.id, byAdmin: true }),
      apiErrorWith('SEAT_CHANGE_AWAITING_VERIFICATION', 409),
    );
    assert.equal((await getBookingById(paid.id)).canCancel, false);

    const approved = await approvePayment({ paymentId: topUp.id, adminId: admin.id });
    assert.deepEqual(labelsOf(approved), ['A1', 'B1']);
    assert.equal(approved.totalAmount, 480);
    assert.deepEqual(await heldSeatIds(paid.id), [seats[0].id, seats[4].id].sort());
    assert.equal(await prisma.bookingSeat.count({ where: { seatChangeId: { not: null } } }), 0);
    assert.equal(await seatStatus(showtime, 'A2'), 'AVAILABLE');

    const settled = await paymentOfSeatChange(pending.seatChange.id);
    assert.equal(settled.status, 'APPROVED');
    assert.equal(settled.receiptNo, formatReceiptNo(receiptYear(settled.verifiedAt), 2));

    // ใบเสร็จค่าตั๋วยังเป็นที่นั่งเดิม · ใบเสร็จส่วนต่างบอกว่าย้ายจากไหนไปไหน
    const mainReceipt = await getReceipt({ bookingId: paid.id, requester: user });
    assert.deepEqual(mainReceipt.lines.flatMap((line) => line.seats), ['A1', 'A2']);
    const topUpReceipt = await getReceipt({ bookingId: paid.id, paymentId: settled.id, requester: user });
    assert.equal(topUpReceipt.receiptNo, settled.receiptNo);
    assert.deepEqual(topUpReceipt.lines, [
      { kind: 'SEAT_CHANGE', fromSeats: ['A1', 'A2'], toSeats: ['A1', 'B1'], quantity: 1, unitPrice: 80, amount: 80 },
    ]);

    const notice = await prisma.notification.findFirst({ where: { type: 'SEATS_CHANGED' } });
    assert.ok(notice.bodyTh.includes(settled.receiptNo));
  });

  test('ปฏิเสธสลิปส่วนต่าง → ได้เวลาโอนใหม่ ที่นั่งใหม่ยังถูกกันไว้ และส่งสลิปใหม่ได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await payTopUp(pending.seatChange.id, user);
    const topUp = await paymentOfSeatChange(pending.seatChange.id);

    await rejectPayment({ paymentId: topUp.id, adminId: admin.id, reason: 'ยอดไม่ตรง' });

    const reopened = await prisma.seatChange.findUnique({ where: { id: pending.seatChange.id } });
    assert.equal(reopened.status, 'PENDING_PAYMENT');
    assert.ok(reopened.holdExpiresAt > new Date());
    assert.equal((await paymentOfSeatChange(pending.seatChange.id)).status, 'REJECTED');
    assert.equal(await seatStatus(showtime, 'B1'), 'HELD');
    assert.equal(await prisma.notification.count({ where: { type: 'SEAT_CHANGE_REJECTED' } }), 1);

    const again = await payTopUp(pending.seatChange.id, user);
    assert.equal(again.status, 'PENDING_VERIFICATION');
  });

  test('ไม่โอนภายในเวลา → คำขอหมดเวลา ปล่อยที่นั่งใหม่ ที่นั่งเดิมไม่หาย และไม่นับโควตา', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);

    await expireNow(pending.seatChange.id);

    const expired = await prisma.seatChange.findUnique({ where: { id: pending.seatChange.id } });
    assert.equal(expired.status, 'EXPIRED');
    assert.ok(expired.expiredAt);
    assert.equal((await paymentOfSeatChange(pending.seatChange.id)).status, 'REJECTED');
    assert.equal(await seatStatus(showtime, 'B1'), 'AVAILABLE');
    assert.deepEqual(await heldSeatIds(paid.id), [seats[0].id]);
    assert.equal(await prisma.notification.count({ where: { type: 'SEAT_CHANGE_EXPIRED' } }), 1);

    const booking = await getBookingById(paid.id);
    assert.equal(booking.seatChange.changesLeft, 2);
    assert.equal(booking.seatChange.canChange, true);
  });

  test('ลูกค้ายกเลิกคำขอก่อนโอน → ที่นั่งใหม่ว่างทันที · ส่งสลิปแล้วยกเลิกคำขอไม่ได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    const first = await change(paid, user, [seats[4]]);
    const cancelled = await cancelSeatChange({ seatChangeId: first.seatChange.id, userId: user.id });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.payment.status, 'REJECTED');
    assert.equal(await seatStatus(showtime, 'B1'), 'AVAILABLE');

    const second = await change(paid, user, [seats[5]]);
    await payTopUp(second.seatChange.id, user);
    await assert.rejects(
      cancelSeatChange({ seatChangeId: second.seatChange.id, userId: user.id }),
      apiErrorWith('SEAT_CHANGE_AWAITING_VERIFICATION', 409),
    );
  });
});

describe('กติกาการเปลี่ยนที่นั่ง', () => {
  test('เปลี่ยนได้เฉพาะการจองที่จ่ายแล้วของตัวเอง และก่อนเส้นตาย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);

    const unpaid = await book({ user, showtime, seats: [seats[0]] });
    await assert.rejects(change(unpaid, user, [seats[1]]), apiErrorWith('SEAT_CHANGE_NOT_ALLOWED', 409));

    const paid = await createPaidBooking({ user: other, admin, showtime, seats: [seats[2]] });
    await assert.rejects(change(paid, user, [seats[3]]), apiErrorWith('NOT_BOOKING_OWNER', 403));

    const soon = await createShowtimeFixture({ startsAt: minutesFromNow(20) });
    const late = await createPaidBooking({ user, admin, showtime: soon.showtime, seats: [soon.seats[0]] });
    await assert.rejects(change(late, user, [soon.seats[1]]), apiErrorWith('SEAT_CHANGE_WINDOW_CLOSED', 403));
    const shaped = await getBookingById(late.id);
    assert.equal(shaped.seatChange.canChange, false);
    assert.equal(shaped.seatChange.blockedReason, 'WINDOW_CLOSED');
  });

  test('จำนวนต้องเท่าเดิม ที่นั่งต้องเป็นของโรงนี้และเปิดใช้งาน และต้องเปลี่ยนจริง', async () => {
    const { showtime, theatre, seats } = await createShowtimeFixture();
    const other = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[1]] });

    await assert.rejects(change(paid, user, [seats[2]]), apiErrorWith('SEAT_COUNT_MISMATCH', 400));
    await assert.rejects(
      change(paid, user, [seats[0], other.seats[2]]),
      apiErrorWith('INVALID_SEATS', 400),
    );
    await assert.rejects(change(paid, user, [seats[1], seats[0]]), apiErrorWith('NO_SEAT_CHANGE', 400));

    await updateSeats(theatre.id, { seatIds: [seats[3].id], isActive: false });
    await assert.rejects(change(paid, user, [seats[0], seats[3]]), apiErrorWith('INVALID_SEATS', 400));
  });

  test('ลูกค้าเปลี่ยนได้ 2 ครั้ง — คำขอที่ยกเลิกหรือหมดเวลาไม่นับ', async () => {
    const { seats, showtime } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await change(paid, user, [seats[1]]);
    const abandoned = await change(paid, user, [seats[4]]);
    await cancelSeatChange({ seatChangeId: abandoned.seatChange.id, userId: user.id });
    const expired = await change(paid, user, [seats[5]]);
    await expireNow(expired.seatChange.id);
    await change(paid, user, [seats[2]]);

    await assert.rejects(change(paid, user, [seats[3]]), apiErrorWith('SEAT_CHANGE_LIMIT', 409));
    const shaped = await getBookingById(paid.id);
    assert.equal(shaped.seatChange.changesLeft, 0);
    assert.equal(shaped.seatChange.blockedReason, 'LIMIT');
    assert.equal(shaped.seatChange.history.length, 4);
  });

  test('มีคำขอที่รอโอนส่วนต่างค้างอยู่ — ขอใหม่ไม่ได้จนกว่าจะจบ', async () => {
    const { seats, showtime } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);

    await assert.rejects(change(paid, user, [seats[1]]), (error) => {
      assert.equal(error.code, 'SEAT_CHANGE_PENDING');
      assert.equal(error.details.seatChangeId, pending.seatChange.id);
      return true;
    });
  });
});

describe('ทำรายการพร้อมกัน', () => {
  test('สองคนแย่งที่นั่งใหม่เดียวกัน — ได้คนเดียว อีกคนได้ SEAT_TAKEN และยังอยู่ที่นั่งเดิมครบ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, alice, bob] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const alicePaid = await createPaidBooking({ user: alice, admin, showtime, seats: [seats[0]] });
    const bobPaid = await createPaidBooking({ user: bob, admin, showtime, seats: [seats[1]] });

    const results = await Promise.allSettled([
      change(alicePaid, alice, [seats[2]]),
      change(bobPaid, bob, [seats[2]]),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.equal(failure.code, 'SEAT_TAKEN');
    assert.deepEqual(failure.details.seats, ['A3']);

    const loser = results[0].status === 'rejected' ? alicePaid : bobPaid;
    const original = loser === alicePaid ? seats[0] : seats[1];
    assert.deepEqual(await heldSeatIds(loser.id), [original.id]);
    assert.deepEqual(labelsOf(await getBookingById(loser.id)), [loser === alicePaid ? 'A1' : 'A2']);
  });

  test('สองคนสลับที่นั่งกันเองพร้อมกัน — ไม่มีที่นั่งซ้อนหรือค้าง (แพ้ได้ SEAT_TAKEN หรือ write conflict ไม่ใช่ข้อมูลพัง)', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, alice, bob] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const alicePaid = await createPaidBooking({ user: alice, admin, showtime, seats: [seats[0]] });
    const bobPaid = await createPaidBooking({ user: bob, admin, showtime, seats: [seats[1]] });

    const results = await Promise.allSettled([
      change(alicePaid, alice, [seats[1]]),
      change(bobPaid, bob, [seats[0]]),
    ]);

    // PostgreSQL อาจตัดสินให้ฝั่งหนึ่งแพ้ด้วย deadlock (ผ่าน HTTP จะกลายเป็น 409 WRITE_CONFLICT) หรือชน unique ตามปกติ
    for (const result of results.filter((item) => item.status === 'rejected')) {
      const { code, message } = result.reason;
      assert.ok(
        code === 'SEAT_TAKEN' || code === 'P2034' || /40P01|40001|deadlock/.test(String(message)),
        `${code}: ${message}`,
      );
    }
    for (const paid of [alicePaid, bobPaid]) {
      const booking = await bookingOf(paid.id);
      assert.deepEqual(await heldSeatIds(paid.id), booking.seatSnapshot.map((seat) => seat.id).sort());
    }
    assert.equal(await prisma.bookingSeat.count({ where: { showtimeId: showtime.id } }), 2);
  });

  test('กดเปลี่ยนซ้ำพร้อมกันบนการจองเดียวกัน — สำเร็จครั้งเดียว และไม่มีที่นั่งค้างที่ไม่มีใครจ่าย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[1]] });

    const results = await Promise.allSettled([
      change(paid, user, [seats[2], seats[3]]),
      change(paid, user, [seats[1], seats[3]]),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.ok(['BOOKING_STATE_CHANGED', 'SEAT_TAKEN'].includes(failure.code), failure.code);

    const booking = await bookingOf(paid.id);
    assert.deepEqual(await heldSeatIds(paid.id), booking.seatSnapshot.map((seat) => seat.id).sort());
    assert.equal(await prisma.bookingSeat.count({ where: { showtimeId: showtime.id } }), 2);
  });

  test('เปลี่ยนที่นั่งพร้อมกับยกเลิกการจอง — ผลลัพธ์สอดคล้องกันเสมอ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });

    await Promise.allSettled([
      change(paid, user, [seats[1]]),
      cancelBooking({ bookingId: paid.id, userId: user.id, refundAccount: REFUND_ACCOUNT }),
    ]);

    const booking = await bookingOf(paid.id);
    if (booking.status === 'CANCELLED') {
      assert.equal(await prisma.bookingSeat.count({ where: { bookingId: paid.id } }), 0);
      assert.equal((await paymentOf(paid.id)).refundAmount, 200);
    } else {
      assert.deepEqual(await heldSeatIds(paid.id), booking.seatSnapshot.map((seat) => seat.id).sort());
    }
  });
});

describe('ยกเลิกการจองที่เคยเปลี่ยนที่นั่ง', () => {
  test('ยกเลิกหลังอัปเกรด — คืนยอดสุทธิในรายการเดียว (รวมส่วนต่างที่โอนเพิ่ม) และใบเสร็จทั้งสองใบขึ้นตรารอคืนเงิน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await payTopUp(pending.seatChange.id, user);
    const topUp = await paymentOfSeatChange(pending.seatChange.id);
    await approvePayment({ paymentId: topUp.id, adminId: admin.id });

    await cancelBooking({ bookingId: paid.id, userId: user.id, refundAccount: REFUND_ACCOUNT });

    const main = await paymentOf(paid.id);
    assert.equal(main.status, 'REFUND_PENDING');
    assert.equal(main.refundAmount, 280);
    assert.equal((await paymentOfSeatChange(pending.seatChange.id)).status, 'APPROVED');
    assert.equal((await listRefunds()).total, 1);
    assert.equal((await getQueueCounts()).pendingRefundAmount, 280);

    const topUpReceipt = await getReceipt({ bookingId: paid.id, paymentId: topUp.id, requester: user });
    assert.deepEqual(topUpReceipt.refund, { status: 'REFUND_PENDING', refundedAt: null });
  });

  test('ยกเลิกหลังดาวน์เกรด — คืนยอดสุทธิ (หักส่วนที่คืนไปแล้ว) รวมกันเท่ากับที่จ่ายมาพอดี', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[4]] });
    await change(paid, user, [seats[0]], REFUND_ACCOUNT);

    await cancelBooking({ bookingId: paid.id, userId: user.id, refundAccount: REFUND_ACCOUNT });

    assert.equal((await paymentOf(paid.id)).refundAmount, 200);
    assert.equal((await getQueueCounts()).pendingRefundAmount, 280);
  });

  test('ยกเลิกระหว่างรอโอนส่วนต่าง (ยังไม่ส่งสลิป) — ปิดคำขอและคืนที่นั่งที่กันไว้ด้วย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);

    await cancelBooking({ bookingId: paid.id, userId: user.id, refundAccount: REFUND_ACCOUNT });

    assert.equal((await prisma.seatChange.findUnique({ where: { id: pending.seatChange.id } })).status, 'CANCELLED');
    assert.equal((await paymentOfSeatChange(pending.seatChange.id)).status, 'REJECTED');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: paid.id } }), 0);
    assert.equal((await paymentOf(paid.id)).refundAmount, 200);
  });
});

describe('ยกเลิกทั้งรอบฉาย', () => {
  test('มีสลิปส่วนต่างรอตรวจ → ยกเลิกรอบไม่ได้ · ตรวจเสร็จแล้วยกเลิกได้และคืนยอดสุทธิ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await payTopUp(pending.seatChange.id, user);

    await assert.rejects(
      cancelShowtime({ showtimeId: showtime.id }),
      apiErrorWith('SHOWTIME_HAS_PENDING_SLIPS', 409),
    );

    const topUp = await paymentOfSeatChange(pending.seatChange.id);
    await approvePayment({ paymentId: topUp.id, adminId: admin.id });
    const result = await cancelShowtime({ showtimeId: showtime.id });

    assert.equal(result.refundsQueued, 1);
    assert.equal((await paymentOf(paid.id)).refundAmount, 280);
  });

  test('คำขอที่ยังรอโอนส่วนต่างถูกปิดไปพร้อมรอบ และที่นั่งที่กันไว้ถูกคืน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);

    await cancelShowtime({ showtimeId: showtime.id });

    assert.equal((await prisma.seatChange.findUnique({ where: { id: pending.seatChange.id } })).status, 'CANCELLED');
    assert.equal((await paymentOfSeatChange(pending.seatChange.id)).status, 'REJECTED');
    assert.equal(await prisma.bookingSeat.count({ where: { showtimeId: showtime.id } }), 0);
    assert.equal((await paymentOf(paid.id)).refundAmount, 200);
  });
});

describe('ผู้ดูแลย้ายที่นั่งแทนลูกค้า', () => {
  test('ย้ายได้เฉพาะโซนเดิม ไม่ติดเส้นตาย ไม่นับโควตา และลูกค้าได้แจ้งเตือนพร้อมเหตุผล', async () => {
    const soon = await createShowtimeFixture({ startsAt: minutesFromNow(20) });
    const { showtime, seats } = soon;
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[4]] });

    await assert.rejects(
      adminChangeSeats({ bookingId: paid.id, adminId: admin.id, seatIds: [seats[0].id, seats[1].id] }),
      apiErrorWith('SEAT_ZONE_MISMATCH', 400),
    );

    const result = await adminChangeSeats({
      bookingId: paid.id,
      adminId: admin.id,
      seatIds: [seats[1].id, seats[4].id],
      reason: 'ที่นั่ง A1 ชำรุด',
    });

    assert.equal(result.seatChange.status, 'COMPLETED');
    assert.equal(result.seatChange.byAdmin, true);
    assert.equal(result.seatChange.diffAmount, 0);
    assert.deepEqual(labelsOf(result.booking), ['A2', 'B1']);
    assert.equal(result.booking.seatChange.changesLeft, 2);
    const notice = await prisma.notification.findFirst({ where: { type: 'SEATS_CHANGED' } });
    assert.ok(notice.bodyTh.includes('ที่นั่ง A1 ชำรุด'));
  });

  test('ปิดใช้งานที่นั่งชำรุดก่อนแล้วค่อยย้าย — ผังไม่มีที่นั่งนั้น และย้ายลูกค้าออกได้', async () => {
    const { showtime, theatre, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0], seats[1]] });
    await updateSeats(theatre.id, { seatIds: [seats[0].id], isActive: false });

    // หน้าย้ายที่นั่งสร้างผังจาก getSeatMap — A1 ไม่อยู่ในผัง จึงเริ่มเลือกไว้แค่ A2 แล้วให้เลือกที่แทนให้ครบ
    const map = await getSeatMap(showtime.id);
    assert.ok(!map.rows.flatMap((row) => row.seats).some((seat) => seat.id === seats[0].id));

    const result = await adminChangeSeats({
      bookingId: paid.id,
      adminId: admin.id,
      seatIds: [seats[1].id, seats[2].id],
      reason: 'ที่นั่ง A1 ชำรุด',
    });

    assert.equal(result.seatChange.status, 'COMPLETED');
    assert.equal(result.seatChange.diffAmount, 0);
    assert.deepEqual(labelsOf(result.booking), ['A2', 'A3']);
    assert.deepEqual(await heldSeatIds(paid.id), [seats[1].id, seats[2].id].sort());
  });
});

describe('สลิปส่วนต่างที่ส่งหลังหมดเวลา', () => {
  test('ที่นั่งใหม่ยังว่าง → กันคืนแล้วเข้าคิวตรวจตามปกติ อนุมัติแล้วย้ายได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await expireNow(pending.seatChange.id);

    const late = await payTopUp(pending.seatChange.id, user);
    assert.equal(late.status, 'PENDING_VERIFICATION');
    assert.equal(await seatStatus(showtime, 'B1'), 'HELD');

    const topUp = await paymentOfSeatChange(pending.seatChange.id);
    const approved = await approvePayment({ paymentId: topUp.id, adminId: admin.id });
    assert.deepEqual(labelsOf(approved), ['B1']);
  });

  test('ที่นั่งใหม่ถูกจองไปแล้ว → เข้าคิวแบบคืนเงิน อนุมัติแล้วคืนส่วนต่าง ไม่มีใบเสร็จ และการจองไม่เปลี่ยน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await expireNow(pending.seatChange.id);
    await book({ user: other, showtime, seats: [seats[4]] });

    const late = await payTopUp(pending.seatChange.id, user);
    assert.equal(late.status, 'EXPIRED');
    assert.equal(late.payment.status, 'PENDING_VERIFICATION');
    assert.equal((await getQueueCounts()).pendingSlips, 1);

    const topUp = await paymentOfSeatChange(pending.seatChange.id);
    await approvePayment({ paymentId: topUp.id, adminId: admin.id });

    const refunded = await paymentOfSeatChange(pending.seatChange.id);
    assert.equal(refunded.status, 'REFUND_PENDING');
    assert.equal(refunded.refundAmount, 80);
    assert.equal(refunded.receiptNo, null);
    assert.equal(await prisma.notification.count({ where: { type: 'SEAT_CHANGE_LATE_REFUND' } }), 1);
    assert.deepEqual(labelsOf(await getBookingById(paid.id)), ['A1']);
  });

  test('ส่งสลิปส่วนต่างพร้อมกับที่ job กำลังปิดคำขอ — ลูกค้าไม่เห็น error และที่นั่งใหม่ยังถูกกันไว้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const admin = await createAdmin();
    // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ — บางรอบ job ปิดคำขอก่อน (สลิปไปทางส่งช้า) บางรอบสลิปเข้าก่อน
    for (let i = 0; i < 4; i += 1) {
      const user = await createUser();
      const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[i]] });
      const pending = await change(paid, user, [seats[4 + i]]);
      await prisma.seatChange.update({
        where: { id: pending.seatChange.id },
        data: { holdExpiresAt: minutesFromNow(-1) },
      });

      const [, upload] = await Promise.allSettled([
        releaseExpiredSeatChanges(),
        payTopUp(pending.seatChange.id, user),
      ]);

      assert.equal(upload.status, 'fulfilled', upload.reason?.message);
      assert.equal(upload.value.status, 'PENDING_VERIFICATION');
      assert.equal(await seatStatus(showtime, `B${i + 1}`), 'HELD');
    }
  });
});

describe('HTTP', () => {
  const as = (account) => ({ Authorization: `Bearer ${signAccessToken(account)}` });

  test('POST /api/bookings/:id/seat-changes — 201 ย้ายสำเร็จ · 409 ที่นั่งถูกจอง · 401 ไม่มี token', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await book({ user: other, showtime, seats: [seats[2]] });

    const post = (headers, seatIds) =>
      fetch(`${base}/api/bookings/${paid.id}/seat-changes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatIds }),
      });

    assert.equal((await post({}, [seats[1].id])).status, 401);

    const taken = await post(as(user), [seats[2].id]);
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error.code, 'SEAT_TAKEN');

    const moved = await post(as(user), [seats[1].id]);
    assert.equal(moved.status, 201);
    const body = await moved.json();
    assert.equal(body.seatChange.status, 'COMPLETED');
    assert.deepEqual(body.booking.seats.map((seat) => seat.label), ['A2']);
  });

  test('GET /api/seat-changes/:id และสลิปส่วนต่าง — เจ้าของและผู้ดูแลเปิดได้ คนอื่นได้ 403', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user, other] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    const pending = await change(paid, user, [seats[4]]);
    await payTopUp(pending.seatChange.id, user);
    const topUp = await paymentOfSeatChange(pending.seatChange.id);

    const own = await fetch(`${base}/api/seat-changes/${pending.seatChange.id}`, { headers: as(user) });
    assert.equal(own.status, 200);
    const { seatChange } = await own.json();
    assert.equal(seatChange.payment.amount, 80);
    assert.equal(seatChange.payment.hasSlip, true);

    const stranger = await fetch(`${base}/api/seat-changes/${pending.seatChange.id}`, { headers: as(other) });
    assert.equal(stranger.status, 403);

    const slipUrl = `${base}/api/payments/${paid.id}/slip?payment=${topUp.id}`;
    assert.equal((await fetch(slipUrl, { headers: as(admin) })).status, 200);
    assert.equal((await fetch(slipUrl, { headers: as(other) })).status, 403);
  });
});
