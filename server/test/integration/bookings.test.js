import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import {
  cancelBooking,
  createBooking,
  expireBooking,
  releaseExpiredHolds,
} from '../../src/services/bookings.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
  bookingOf,
  createShowtimeFixture,
  createUser,
  minutesFromNow,
  paymentOf,
  submitSlip,
} from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

describe('สร้างการจอง', () => {
  test('สองคนกดจองที่นั่งเดียวกันพร้อมกัน — ได้คนเดียว อีกคนได้ SEAT_TAKEN พร้อมชื่อที่นั่ง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    const seatIds = [seats[0].id, seats[1].id];

    const results = await Promise.allSettled([
      createBooking({ userId: alice.id, showtimeId: showtime.id, seatIds }),
      createBooking({ userId: bob.id, showtimeId: showtime.id, seatIds }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].reason.code, 'SEAT_TAKEN');
    assert.deepEqual(failed[0].reason.details.seats, ['A1', 'A2']);
    assert.equal(await prisma.bookingSeat.count({ where: { showtimeId: showtime.id } }), 2);
  });

  test('จองชุดที่นั่งซ้อนกันโดยเลือกคนละลำดับพร้อมกัน — ได้ SEAT_TAKEN ไม่ใช่ deadlock', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [alice, bob] = await Promise.all([createUser(), createUser()]);

    for (let i = 0; i + 1 < 10; i += 2) {
      const [x, y] = [seats[i], seats[i + 1]];
      const results = await Promise.allSettled([
        createBooking({ userId: alice.id, showtimeId: showtime.id, seatIds: [x.id, y.id] }),
        createBooking({ userId: bob.id, showtimeId: showtime.id, seatIds: [y.id, x.id] }),
      ]);
      const failed = results.filter((r) => r.status === 'rejected');
      assert.equal(failed.length, 1);
      assert.equal(failed[0].reason.code, 'SEAT_TAKEN', failed[0].reason.message);
    }
  });

  test('ที่นั่งของโรงอื่นใช้จองรอบนี้ไม่ได้', async () => {
    const { showtime } = await createShowtimeFixture();
    const other = await createShowtimeFixture();
    const user = await createUser();

    await assert.rejects(
      createBooking({ userId: user.id, showtimeId: showtime.id, seatIds: [other.seats[0].id] }),
      apiErrorWith('INVALID_SEATS', 400),
    );
  });
});

describe('หมดเวลาชำระเงิน', () => {
  test('job ปล่อยที่นั่งของการจองที่เลยเวลา และแจ้งเตือนลูกค้า', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0], seats[1]] });
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: minutesFromNow(-1) } });

    assert.equal(await releaseExpiredHolds(), 1);
    assert.equal((await bookingOf(booking.id)).status, 'EXPIRED');
    assert.equal((await paymentOf(booking.id)).status, 'REJECTED');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { type: 'BOOKING_EXPIRED' } }), 1);
  });

  test('job ที่ถือรายการเก่ามา ต้องไม่ทับการจองที่เพิ่งส่งสลิป (สลิปต้องไม่หายจากคิว)', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(booking, user);

    // เหมือน job ที่ดึงรายการไว้ก่อนลูกค้าส่งสลิป แล้วเพิ่งวนมาถึงใบนี้ (เวลาใน job ผ่านกำหนดไปแล้ว)
    const expired = await expireBooking(
      { id: booking.id, code: booking.code, userId: user.id },
      minutesFromNow(60),
    );

    assert.equal(expired, false);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
    assert.equal((await paymentOf(booking.id)).status, 'PENDING_VERIFICATION');
    assert.equal(await prisma.bookingSeat.count({ where: { bookingId: booking.id } }), 1);
    assert.equal(await prisma.notification.count({ where: { type: 'BOOKING_EXPIRED' } }), 0);
  });
});

describe('ยกเลิกการจอง', () => {
  test('กดยกเลิกซ้ำพร้อมกัน — ยกเลิกครั้งเดียว แจ้งเตือนใบเดียว', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });

    const results = await Promise.allSettled([
      cancelBooking({ bookingId: booking.id, userId: user.id }),
      cancelBooking({ bookingId: booking.id, userId: user.id }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failure = results.find((r) => r.status === 'rejected').reason;
    assert.ok(['ALREADY_CLOSED', 'BOOKING_STATE_CHANGED'].includes(failure.code), failure.code);
    assert.equal(await prisma.notification.count({ where: { type: 'BOOKING_CANCELLED' } }), 1);
  });
});
