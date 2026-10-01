import { customAlphabet } from 'nanoid';

// ตัดตัวอักษรที่สับสนออก (0/O, 1/I/L) เพราะรหัสนี้ผู้ใช้ต้องอ่านออกเสียง/พิมพ์ตามหน้าเคาน์เตอร์
const bookingAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const bookingNanoid = customAlphabet(bookingAlphabet, 6);
const digitNanoid = customAlphabet('0123456789', 8);

/** รหัสการจองที่ผู้ใช้เห็น เช่น TRS-7K2QX9 */
export const generateBookingCode = () => {
  return `TRS-${bookingNanoid()}`;
};

/** เลขอ้างอิงการชำระเงิน (ใช้เทียบกับสลิปตอน admin ตรวจ) */
export const generatePaymentReference = () => {
  return digitNanoid();
};
