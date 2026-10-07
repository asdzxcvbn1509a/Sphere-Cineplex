import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { PAYMENT_SLIP_DIR, env } from '../../src/config/env.js';
import prisma from '../../src/lib/prisma.js';
import { issueSession, rotateSession } from '../../src/services/auth.js';
import { markRead, notify } from '../../src/services/notifications.js';
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
    assert.equal(body.proxySecret, 'missing');
  });

  test('ยังไม่ได้ตั้ง PROXY_SECRET — มี header ก็ได้ unchecked และไม่มีคำขอไหนถูกปัดตก', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { 'X-Proxy-Secret': 'anything' } });
    assert.equal((await res.json()).proxySecret, 'unchecked');
    assert.equal((await fetch(`${base}/api/movies`)).status, 200);
  });
});

describe('PROXY_SECRET — รับเฉพาะคำขอที่มาทางหน้าเว็บ', () => {
  const SECRET = 'proxy-secret-for-tests-'.padEnd(48, 'x');
  let guarded;
  let guardedBase;

  before(async () => {
    guarded = createApp({ proxySecret: SECRET }).listen(0, '127.0.0.1');
    await once(guarded, 'listening');
    guardedBase = `http://127.0.0.1:${guarded.address().port}`;
  });
  after(() => guarded.close());

  const get = (path, secret) =>
    fetch(`${guardedBase}${path}`, { headers: secret === undefined ? {} : { 'X-Proxy-Secret': secret } });

  test('ยิงตรงไม่มี secret หรือ secret ผิด → 403 DIRECT_ACCESS_FORBIDDEN', async () => {
    for (const secret of [undefined, 'wrong', '$PROXY_SECRET']) {
      const res = await get('/api/movies', secret);
      assert.equal(res.status, 403, String(secret));
      assert.equal((await res.json()).error.code, 'DIRECT_ACCESS_FORBIDDEN');
    }
  });

  test('secret ถูก → ผ่านไปถึง route ตามปกติ', async () => {
    assert.equal((await get('/api/movies', SECRET)).status, 200);
  });

  test('/api/health เปิดได้เสมอ และบอกสถานะ secret ของคำขอไว้ตรวจการตั้งค่า', async () => {
    const statusOf = async (secret) => {
      const res = await get('/api/health', secret);
      assert.equal(res.status, 200);
      return (await res.json()).proxySecret;
    };
    assert.equal(await statusOf(undefined), 'missing');
    // Vercel ส่งข้อความนี้มาตรง ๆ เมื่อโปรเจกต์ยังไม่มีตัวแปร PROXY_SECRET
    assert.equal(await statusOf('$PROXY_SECRET'), 'unresolved');
    assert.equal(await statusOf('wrong'), 'invalid');
    assert.equal(await statusOf(SECRET), 'valid');
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

  test('ช่องข้อความเกินจำนวนหรือยาวเกิน ถูกปฏิเสธตั้งแต่ตอนรับไฟล์ และไม่เหลือไฟล์ค้าง', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const user = await createUser();
    const booking = await book({ user, showtime, seats: [seats[0]] });
    const before = await slipFileCount();
    const withSlip = (form) => {
      form.append('slip', new Blob([TINY_PNG], { type: 'image/png' }), 'slip.png');
      return form;
    };

    const tooMany = new FormData();
    for (let i = 0; i < 6; i += 1) tooMany.append(`field${i}`, 'x');
    const tooLong = new FormData();
    tooLong.append('note', 'x'.repeat(5 * 1024));

    for (const form of [withSlip(tooMany), withSlip(tooLong)]) {
      const res = await fetch(`${base}/api/payments/${booking.id}/slip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${signAccessToken(user)}` },
        body: form,
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, 'UPLOAD_ERROR');
    }
    assert.equal(await slipFileCount(), before);
    assert.equal((await bookingOf(booking.id)).status, 'PENDING_PAYMENT');
  });

  test('อัปโหลดสลิปได้ไม่เกิน 20 ครั้งต่อชั่วโมงต่อบัญชี', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    // การจองที่ไม่มีอยู่จริง — service ตอบ 404 และลบไฟล์ทิ้งทุกครั้ง แต่ทุกคำขอนับโควตา
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await postSlip('no-such-booking', token, TINY_PNG)).status, 404);
    }

    const res = await postSlip('no-such-booking', token, TINY_PNG);
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, 'SLIP_RATE_LIMITED');
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
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
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

