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

export const addMinutes = (date, minutes) => {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
};

export const addHours = (date, hours) => {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
};
