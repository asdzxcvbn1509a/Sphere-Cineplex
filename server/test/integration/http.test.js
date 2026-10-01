import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createApp } from '../../src/app.js';
import { PAYMENT_SLIP_DIR } from '../../src/config/env.js';
import { changePassword, issueSession, rotateSession } from '../../src/services/auth.js';
import { hashPassword } from '../../src/utils/password.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  book,
  bookingOf,
  createAdmin,
  createShowtimeFixture,
  createUser,
} from '../helpers/fixtures.js';

/**
 * เทสต์ผ่าน HTTP จริงทั้งสาย (helmet → authenticate → multer → ตรวจไฟล์ → service)
 * สิ่งที่เทสต์ระดับ service มองไม่เห็น เช่น header ความปลอดภัย และ middleware ที่อยู่หน้า controller
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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const postSlip = (bookingId, token, content, type = 'image/png') => {
  const form = new FormData();
  form.append('slip', new Blob([content], { type }), 'slip.png');
  return fetch(`${base}/api/payments/${bookingId}/slip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
};

const slipFileCount = async () => (await fs.readdir(PAYMENT_SLIP_DIR)).length;

describe('security headers', () => {
  test('ทุก response มี nosniff — เบราว์เซอร์ต้องไม่เดาชนิดไฟล์สลิปเป็นอย่างอื่น', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('อัปโหลดสลิป', () => {
  test('ไฟล์ที่บอกว่าเป็น PNG แต่ไส้ในเป็น HTML ถูกปฏิเสธ และไม่เหลือไฟล์ค้าง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    const before = await slipFileCount();

    const res = await postSlip(booking.id, signAccessToken(user), '<html><script>alert(1)</script></html>');

    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'UNSUPPORTED_FILE_TYPE');
    assert.equal(await slipFileCount(), before);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_PAYMENT');
  });

  test('รูป PNG จริงผ่าน และการจองเข้าคิวตรวจ', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });

    const res = await postSlip(booking.id, signAccessToken(user), TINY_PNG);

    assert.equal(res.status, 201);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_VERIFICATION');
  });
});

describe('แบ่งหน้ารายการฝั่งผู้ดูแล', () => {
  test('หน้า 2 ได้ช่วงถัดไปพร้อมจำนวนทั้งหมด หน้าเกินได้รายการว่าง และขอเกินเพดานไม่ได้', async () => {
    const admin = await createAdmin();
    const { showtime, seats } = await createShowtimeFixture();
    for (let i = 0; i < 7; i += 1) {
      const user = await createUser();
      await book({ user, showtime, seats: [seats[i]] });
    }
    const token = signAccessToken(admin);
    const get = (query) =>
      fetch(`${base}/api/admin/bookings?${query}`, { headers: { Authorization: `Bearer ${token}` } });

    const all = await (await get('pageSize=100')).json();
    assert.equal(all.total, 7);
    assert.equal(all.bookings.length, 7);

    const page2 = await (await get('page=2&pageSize=3')).json();
    assert.equal(page2.total, 7);
    assert.equal(page2.page, 2);
    assert.equal(page2.pageSize, 3);
    assert.deepEqual(
      page2.bookings.map((booking) => booking.id),
      all.bookings.slice(3, 6).map((booking) => booking.id),
    );

    const beyond = await (await get('page=5&pageSize=3')).json();
    assert.equal(beyond.bookings.length, 0);
    assert.equal(beyond.total, 7);

    assert.equal((await get('pageSize=500')).status, 422);
  });
});

describe('เพิกถอน access token เมื่อเปลี่ยนรหัสผ่าน', () => {
  test('access token ใบเก่าใช้ไม่ได้ทันที — แต่เครื่องที่กดเปลี่ยนต่ออายุด้วย refresh token ได้', async () => {
    const user = await createUser({ passwordHash: await hashPassword('Password123') });
    const { accessToken, refreshToken } = await issueSession(user, 'test');
    const me = (token) => fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });

    assert.equal((await me(accessToken)).status, 200);

    await changePassword({
      userId: user.id,
      currentPassword: 'Password123',
      newPassword: 'NewPassword456',
      keepToken: refreshToken,
    });

    const revoked = await me(accessToken);
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).error.code, 'TOKEN_REVOKED');

    const renewed = await rotateSession(refreshToken);
    const ok = await me(renewed.accessToken);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.user.id, user.id);
    assert.equal(body.user.tokenVersion, undefined, 'ไม่ส่ง tokenVersion ออกไปกับข้อมูลผู้ใช้');
  });
});
