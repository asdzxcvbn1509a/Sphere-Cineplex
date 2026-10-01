import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../../src/services/bookings.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  apiErrorWith,
  book,
  createShowtimeFixture,
  createUser,
  minutesFromNow,
  submitSlip,
} from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

describe('นโยบายกักที่นั่ง', () => {
  test('มีใบรอชำระของรอบเดียวกันอยู่แล้ว — ให้ไปจ่ายใบเดิมก่อน พร้อมบอกรหัสและที่นั่งเดิม', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const first = await book({ user, showtime, seats: [seats[0], seats[1]] });

    await assert.rejects(
      createBooking({ userId: user.id, showtimeId: showtime.id, seatIds: [seats[2].id] }),
      (error) => {
        assert.equal(error.code, 'PENDING_BOOKING_EXISTS');
        assert.equal(error.details.bookingId, first.id);
        assert.deepEqual(error.details.seats, ['A1', 'A2']);
        return true;
      },
    );
  });

  test('ใบเดิมส่งสลิปแล้ว (รอตรวจ) — จองเพิ่มในรอบเดียวกันได้ตามปกติ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const first = await book({ user, showtime, seats: [seats[0]] });
    await submitSlip(first, user);

    const second = await book({ user, showtime, seats: [seats[1]] });
    assert.equal(second.status, 'PENDING_PAYMENT');
  });

  test('ถือที่นั่งค้างได้ไม่เกินเพดาน (MAX_PENDING_BOOKINGS_PER_USER = 3) รวมทุกรอบ', async () => {
    const user = await createUser();
    const fixtures = await Promise.all(
      [1, 2, 3, 4].map((day) => createShowtimeFixture({ startsAt: minutesFromNow(day * 24 * 60) })),
    );
    for (const { showtime, seats } of fixtures.slice(0, 3)) {
      await book({ user, showtime, seats: [seats[0]] });
    }

    const fourth = fixtures[3];
    await assert.rejects(
      book({ user, showtime: fourth.showtime, seats: [fourth.seats[0]] }),
      apiErrorWith('TOO_MANY_PENDING_BOOKINGS', 409),
    );
  });
});
