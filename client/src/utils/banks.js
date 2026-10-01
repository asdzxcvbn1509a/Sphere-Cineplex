/**
 * ธนาคารที่ให้เลือกตอนแจ้งบัญชีรับเงินคืน
 *
 * เก็บลงฐานข้อมูลเป็น "ชื่อภาษาไทย" เสมอ แม้ผู้ใช้จะสลับหน้าจอเป็น EN อยู่
 * เพราะผู้ดูแลเป็นคนเปิดแอปธนาคารโอนคืนเอง จึงควรเห็นชื่อแบบเดียวกับในแอปไทย
 */
export const BANKS = [
  { code: 'KBANK', th: 'กสิกรไทย', en: 'Kasikornbank' },
  { code: 'SCB', th: 'ไทยพาณิชย์', en: 'Siam Commercial Bank' },
  { code: 'BBL', th: 'กรุงเทพ', en: 'Bangkok Bank' },
  { code: 'KTB', th: 'กรุงไทย', en: 'Krungthai Bank' },
  { code: 'BAY', th: 'กรุงศรีอยุธยา', en: 'Krungsri' },
  { code: 'TTB', th: 'ทีทีบี', en: 'ttb' },
  { code: 'GSB', th: 'ออมสิน', en: 'GSB' },
  { code: 'BAAC', th: 'ธ.ก.ส.', en: 'BAAC' },
  { code: 'GHB', th: 'อาคารสงเคราะห์', en: 'GH Bank' },
  { code: 'KKP', th: 'เกียรตินาคินภัทร', en: 'Kiatnakin Phatra' },
  { code: 'CIMB', th: 'ซีไอเอ็มบี ไทย', en: 'CIMB Thai' },
  { code: 'TISCO', th: 'ทิสโก้', en: 'TISCO' },
  { code: 'UOB', th: 'ยูโอบี', en: 'UOB' },
  { code: 'LHB', th: 'แลนด์ แอนด์ เฮ้าส์', en: 'LH Bank' },
];

/** ค่าที่ใช้ใน <select> เมื่อธนาคารไม่อยู่ในรายการ แล้วให้ผู้ใช้พิมพ์เอง */
export const OTHER_BANK = 'OTHER';

/** ชื่อธนาคารที่จะส่งขึ้น server จาก code ที่เลือก */
export const bankNameByCode = (code) => BANKS.find((bank) => bank.code === code)?.th ?? '';

/** ตัดขีดและเว้นวรรคออกจากเลขบัญชีก่อนตรวจ/ส่ง — server ก็ทำแบบเดียวกัน */
export const normalizeAccountNo = (value) => String(value ?? '').replace(/[\s-]/g, '');

export const isValidAccountNo = (value) => /^[0-9]{10,15}$/.test(normalizeAccountNo(value));
