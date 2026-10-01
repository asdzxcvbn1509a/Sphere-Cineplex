import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import {
  cancelBooking,
  cancelShowtime,
  createBooking,
  updateRefundAccount,
} from '../../src/services/bookings.js';
import { createShowtime, deleteShowtime, updateShowtime } from '../../src/services/showtimes.js';
import { deleteTheatre, updateTheatre } from '../../src/services/theatres.js';
import { deleteMovie } from '../../src/services/movies.js';
import { sendShowtimeReminders } from '../../src/jobs/reminders.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
  bookingOf,
  createAdmin,
  createMovie,
  createPaidBooking,
  createShowtimeFixture,
  createSmallTheatre,
  createUser,
  minutesFromNow,
  paymentOf,
  submitSlip,
} from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

describe('ยกเลิกทั้งรอบ', () => {
  test('ใบที่จ่ายแล้วเข้าคิวคืนเงิน ใบที่รอจ่ายถูกปิด ที่นั่งถูกคืน และทุกคนได้แจ้งเตือน', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, paidUser, pendingUser] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user: paidUser, admin, showtime, seats: [seats[0], seats[1]] });
    const pending = await book({ user: pendingUser, showtime, seats: [seats[2]] });

    const result = await cancelShowtime({ showtimeId: showtime.id, reason: 'เครื่องฉายเสีย' });

    assert.equal(result.cancelledBookings, 2);
    assert.equal(result.refundsQueued, 1);
    assert.equal(result.showtime.status, 'CANCELLED');

    assert.equal((await bookingOf(paid.id)).status, 'CANCELLED');
    assert.equal((await bookingOf(pending.id)).status, 'CANCELLED');
    assert.match((await bookingOf(paid.id)).cancelReason, /เครื่องฉายเสีย/);
    assert.equal(await prisma.bookingSeat.count({ where: { showtimeId: showtime.id } }), 0);

    const paidPayment = await paymentOf(paid.id);
    assert.equal(paidPayment.status, 'REFUND_PENDING');
    assert.ok(paidPayment.refundDueAt);
    assert.equal((await paymentOf(pending.id)).status, 'REJECTED');

    const notes = await prisma.notification.findMany({ where: { type: 'SHOWTIME_CANCELLED' } });
    assert.equal(notes.length, 2);
    const paidNote = notes.find((n) => n.userId === paidUser.id);
    const pendingNote = notes.find((n) => n.userId === pendingUser.id);
    assert.match(paidNote.bodyTh, /แจ้งบัญชีรับเงินคืน/);
    assert.doesNotMatch(pendingNote.bodyTh, /แจ้งบัญชีรับเงินคืน/);
  });

  test('ยังมีสลิปรอตรวจ — ไม่ยกเลิกให้ และไม่แตะอะไรเลย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);

    await assert.rejects(
      cancelShowtime({ showtimeId: showtime.id }),
      apiErrorWith('SHOWTIME_HAS_PENDING_SLIPS', 409),
    );
    const fresh = await prisma.showtime.findUnique({ where: { id: showtime.id } });
    assert.equal(fresh.status, 'SCHEDULED');
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
  });

  test('รอบที่ยกเลิกแล้วกดซ้ำไม่ได้ และจองเพิ่มไม่ได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    await cancelShowtime({ showtimeId: showtime.id });

    await assert.rejects(
      cancelShowtime({ showtimeId: showtime.id }),
      apiErrorWith('SHOWTIME_ALREADY_CANCELLED', 409),
    );
    await assert.rejects(
      createBooking({ userId: user.id, showtimeId: showtime.id, seatIds: [seats[0].id] }),
      apiErrorWith('SHOWTIME_CANCELLED', 400),
    );
  });

  test('รอบที่ฉายจบไปแล้วยกเลิกย้อนหลังไม่ได้', async () => {
    const { showtime } = await createShowtimeFixture({ startsAt: minutesFromNow(-180) });
    await assert.rejects(cancelShowtime({ showtimeId: showtime.id }), apiErrorWith('SHOWTIME_ENDED', 409));
  });

  test('ไม่ส่ง "ใกล้ถึงเวลาฉาย" ให้รอบที่ถูกยกเลิก (ข้อมูลเก่าที่ยกเลิกผ่าน PATCH แบบเดิม)', async () => {
    const { showtime, seats } = await createShowtimeFixture({ startsAt: minutesFromNow(45) });
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await prisma.showtime.update({ where: { id: showtime.id }, data: { status: 'CANCELLED' } });

    assert.equal(await sendShowtimeReminders(), 0);
  });
});

