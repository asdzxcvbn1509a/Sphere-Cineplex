/**
 * แปลงค่า TRUST_PROXY ใน .env เป็นค่าที่ app.set('trust proxy') ต้องการ
 *
 * - 'loopback' (ค่าเริ่มต้น) — เชื่อ X-Forwarded-For เฉพาะเมื่อคนส่งต่อมาคือเครื่องเดียวกัน
 *   (nginx/caddy ที่รันบนเครื่องเดียวกับ API) ใครต่อตรงจากข้างนอกปลอมไอพีผ่าน header ไม่ได้
 * - ตัวเลข — จำนวน proxy ที่อยู่หน้า API (เช่น load balancer ของ cloud 1 ชั้น = 1)
 * - ชื่อ/subnet อื่น ๆ ที่ Express รองรับ เช่น 'uniquelocal', '10.0.0.0/8' (คั่นด้วยจุลภาคได้)
 * - 'true' — เชื่อทุก hop: อันตราย ใครก็ปลอมไอพีหลบ rate limit ได้ ใช้เฉพาะเมื่อรู้ตัวจริง ๆ
 * - 'false' — ไม่เชื่อ header เลย ใช้ไอพีของ connection ตรง ๆ
 *
 * เดิมตั้งตายตัวเป็น 1 — ถ้าเปิด API ให้ต่อตรงโดยไม่มี proxy ข้างหน้า ผู้ใช้ส่ง X-Forwarded-For
 * ปลอมมาเองได้ แล้ว rate limit ของล็อกอิน/สมัคร/ลืมรหัสผ่าน (นับตามไอพี) ก็ไม่มีผล
 */
export const parseTrustProxy = (raw) => {
  const value = String(raw ?? '').trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(',');
};

export default parseTrustProxy;