describe('boolean ใน query string', () => {
  test('?force=false ไม่ใช่การยืนยันลบถาวร — หนังที่มีการจองยังอยู่ · ค่าที่ไม่ใช่ true/false ได้ 422', async () => {
    const { movie, showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);
    await book({ user, showtime, seats: [seats[0]] });
    const remove = (query) =>
      fetch(`${base}/api/admin/movies/${movie.id}?${query}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${signAccessToken(admin)}` },
      });

    const kept = await remove('force=false');
    assert.equal(kept.status, 409);
    assert.equal((await kept.json()).error.code, 'MOVIE_HAS_BOOKINGS');
    assert.equal((await fetch(`${base}/api/movies/${movie.id}`)).status, 200);

    assert.equal((await remove('force=yes')).status, 422);
  });

  test('?unreadOnly=false คืนแจ้งเตือนที่อ่านแล้วด้วย ไม่ใช่แค่ที่ยังไม่อ่าน', async () => {
    const user = await createUser();
    const read = await notify({ userId: user.id, type: 'BOOKING_EXPIRED', context: { code: 'READ01' } });
    await notify({ userId: user.id, type: 'BOOKING_EXPIRED', context: { code: 'NEW001' } });
    await markRead(user.id, read.id);
    const list = async (query) => {
      const res = await fetch(`${base}/api/notifications?${query}`, {
        headers: { Authorization: `Bearer ${signAccessToken(user)}` },
      });
      return res.json();
    };

    const all = await list('unreadOnly=false');
    assert.equal(all.notifications.length, 2);
    assert.equal(all.unreadCount, 1);
    assert.equal((await list('unreadOnly=true')).notifications.length, 1);
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

const sendJson = (method, path, body, token) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });

describe('rate limit ล็อกอิน', () => {
  test('เบอร์เดียวกันที่พิมพ์คนละรูปแบบใช้โควตาเดียวกัน — เปลี่ยนรูปแบบเบอร์ไม่ได้โควตาใหม่', async () => {
    const login = (identifier) =>
      sendJson('POST', '/api/auth/login', { identifier, password: 'WrongPassword1' });
    const formats = ['0861234567', '086-123-4567', '+66861234567', '086 123 4567'];

    for (let i = 0; i < env.LOGIN_LIMIT; i += 1) {
      assert.equal((await login(formats[i % formats.length])).status, 401);
    }
    const res = await login('66861234567');
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, 'LOGIN_RATE_LIMITED');
  });
});

describe('PATCH /api/auth/me', () => {
  test('แก้ชื่อไม่ต้องใช้รหัสผ่าน แต่เปลี่ยนอีเมลต้องยืนยันรหัสผ่านปัจจุบัน และลิงก์รีเซ็ตที่ค้างอยู่ใช้ไม่ได้อีก', async () => {
    const user = await createUser({ passwordHash: await hashPassword('Password123') });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: 'pending-link', expiresAt: new Date(Date.now() + 60 * 1000) },
    });
    const patch = (body) => sendJson('PATCH', '/api/auth/me', body, signAccessToken(user));
    const errorCode = async (res) => (await res.json()).error.code;

    const renamed = await patch({ name: 'ชื่อใหม่' });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).user.name, 'ชื่อใหม่');
    // อีเมลเดิมที่ต่างแค่ตัวพิมพ์ไม่นับว่าเปลี่ยน
    assert.equal((await patch({ email: user.email.toUpperCase() })).status, 200);

    const noPassword = await patch({ email: 'new-address@test.local' });
    assert.equal(noPassword.status, 400);
    assert.equal(await errorCode(noPassword), 'CURRENT_PASSWORD_REQUIRED');

    const wrongPassword = await patch({ email: 'new-address@test.local', currentPassword: 'Wrong12345' });
    assert.equal(wrongPassword.status, 400);
    assert.equal(await errorCode(wrongPassword), 'WRONG_PASSWORD');
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).email, user.email);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 1);

    const changed = await patch({ email: 'New-Address@test.local', currentPassword: 'Password123' });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).user.email, 'new-address@test.local');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
  });
});

// ไว้ท้ายไฟล์ — ตัวนับเป็นรายไอพี (127.0.0.1) ใช้ร่วมกันทั้งไฟล์ เคสหลังจากนี้จะสมัครไม่ได้ไปอีก 15 นาที
describe('rate limit สมัครสมาชิก', () => {
  test('สมัครไม่สำเร็จเกิน 30 ครั้งจากไอพีเดียว → 429 กันการใช้หน้าสมัครไล่เช็กอีเมล/เบอร์', async () => {
    const register = () =>
      sendJson('POST', '/api/auth/register', {
        name: 'ทดสอบ',
        email: 'not-an-email',
        phone: '0861234567',
        password: 'Password123',
      });

    for (let i = 0; i < 30; i += 1) assert.equal((await register()).status, 422);
    const res = await register();
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, 'REGISTER_RATE_LIMITED');
  });
});
