import ApiError from '../utils/ApiError.js';
import { PROXY_SECRET_HEADER, createProxySecretMatcher } from '../utils/proxySecret.js';

/** เปิดให้เรียกตรงได้เสมอ — health check ของ Render และตัวปลุกเซิร์ฟเวอร์ (DEPLOY.md ข้อ 8) ไม่ได้มาทางหน้าเว็บ */
const OPEN_PATH = '/api/health';

/**
 * ค่าที่ Vercel ส่งมาเมื่อหาตัวแปร PROXY_SECRET ในโปรเจกต์ไม่เจอ — client/vercel.json อ้างถึงด้วย $PROXY_SECRET
 * และ Vercel ส่งข้อความนี้ไปตรง ๆ ถ้ายังไม่ได้ตั้งตัวแปร (หรือตั้งแล้วแต่ยังไม่ได้ redeploy)
 */
const UNRESOLVED_PLACEHOLDER = '$PROXY_SECRET';

/**
 * สถานะ secret ของคำขอ — /api/health แสดงไว้ให้ตรวจการตั้งค่าได้ทีละขั้น (DEPLOY.md ข้อ 7)
 * missing = ไม่มี header (ยิงตรงมาที่ Render) · unresolved = Vercel ยังไม่มีตัวแปร PROXY_SECRET
 * unchecked = มี header แล้วแต่ API ยังไม่ได้ตั้ง PROXY_SECRET · valid = ตรงกัน · invalid = สองฝั่งตั้งค่าไม่เหมือนกัน
 */
const statusOf = (presented, secret, matches) => {
  if (!presented) return 'missing';
  if (presented === UNRESOLVED_PLACEHOLDER) return 'unresolved';
  if (!secret) return 'unchecked';
  return matches(presented) ? 'valid' : 'invalid';
};

/**
 * รับเฉพาะคำขอที่มาทาง proxy ของหน้าเว็บ (Vercel แนบ secret มาใน header) — บังคับเมื่อตั้ง PROXY_SECRET แล้วเท่านั้น
 *
 * rate limit ทุกตัวนับตามไอพีที่อ่านจาก X-Forwarded-For ตาม TRUST_PROXY ซึ่งเป็นจำนวน proxy ที่ตายตัว
 * แต่คำขอที่ผ่าน Vercel มี proxy มากกว่าคำขอที่ยิงตรงไป Render หนึ่งชั้น จึงตั้งให้ถูกได้แค่ทางเดียว
 * - ตั้งตามทาง Vercel → คนที่ยิงตรงไป Render ใส่ X-Forwarded-For ปลอมหลบ rate limit ได้
 * - ตั้งตามทางตรง → ทุกคนที่เข้าผ่านหน้าเว็บกลายเป็นไอพีของ Vercel ใช้โควตาร่วมกัน กรอกรหัสผิดไม่กี่ครั้งก็ล็อกบัญชีคนอื่นได้
 * ปิดทางตรงไปเลย ไอพีที่อ่านได้จึงมาจาก Vercel เสมอ (Vercel เขียนทับ X-Forwarded-For ที่ผู้ใช้ส่งมาเอง)
 */
export const requireProxy = (secret) => {
  const matches = createProxySecretMatcher(secret);
  return (req, _res, next) => {
    req.proxySecret = statusOf(req.headers[PROXY_SECRET_HEADER], secret, matches);
    if (!secret || req.proxySecret === 'valid' || req.path === OPEN_PATH) return next();
    next(ApiError.forbidden('DIRECT_ACCESS_FORBIDDEN', 'กรุณาใช้งานผ่านหน้าเว็บ'));
  };
};

export default requireProxy;
