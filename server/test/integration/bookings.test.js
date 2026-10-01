import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { createBooking } from '../../src/services/bookings.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import { apiErrorWith, createShowtimeFixture, createUser } from '../helpers/fixtures.js';

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
