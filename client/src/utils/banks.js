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

/**
 * เลขบัญชีแบบเว้นวรรคทุก 4 หลัก ไว้ให้ผู้ดูแลอ่านทีละช่วงตอนพิมพ์ลงแอปธนาคาร
 * ใช้แสดงผลอย่างเดียว — ปุ่มคัดลอกยังคัดลอกเลขดิบที่ไม่มีช่องว่าง
 */
export const formatAccountNo = (value) => normalizeAccountNo(value).replace(/(\d{4})(?=\d)/g, '$1 ');

/** ชื่อบัญชีสั้นกว่านี้ไม่น่าใช่ชื่อจริง — server ตรวจแบบเดียวกัน (2–100 ตัวอักษร) */
const MIN_ACCOUNT_NAME = 2;

/** ค่าเริ่มต้นของฟอร์มบัญชีรับเงินคืน (ใช้กับ RefundAccountFields) */
export const EMPTY_REFUND_FORM = { bankCode: '', customBank: '', accountNo: '', accountName: '' };

/**
 * แปลงบัญชีที่บันทึกไว้แล้วกลับเป็นค่าในฟอร์ม — ตอนลูกค้ากด "แก้ไขบัญชี" จะได้เห็นค่าเดิม
 * ชื่อธนาคารเก็บเป็นภาษาไทย ถ้าไม่ตรงกับรายการให้ถือว่าเป็น "อื่น ๆ" ที่พิมพ์เองไว้
 */
export const refundFormFromAccount = (bankName, accountNo, accountName) => {
  if (!bankName) return EMPTY_REFUND_FORM;
  const bank = BANKS.find((item) => item.th === bankName);
  const rest = { accountNo: accountNo ?? '', accountName: accountName ?? '' };
  return bank
    ? { bankCode: bank.code, customBank: '', ...rest }
    : { bankCode: OTHER_BANK, customBank: bankName, ...rest };
};

/**
 * ตรวจฟอร์มบัญชีรับเงินคืน — คืน { value, errors }
 * value = { refundBankName, refundAccountNo, refundAccountName } พร้อมส่ง server เมื่อกรอกครบ ไม่งั้นเป็น null
 * ชื่อบัญชีบังคับที่ฟอร์ม (server ไม่บังคับเพื่อรองรับ client รุ่นก่อน) — ผู้ดูแลต้องใช้เทียบก่อนโอนคืน
 */
export const readRefundAccountForm = (form, t) => {
  const bankName = form.bankCode === OTHER_BANK ? form.customBank.trim() : bankNameByCode(form.bankCode);
  const accountName = form.accountName.trim();
  const errors = {};
  if (!bankName) errors.bank = t('bookings.bankRequired');
  if (!isValidAccountNo(form.accountNo)) errors.accountNo = t('bookings.accountNoInvalid');
  if (accountName.length < MIN_ACCOUNT_NAME) errors.accountName = t('bookings.accountNameRequired');
  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      refundBankName: bankName,
      refundAccountNo: normalizeAccountNo(form.accountNo),
      refundAccountName: accountName,
    },
    errors,
  };
};
