import generatePayload from 'promptpay-qr';
import { env } from '../config/env.js';

/**
 * สร้าง payload มาตรฐาน EMVCo สำหรับ PromptPay
 *
 * QR ที่ได้เป็น payload มาตรฐานที่สแกนจ่ายได้จริง ปลายทางคือหมายเลขพร้อมเพย์ใน PROMPTPAY_ID
 * ระบบไม่ได้ต่อกับธนาคารเพื่อตรวจยอดเข้าอัตโนมัติ การยืนยันการชำระเงิน
 * จึงทำโดย Admin ตรวจสลิปที่ผู้ใช้อัปโหลดเข้ามา
 */
export const createPromptPayPayload = (amountBaht) => {
  return generatePayload(env.PROMPTPAY_ID, { amount: Number(amountBaht) });
};

/** CRC-16/CCITT-FALSE — checksum ที่ EMVCo ใช้ปิดท้าย payload (tag 63) */
export const crc16ccitt = (input) => {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

/** แยก payload เป็น map ของ tag → value (เฉพาะระดับบนสุด) */
export const parseTlv = (payload) => {
  const result = {};
  let cursor = 0;
  while (cursor + 4 <= payload.length) {
    const tag = payload.slice(cursor, cursor + 2);
    const length = Number.parseInt(payload.slice(cursor + 2, cursor + 4), 10);
    if (Number.isNaN(length)) break;
    result[tag] = payload.slice(cursor + 4, cursor + 4 + length);
    cursor += 4 + length;
  }
  return result;
};

/** ตรวจว่า checksum ท้าย payload ถูกต้อง */
export const isValidPayload = (payload) => {
  if (typeof payload !== 'string' || payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const checksum = payload.slice(-4);
  if (!body.endsWith('6304')) return false;
  return crc16ccitt(body) === checksum;
};
