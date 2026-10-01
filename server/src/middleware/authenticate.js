import { verifyAccessToken } from '../utils/jwt.js';
import ApiError from '../utils/ApiError.js';
import prisma from '../lib/prisma.js';

const readBearer = (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
};

/** บังคับว่าต้องล็อกอิน — ใส่ req.user ให้ handler ถัดไป */
export const authenticate = async (req, _res, next) => {
  try {
    const token = readBearer(req);
    if (!token) throw ApiError.unauthorized('NO_TOKEN', 'กรุณาเข้าสู่ระบบก่อนใช้งาน');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      throw ApiError.unauthorized(
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'เซสชันหมดอายุ' : 'โทเคนไม่ถูกต้อง',
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true, name: true, email: true, role: true },
    });
    if (!user) throw ApiError.unauthorized('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** ไม่บังคับล็อกอิน แต่ถ้ามี token ที่ใช้ได้ก็ผูก req.user ให้ */
export const optionalAuth = async (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true, name: true, email: true, role: true },
    });
  } catch {
    // token เสีย/หมดอายุ ก็ถือว่าเป็นผู้ใช้ทั่วไป
  }
  next();
};
