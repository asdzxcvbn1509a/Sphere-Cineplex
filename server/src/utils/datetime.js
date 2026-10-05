/**
 * เก็บเวลาทั้งหมดใน DB เป็น UTC แต่ "วัน" ที่ผู้ใช้เห็นคือวันตามเวลาไทย
 * ไทยเป็น UTC+7 ตลอดปี (ไม่มี DST) จึงบวก offset ตรง ๆ ได้อย่างปลอดภัย
 */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** คืนคีย์วันแบบ YYYY-MM-DD ตามเวลาไทย */
export const bangkokDateKey = (date) => {
  return new Date(new Date(date).getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
};

/** ช่วงเวลา UTC ที่ครอบ "วันนั้นทั้งวัน" ตามเวลาไทย */
export const bangkokDayRange = (dateKey) => {
  const startUtcMs = Date.parse(`${dateKey}T00:00:00.000Z`) - BANGKOK_OFFSET_MS;
  if (Number.isNaN(startUtcMs)) return null;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + DAY_MS) };
};

/** รายการคีย์วันตามเวลาไทย เริ่มจากวันนี้ไปข้างหน้า n วัน */
export const upcomingDateKeys = (days = 7, from = new Date()) => {
  const keys = [];
  for (let i = 0; i < days; i += 1) {
    keys.push(bangkokDateKey(new Date(from.getTime() + i * DAY_MS)));
  }
  return keys;
};

/** วันเวลาแบบสั้นตามเวลาไทย ใช้ในข้อความแจ้งเตือน เช่น "2 ต.ค. 19:00" / "2 Oct, 19:00" */
export const formatBangkokShort = (date, lang = 'th') => {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
};

/** วันเวลาแบบเต็มตามเวลาไทย ใช้ในอีเมลใบเสร็จ เช่น "2 ตุลาคม 2569 เวลา 19:05" / "2 October 2026 at 19:05" */
export const formatBangkokLong = (date, lang = 'th') => {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
};

export const addMinutes = (date, minutes) => {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
};

export const addHours = (date, hours) => {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
};
