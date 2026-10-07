import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** ใช้อัลกอริทึมเดียวทั้งตอนเซ็นและตอนตรวจ — ไม่ปล่อยให้ header ของ token เป็นคนเลือกว่าจะตรวจด้วยอะไร */
const ALGORITHM = 'HS256';

/**
 * ออก access token อายุสั้น เก็บไว้ใน memory ฝั่ง client เท่านั้น
 * tv = tokenVersion ตอนออก — authenticate เทียบกับค่าปัจจุบันในฐานข้อมูล เปลี่ยนรหัสผ่านแล้วใบเก่าใช้ไม่ได้ทันที
 * ไม่ใส่เบอร์โทรหรือข้อมูลส่วนตัวอื่น — payload ของ JWT ใครถือ token ก็ถอดอ่านได้ และ server ก็อ่านผู้ใช้จากฐานข้อมูลทุกครั้งอยู่แล้ว
 */
export const signAccessToken = (user) => {
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_ACCESS_SECRET,
    { algorithm: ALGORITHM, expiresIn: env.ACCESS_TOKEN_TTL },
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] });
};

/**
 * refresh token = สตริงสุ่ม 64 ไบต์ (ไม่ใช่ JWT)
 * เก็บลง DB เฉพาะ sha256 hash — ถ้าฐานข้อมูลรั่ว token ที่ได้ไปก็ใช้ไม่ได้
 */
export const generateRefreshToken = () => {
  const token = crypto.randomBytes(64).toString('hex');
  return { token, tokenHash: hashToken(token) };
};

export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const refreshTokenExpiry = () => {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
};

export const REFRESH_COOKIE = 'trs_refresh';

export const refreshCookieOptions = () => {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
};
