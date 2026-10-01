/**
 * ทำให้เบอร์อยู่ในรูปเดียวกันเสมอ: 10 หลักขึ้นต้นด้วย 0
 * รองรับ 0812345678 / 081-234-5678 / +66812345678 / 66812345678
 *
 * ต้อง normalize ทุกครั้งก่อนบันทึกหรือค้นหา ไม่งั้นเบอร์เดียวกันที่พิมพ์คนละแบบ
 * จะกลายเป็นคนละบัญชี ทั้งที่คอลัมน์ phone เป็น unique
 */
export const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return digits;
};

export const isValidThaiMobile = (phone) => {
  return /^0[689]\d{8}$/.test(phone);
};