describe('ลูกค้าแจ้งบัญชีรับเงินคืนเอง', () => {
  test('ใบที่รอคืนเงินแจ้งบัญชีได้ คนอื่นแก้ไม่ได้ และใบที่ไม่ได้รอคืนเงินแจ้งไม่ได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, owner, stranger] = await Promise.all([createAdmin(), createUser(), createUser()]);
    const paid = await createPaidBooking({ user: owner, admin, showtime, seats: [seats[0]] });
    const unpaid = await book({ user: owner, showtime, seats: [seats[1]] });

    await assert.rejects(
      updateRefundAccount({ bookingId: paid.id, userId: owner.id, bankName: 'กสิกรไทย', accountNo: '1234567890' }),
      apiErrorWith('REFUND_NOT_PENDING', 409),
    );

    await cancelBooking({ bookingId: paid.id, byAdmin: true });
    await assert.rejects(
      updateRefundAccount({ bookingId: paid.id, userId: stranger.id, bankName: 'กสิกรไทย', accountNo: '1234567890' }),
      apiErrorWith('NOT_BOOKING_OWNER', 403),
    );

    const updated = await updateRefundAccount({
      bookingId: paid.id,
      userId: owner.id,
      bankName: ' กสิกรไทย ',
      accountNo: '1234567890',
    });
    assert.equal(updated.payment.refundBankName, 'กสิกรไทย');
    assert.equal(updated.payment.refundAccountNo, '1234567890');

    await assert.rejects(
      updateRefundAccount({ bookingId: unpaid.id, userId: owner.id, bankName: 'กสิกรไทย', accountNo: '1234567890' }),
      apiErrorWith('REFUND_NOT_PENDING', 409),
    );
  });
});

describe('ด่านกันลบข้อมูลที่ยังผูกกับเงิน', () => {
  test('ลบรอบที่การจองถูกยกเลิกหมดแล้วไม่ได้ — คิวคืนเงินต้องไม่หาย', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await cancelBooking({ bookingId: paid.id, byAdmin: true });

    await assert.rejects(deleteShowtime(showtime.id), apiErrorWith('SHOWTIME_HAS_BOOKINGS', 409));
    assert.equal((await paymentOf(paid.id)).status, 'REFUND_PENDING');
  });

  test('รอบที่ไม่เคยมีการจองลบได้ตามปกติ', async () => {
    const { showtime } = await createShowtimeFixture();
    await deleteShowtime(showtime.id);
    assert.equal(await prisma.showtime.count({ where: { id: showtime.id } }), 0);
  });

  test('ลบโรงที่เคยมีการจอง (แม้ยกเลิกไปแล้ว) ไม่ได้', async () => {
    const { theatre, showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await cancelBooking({ bookingId: booking.id, userId: user.id });

    await assert.rejects(deleteTheatre(theatre.id), apiErrorWith('THEATRE_HAS_BOOKINGS', 409));
  });

  test('ลบหนังถาวรไม่ได้ถ้ายังมีเงินรอโอนคืน แต่ลบได้เมื่อทุกอย่างจบแล้ว', async () => {
    const { movie, showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    const paid = await createPaidBooking({ user, admin, showtime, seats: [seats[0]] });
    await cancelBooking({ bookingId: paid.id, byAdmin: true });

    await assert.rejects(deleteMovie(movie.id, { force: true }), apiErrorWith('MOVIE_HAS_OPEN_BOOKINGS', 409));

    // โอนคืนเสร็จแล้ว ไม่มีอะไรค้าง → ผู้ดูแลยืนยันลบถาวรได้
    await prisma.payment.update({ where: { bookingId: paid.id }, data: { status: 'REFUNDED' } });
    const result = await deleteMovie(movie.id, { force: true });
    assert.equal(result.deleted, true);
  });
});

describe('แก้ไขรอบฉาย', () => {
  test('แก้ราคารอบที่มีคนจองแล้วได้ แม้หน้าเว็บส่งเวลาและโรงเดิมมาด้วย', async () => {
    const { showtime, theatre, seats } = await createShowtimeFixture();
    const user = await createUser();
    await book({ user, showtime, seats: [seats[0]] });

    const updated = await updateShowtime(showtime.id, {
      startsAt: new Date(showtime.startsAt),
      theatreId: theatre.id,
      basePrice: 250,
    });
    assert.equal(updated.basePrice, 250);
    assert.equal(updated.prices.NORMAL, 250);
  });

  test('ย้ายเวลารอบที่มีคนจองแล้วยังไม่ได้', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    await book({ user, showtime, seats: [seats[0]] });

    await assert.rejects(
      updateShowtime(showtime.id, { startsAt: new Date(new Date(showtime.startsAt).getTime() + 60 * 60 * 1000) }),
      apiErrorWith('SHOWTIME_HAS_BOOKINGS', 409),
    );
  });

  test('โรงที่ปิดใช้งานลงรอบใหม่ไม่ได้', async () => {
    const [movie, theatre] = await Promise.all([createMovie(), createSmallTheatre()]);
    await updateTheatre(theatre.id, { isActive: false });

    await assert.rejects(
      createShowtime({ movieId: movie.id, theatreId: theatre.id, startsAt: minutesFromNow(24 * 60), basePrice: 200 }),
      apiErrorWith('THEATRE_INACTIVE', 400),
    );
  });
});
