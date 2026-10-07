const TIME_ZONE = 'Asia/Bangkok';

const localeOf = (lang) => {
  return lang === 'en' ? 'en-GB' : 'th-TH';
};

/** options ส่งต่อให้ Intl.NumberFormat เช่น ใบเสร็จใช้ทศนิยม 2 ตำแหน่ง */
export const formatMoney = (amount, lang = 'th', options) => {
  return new Intl.NumberFormat(localeOf(lang), options).format(Number(amount ?? 0));
};

export const formatDate = (value, lang = 'th', options) => {
  if (!value) return '';
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(new Date(value));
};

export const formatTime = (value, lang = 'th') => {
  if (!value) return '';
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
};

export const formatDateTime = (value, lang = 'th') => {
  if (!value) return '';
  return `${formatDate(value, lang)} · ${formatTime(value, lang)}`;
};

export const formatWeekday = (value, lang = 'th') => {
  if (!value) return '';
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(new Date(value));
};

/** วินาที → mm:ss สำหรับ countdown ของการกันที่นั่ง */
export const formatCountdown = (totalSeconds) => {
  const safe = Math.max(0, Math.floor(totalSeconds ?? 0));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/** คีย์วัน YYYY-MM-DD ตามเวลาไทย (ต้องตรงกับฝั่ง server) */
export const bangkokDateKey = (value = new Date()) => {
  const date = new Date(value);
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

export const dateKeyToDate = (dateKey) => {
  return new Date(`${dateKey}T00:00:00+07:00`);
};

/**
 * ค่าของ input[type=datetime-local] — input ทำงานบนเวลาเครื่อง จึงต้องแปลงเป็น/จากเวลาไทยให้ชัดเจน
 * ISO → "YYYY-MM-DDTHH:mm" ตามเวลาไทย
 */
export const toBangkokInputValue = (iso) => {
  const bangkok = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 16);
};

/** "YYYY-MM-DDTHH:mm" (เวลาไทย) → ISO */
export const fromBangkokInputValue = (value) => new Date(`${value}:00+07:00`).toISOString();

/** ดึงเฉพาะส่วนวันที่ (YYYY-MM-DD) ออกจากค่าใน input datetime-local */
export const dateOfInputValue = (value) => (value ? value.slice(0, 10) : '');

/** สร้างรายการวันสำหรับแถบเลือกวันที่ */
export const buildDateStrip = (days = 7) => {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() + index * 24 * 60 * 60 * 1000);
    return { key: bangkokDateKey(date), offset: index };
  });
};
