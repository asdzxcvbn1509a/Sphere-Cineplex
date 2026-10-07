import crypto from 'node:crypto';

/** header ที่ proxy ของหน้าเว็บ (Vercel) แนบมากับทุกคำขอ — ค่าตั้งไว้ใน client/vercel.js */
export const PROXY_SECRET_HEADER = 'x-proxy-secret';

const digest = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest();

/**
 * สร้างตัวเทียบ secret — ไม่ได้ตั้ง secret ไว้ = ไม่มีคำขอไหนเทียบผ่าน (คืน false เสมอ)
 * เทียบ hash ของทั้งสองฝั่งด้วย timingSafeEqual: ความยาวเท่ากันเสมอ และเวลาที่ใช้ไม่บอกว่าเดาถูกไปกี่ตัวอักษร
 */
export const createProxySecretMatcher = (secret) => {
  if (!secret) return () => false;
  const expected = digest(secret);
  return (presented) => crypto.timingSafeEqual(digest(presented), expected);
};

export default createProxySecretMatcher;
