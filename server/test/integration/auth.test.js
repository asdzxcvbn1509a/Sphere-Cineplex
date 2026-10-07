import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import {
  issueSession,
  resetPassword,
  revokeSession,
  rotateSession,
} from '../../src/services/auth.js';
import { hashToken } from '../../src/utils/jwt.js';
import { verifyPassword } from '../../src/utils/password.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import { apiErrorWith, createUser } from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

const liveSessions = (userId) => prisma.refreshToken.count({ where: { userId, revokedAt: null } });

describe('ต่ออายุเซสชัน (refresh token rotation)', () => {
  test('สองแท็บต่ออายุด้วย cookie ใบเดียวกันพร้อมกัน — ได้ใบใหม่ใบเดียว และไม่โดนเตะออกทุกอุปกรณ์', async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(user, 'tab');

    const results = await Promise.allSettled([rotateSession(refreshToken), rotateSession(refreshToken)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    assert.equal(ok.length, 1);
    assert.equal(failed[0].reason.code, 'REFRESH_RACE');
    assert.equal(await liveSessions(user.id), 1, 'ใบใหม่ของแท็บที่ชนะต้องยังใช้ได้');

    // แท็บที่แพ้ลองใหม่ด้วย cookie ใบใหม่ (เบราว์เซอร์อัปเดต cookie ให้แล้ว) — ต้องผ่าน
    const retried = await rotateSession(ok[0].value.refreshToken);
    assert.ok(retried.accessToken);
  });

  test('เอาใบที่ถูก rotate ไปนานแล้วมาใช้ซ้ำ = ถูกขโมย → เพิกถอนทุกเซสชัน', async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(user, 'phone');
    await issueSession(user, 'laptop');
    const rotated = await rotateSession(refreshToken);

    // ทำเหมือนเวลาผ่านไปเกินช่วงผ่อนผันแล้ว
    await prisma.refreshToken.update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revokedAt: new Date(Date.now() - 60 * 1000) },
    });

    await assert.rejects(rotateSession(refreshToken), apiErrorWith('REFRESH_TOKEN_REUSED', 401));
    assert.equal(await liveSessions(user.id), 0);
    await assert.rejects(rotateSession(rotated.refreshToken), apiErrorWith('REFRESH_TOKEN_REUSED', 401));
  });

  test('ใบที่ logout ไปแล้ว ไม่ได้รับช่วงผ่อนผัน — ใช้ซ้ำทันทีก็ถือว่าถูกขโมย', async () => {
    const user = await createUser();
    const { refreshToken } = await issueSession(user, 'phone');
    await issueSession(user, 'laptop');
    await revokeSession(refreshToken);

    await assert.rejects(rotateSession(refreshToken), apiErrorWith('REFRESH_TOKEN_REUSED', 401));
    assert.equal(await liveSessions(user.id), 0);
  });
});

describe('ลิงก์ตั้งรหัสผ่านใหม่', () => {
  test('สองคำขอใช้ลิงก์เดียวกันพร้อมกัน — ตั้งรหัสได้ครั้งเดียว อีกคำขอได้ RESET_LINK_INVALID', async () => {
    const user = await createUser();
    await issueSession(user, 'phone');
    const token = 'race-reset-token'.padEnd(43, 'x');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const passwords = ['NewPassword111', 'NewPassword222'];
    const results = await Promise.allSettled(passwords.map((password) => resetPassword({ token, password })));
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    assert.equal(failed.length, 1);
    assert.equal(failed[0].reason.code, 'RESET_LINK_INVALID');
    const { passwordHash } = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(await verifyPassword(passwords[winner], passwordHash), 'รหัสที่ใช้ได้ต้องเป็นของคำขอที่ชนะ');
    assert.equal(await liveSessions(user.id), 0, 'ตั้งรหัสสำเร็จแล้วต้องออกจากระบบทุกเครื่อง');
  });
});
