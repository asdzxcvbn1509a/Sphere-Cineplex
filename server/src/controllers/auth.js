import { REFRESH_COOKIE, refreshCookieOptions } from '../utils/jwt.js';
import * as authService from '../services/auth.js';

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
};

// @ENDPOINT POST http://localhost:4000/api/auth/register
export const register = async (req, res, next) => {
  try {
    const { refreshToken, ...rest } = await authService.register({
      ...req.body,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(res, refreshToken);
    res.status(201).json(rest);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/login
export const login = async (req, res, next) => {
  try {
    const { refreshToken, ...rest } = await authService.login({
      ...req.body,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(res, refreshToken);
    res.json(rest);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/refresh
export const refresh = async (req, res, next) => {
  try {
    const { refreshToken, ...rest } = await authService.rotateSession(
      req.cookies?.[REFRESH_COOKIE],
      req.headers['user-agent'],
    );
    setRefreshCookie(res, refreshToken);
    res.json(rest);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/logout
export const logout = async (req, res, next) => {
  try {
    await authService.revokeSession(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/auth/me
export const me = async (req, res, next) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/auth/password
export const changePassword = async (req, res, next) => {
  try {
    const result = await authService.changePassword({
      userId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      // เก็บเซสชันของเครื่องที่กำลังใช้อยู่ไว้ ไม่งั้นเปลี่ยนรหัสเสร็จจะเด้งออกจากระบบทันที
      keepToken: req.cookies?.[REFRESH_COOKIE],
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/forgot-password
export const forgotPassword = async (req, res, next) => {
  try {
    const result = await authService.requestPasswordReset({
      email: req.body.email,
      // ส่งอีเมลเป็นภาษาที่ผู้ใช้กำลังเปิดหน้าเว็บอยู่ ไม่ใช่ภาษาที่เซิร์ฟเวอร์ตั้งไว้
      lang: req.body.lang,
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/reset-password/check
export const checkResetLink = async (req, res, next) => {
  try {
    res.json(await authService.checkResetToken(req.body.token));
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/auth/reset-password
export const resetPassword = async (req, res, next) => {
  try {
    const result = await authService.resetPassword(req.body);
    // ไม่ล็อกอินให้อัตโนมัติ ให้ผู้ใช้พิมพ์รหัสใหม่ที่หน้าล็อกอินอีกรอบ
    // จะได้รู้ตั้งแต่ตอนนี้ว่าจำรหัสที่เพิ่งตั้งได้จริง ไม่ใช่ไปงงเอาตอนเข้าครั้งหน้า
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT PATCH http://localhost:4000/api/auth/me
export const updateMe = async (req, res, next) => {
  try {
    const user = await authService.updateProfile(req.user.id, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};
