import { verifyAccessToken } from '../utils/jwt.js';
import ApiError from '../utils/ApiError.js';
import prisma from '../lib/prisma.js';

const readBearer = (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
};

const USER_SELECT = { id: true, phone: true, name: true, email: true, role: true, tokenVersion: true };

/**
 * หาเจ้าของ token และเช็กว่า token ยังไม่ถูกเพิกถอน — คืน null ถ้าใช้ไม่ได้
 *
 * เปลี่ยน/รีเซ็ตรหัสผ่านแล้ว tokenVersion เพิ่มขึ้น access token ที่ออกก่อนหน้า (tv เก่า) จึงใช้ไม่ได้ทันที
 * ไม่ต้องรอหมดอายุเอง 15 นาที — คนที่ขโมย access token ไปได้จะโดนตัดพร้อมกับ refresh token
 * (token รุ่นก่อนมี tokenVersion ไม่มี tv เลย จะได้ 401 ครั้งเดียวแล้วหน้าเว็บขอใบใหม่ให้เอง)
 */
const findTokenOwner = async (payload) => {
  const found = await prisma.user.findUnique({ where: { id: payload.sub }, select: USER_SELECT });
  if (!found || found.tokenVersion !== payload.tv) return null;
  const { tokenVersion: _tokenVersion, ...user } = found;
  return user;
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

    const user = await findTokenOwner(payload);
    if (!user) throw ApiError.unauthorized('TOKEN_REVOKED', 'เซสชันนี้ถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่');

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
    // token ที่ถูกเพิกถอนแล้วถือว่าเป็นผู้ใช้ทั่วไป เหมือน token เสีย
    req.user = (await findTokenOwner(payload)) ?? undefined;
  } catch {
    // token เสีย/หมดอายุ ก็ถือว่าเป็นผู้ใช้ทั่วไป
  }
  next();
};
