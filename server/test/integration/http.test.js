import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { PAYMENT_SLIP_DIR } from '../../src/config/env.js';
import { issueSession, rotateSession } from '../../src/services/auth.js';
import { hashPassword } from '../../src/utils/password.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import {
  book,
  bookingOf,
  createAdmin,
  createShowtimeFixture,
  createUser,
  paymentOf,
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

describe('GET /api/health', () => {
  test('บอกจำนวน proxy ใน X-Forwarded-For และไอพีที่ระบบมองเห็น — ใช้ตั้ง TRUST_PROXY ตอนขึ้นระบบจริง', async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7' },
    });
    const body = await res.json();

    assert.equal(body.proxyHops, 2);
    // เทสต์ตั้ง TRUST_PROXY=loopback — เชื่อแค่ connection จาก 127.0.0.1 จึงได้รายการขวาสุดของ header
    assert.equal(body.ip, '198.51.100.7');
  });

  test('เรียกตรงไม่ผ่าน proxy ได้ proxyHops เป็น 0', async () => {
    const body = await (await fetch(`${base}/api/health`)).json();
    assert.equal(body.proxyHops, 0);
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

describe('เปิดดูสลิป', () => {
  const getSlip = (bookingId, token) =>
    fetch(`${base}/api/payments/${bookingId}/slip`, { headers: { Authorization: `Bearer ${token}` } });

  test('เจ้าของการจองเปิดรูปที่อัปโหลดได้ ไบต์และชนิดไฟล์ตรงกับที่ส่งไป', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    const token = signAccessToken(user);
    assert.equal((await postSlip(booking.id, token, TINY_PNG)).status, 201);

    const res = await getSlip(booking.id, token);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), TINY_PNG);
  });

  test('DB ยังอ้างถึงแต่ไฟล์หายจากที่เก็บแล้ว ได้ 404 SLIP_FILE_MISSING ไม่ใช่ 500', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    const token = signAccessToken(user);
    assert.equal((await postSlip(booking.id, token, TINY_PNG)).status, 201);
    const { slipPath } = await paymentOf(booking.id);
    await fs.unlink(path.join(PAYMENT_SLIP_DIR, slipPath));

    const res = await getSlip(booking.id, token);

    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'SLIP_FILE_MISSING');
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
  test('access token ใบเก่าใช้ไม่ได้ทันที — เครื่องที่กดเปลี่ยนได้ใบใหม่กลับไปเลย และ refresh token เดิมยังต่ออายุได้', async () => {
    const user = await createUser({ passwordHash: await hashPassword('Password123') });
    const { accessToken, refreshToken } = await issueSession(user, 'test');
    const me = (token) => fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });

    assert.equal((await me(accessToken)).status, 200);

    const changed = await fetch(`${base}/api/auth/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        // refresh token ของเครื่องที่กดเปลี่ยนมากับ cookie — ใบนี้ต้องไม่ถูกเพิกถอน
        Cookie: `trs_refresh=${refreshToken}`,
      },
      body: JSON.stringify({ currentPassword: 'Password123', newPassword: 'NewPassword456' }),
    });
    assert.equal(changed.status, 200);
    const { accessToken: fresh } = await changed.json();

    const revoked = await me(accessToken);
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).error.code, 'TOKEN_REVOKED');

    // ใบใหม่ที่ได้กลับมาใช้ได้ทันที หน้าเว็บจึงไม่ต้องไปเจอ 401 ก่อนแล้วค่อยต่ออายุ
    assert.equal((await me(fresh)).status, 200);

    const renewed = await rotateSession(refreshToken);
    const ok = await me(renewed.accessToken);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.user.id, user.id);
    assert.equal(body.user.tokenVersion, undefined, 'ไม่ส่ง tokenVersion ออกไปกับข้อมูลผู้ใช้');
  });
});

describe('POST /api/auth/refresh', () => {
  const postRefresh = (token) =>
    fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: token ? { Cookie: `trs_refresh=${token}` } : {},
    });
  const refreshCookieOf = (res) =>
    res.headers.getSetCookie().find((cookie) => cookie.startsWith('trs_refresh='));

  test('ไม่มี cookie = ยังไม่ล็อกอิน → 204 ไม่ใช่ 401 (หน้าเว็บถามทุกครั้งที่เปิด console จะได้ไม่แดง)', async () => {
    const res = await postRefresh();
    assert.equal(res.status, 204);
    assert.deepEqual(res.headers.getSetCookie(), []);
  });

  test('cookie ที่ server ไม่รู้จัก (เช่นหลัง seed ฐานใหม่) → 401 และลบ cookie ทิ้ง', async () => {
    const res = await postRefresh('not-a-real-token');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'INVALID_REFRESH_TOKEN');

    const cleared = refreshCookieOf(res);
    assert.ok(cleared?.startsWith('trs_refresh=;'), 'ต้องเขียน cookie ว่างทับใบเสีย');
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  });

  test('cookie ที่ใช้ได้ → 200 พร้อม access token และ cookie ใบใหม่', async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(user, 'test');

    const res = await postRefresh(refreshToken);
    assert.equal(res.status, 200);
    assert.ok((await res.json()).accessToken);

    const renewed = refreshCookieOf(res);
    assert.ok(renewed && !renewed.startsWith('trs_refresh=;'), 'ต้องได้ cookie ใบใหม่');
    assert.ok(!renewed.startsWith(`trs_refresh=${refreshToken};`), 'ต้องไม่ใช่ใบเดิม');
  });

  test('ใบที่อีกแท็บเพิ่ง rotate ไป → 409 REFRESH_RACE และไม่แตะ cookie (ในเบราว์เซอร์เป็นใบใหม่ไปแล้ว)', async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(user, 'tab');
    await rotateSession(refreshToken);

    const res = await postRefresh(refreshToken);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, 'REFRESH_RACE');
    assert.deepEqual(res.headers.getSetCookie(), []);
  });
});
