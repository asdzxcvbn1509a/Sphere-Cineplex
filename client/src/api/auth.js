import api from './client.js';

/** สมัครสมาชิก — สำเร็จแล้วถือว่าล็อกอินให้เลย (ได้ accessToken + refresh cookie กลับมา) */
export const register = async ({ name, email, phone, password }) => {
  return await api.post('/auth/register', { name, email, phone, password });
};

/** เข้าสู่ระบบ — `identifier` กรอกเป็นอีเมลหรือเบอร์โทรศัพท์ก็ได้ */
export const login = async ({ identifier, password }) => {
  return await api.post('/auth/login', { identifier, password });
};

export const logout = async () => {
  return await api.post('/auth/logout');
};

export const getMe = async () => {
  return await api.get('/auth/me');
};

/**
 * เปลี่ยนรหัสผ่านของตัวเอง — สำเร็จแล้วเซสชันบนเครื่องอื่นจะถูกเพิกถอนทั้งหมด
 * แต่เครื่องที่กดเปลี่ยนยังใช้งานต่อได้ ไม่ต้องล็อกอินใหม่
 * ได้ `accessToken` ใบใหม่กลับมาด้วย เพราะใบเดิมใช้ไม่ได้ทันทีที่เปลี่ยนรหัส
 */
export const changePassword = async ({ currentPassword, newPassword }) => {
  return await api.patch('/auth/password', { currentPassword, newPassword });
};

export const updateProfile = async ({ name, email }) => {
  return await api.patch('/auth/me', {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
  });
};

/**
 * ขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล
 * ตอบสำเร็จเสมอไม่ว่าอีเมลนั้นจะมีบัญชีหรือไม่ — หน้านี้จะได้ไม่ถูกใช้ไล่เช็กว่าใครเป็นลูกค้าบ้าง
 * `lang` ใช้เลือกภาษาของอีเมลที่ส่งออกไป
 */
export const requestPasswordReset = async ({ email, lang }) => {
  return await api.post('/auth/forgot-password', { email, lang });
};

/** ตรวจลิงก์ก่อนแสดงฟอร์ม — token อยู่ใน body ไม่ใช่ใน URL เพื่อไม่ให้ไปโผล่ใน access log */
export const checkResetToken = async (token) => {
  return await api.post('/auth/reset-password/check', { token });
};

/** ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล — สำเร็จแล้วบัญชีนี้ถูกออกจากระบบทุกอุปกรณ์ */
export const resetPassword = async ({ token, password }) => {
  return await api.post('/auth/reset-password', { token, password });
};
