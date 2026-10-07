import { normalizePhone } from './phone.js';

/** อีเมลเก็บเป็นตัวพิมพ์เล็กเสมอ — ตัวพิมพ์ต่างกันจะได้ไม่กลายเป็นคนละบัญชี (ผู้ดูแลแก้อีเมลให้ก็ใช้ตัวนี้) */
export const normalizeEmail = (raw) => String(raw ?? '').trim().toLowerCase();

/**
 * แปลงสิ่งที่กรอกในช่องล็อกอินเป็นเงื่อนไขค้นบัญชี — มี @ = อีเมล ไม่มี = เบอร์โทร · ว่างหลัง normalize คืน null
 *
 * ใช้ทั้งตอนค้นบัญชีและเป็นกุญแจของ rate limit ล็อกอิน ต้องเป็นตัวเดียวกันเสมอ
 * เดิมกุญแจ rate limit แค่ตัดช่องว่างกับทำเป็นตัวเล็ก แต่การค้นบัญชีตัดทุกอักขระที่ไม่ใช่ตัวเลขออกจากเบอร์
 * 0812345678, 081-234-5678, +66812345678 จึงเป็นบัญชีเดียวกันแต่นับโควตาแยกกัน — เดารหัสผ่านได้ไม่จำกัด
 */
export const loginLookup = (raw) => {
  const value = String(raw ?? '').trim();
  if (value.includes('@')) {
    const email = normalizeEmail(value);
    return email ? { email } : null;
  }
  const phone = normalizePhone(value);
  return phone ? { phone } : null;
};

/** กุญแจของบัญชีสำหรับ rate limit — ช่องว่างหรือรูปแบบที่ต่างกันของบัญชีเดียวกันได้กุญแจเดียวกัน */
export const loginKey = (raw) => {
  const lookup = loginLookup(raw);
  if (!lookup) return '';
  return lookup.email ? `email:${lookup.email}` : `phone:${lookup.phone}`;
};
