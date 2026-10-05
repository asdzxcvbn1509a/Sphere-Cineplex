/**
 * จำนวนเงินเป็นตัวอักษร สำหรับบรรทัด "(ห้าร้อยหกสิบบาทถ้วน)" บนใบเสร็จ
 * รับเฉพาะจำนวนเต็มบาท เพราะระบบเก็บเงินเป็นบาทเต็มเสมอ (ดู schema.prisma) จึงลงท้าย "ถ้วน" ทุกครั้ง
 */

const TH_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const TH_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

const EN_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
// ครอบคลุมถึง Number.MAX_SAFE_INTEGER (ราว 9 พันล้านล้าน)
const EN_SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'];

const assertBaht = (amount) => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`จำนวนเงินต้องเป็นจำนวนเต็มบาทที่ไม่ติดลบ (ได้ ${amount})`);
  }
};

/**
 * อ่านตัวเลขที่ต่ำกว่าหนึ่งล้าน
 * hasHigher = มีหลักล้านอยู่ข้างหน้า — หลักหน่วยที่เป็น 1 จึงอ่าน "เอ็ด" แม้ส่วนนี้จะมีหลักเดียว (1,000,001 = หนึ่งล้านเอ็ด)
 */
const readThaiBelowMillion = (value, hasHigher) => {
  const digits = String(value).split('').map(Number);
  return digits
    .map((digit, index) => {
      const place = digits.length - 1 - index;
      if (digit === 0) return '';
      if (place === 1) {
        if (digit === 1) return 'สิบ';
        if (digit === 2) return 'ยี่สิบ';
        return `${TH_DIGITS[digit]}สิบ`;
      }
      if (place === 0 && digit === 1 && (hasHigher || value > 9)) return 'เอ็ด';
      return TH_DIGITS[digit] + TH_PLACES[place];
    })
    .join('');
};

/** หลักล้านอ่านซ้ำแบบเดียวกับหลักหน่วย แล้วต่อด้วย "ล้าน" (ล้านล้าน ก็ได้จากการเวียนซ้ำ) */
const readThai = (value) => {
  if (value < 1_000_000) return readThaiBelowMillion(value, false);
  const rest = value % 1_000_000;
  const head = `${readThai(Math.floor(value / 1_000_000))}ล้าน`;
  return rest ? head + readThaiBelowMillion(rest, true) : head;
};

/** 560 → "ห้าร้อยหกสิบบาทถ้วน" */
export const bahtText = (amount) => {
  assertBaht(amount);
  if (amount === 0) return 'ศูนย์บาทถ้วน';
  return `${readThai(amount)}บาทถ้วน`;
};

const readEnglishBelowThousand = (value) => {
  const words = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) words.push(`${EN_ONES[hundreds]} Hundred`);
  if (rest >= 20) {
    const tens = EN_TENS[Math.floor(rest / 10)];
    words.push(rest % 10 ? `${tens}-${EN_ONES[rest % 10]}` : tens);
  } else if (rest > 0) {
    words.push(EN_ONES[rest]);
  }
  return words.join(' ');
};

/** 560 → "Five Hundred Sixty Baht Only" (ตัวพิมพ์ใหญ่ทุกคำ ตามแบบใบเสร็จสองภาษาที่ใช้กันในไทย) */
export const bahtTextEn = (amount) => {
  assertBaht(amount);
  if (amount === 0) return 'Zero Baht Only';

  const groups = [];
  let remaining = amount;
  for (let scale = 0; remaining > 0; scale += 1) {
    const chunk = remaining % 1000;
    if (chunk) {
      const unit = EN_SCALES[scale] ? ` ${EN_SCALES[scale]}` : '';
      groups.unshift(`${readEnglishBelowThousand(chunk)}${unit}`);
    }
    remaining = Math.floor(remaining / 1000);
  }
  return `${groups.join(' ')} Baht Only`;
};
