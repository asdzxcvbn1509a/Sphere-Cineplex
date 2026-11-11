import { BANGKOK_OFFSET_MS, bangkokDateKey, bangkokDayRange } from '../../src/utils/datetime.js';
import { TURNAROUND_MINUTES } from '../../src/services/showtimes.js';

/** มีรอบย้อนหลังกี่วัน (หน้ารายงานเปิดมาที่ 7 วันล่าสุด จึงเผื่อไว้ให้เลื่อนดูได้อีกนิด) และล่วงหน้ากี่วัน (รวมวันนี้) */
export const HISTORY_DAYS = 10;
export const DAYS_AHEAD = 7;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** รอบสุดท้ายต้องจบภายในเที่ยงคืน — ช่วงเดียวกับที่หน้าลงรอบของผู้ดูแลเสนอให้ (getAvailability) */
const CLOSE_HOUR = 24;

/** ชั่วโมงตามเวลาไทยของเวลานั้น */
export const bangkokHour = (date) => new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCHours();

/** วันในสัปดาห์ตามเวลาไทย (0 = อาทิตย์) */
export const bangkokWeekday = (date) => new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCDay();

/** คีย์วันที่ (YYYY-MM-DD ตามเวลาไทย) ที่ห่างจากวันนี้ offset วัน */
export const dayKeyFrom = (now, offset) => bangkokDateKey(new Date(now.getTime() + offset * DAY));

/**
 * ราคาตั้งต้นของรอบ — เสาร์อาทิตย์ +20 · วันธรรมดารอบก่อนบ่ายโมง −20
 * ราคาต่อโซนสร้างจากค่านี้ด้วย buildZonePrices แบบเดียวกับตอนผู้ดูแลลงรอบเอง
 */
export const showtimePrice = (theatre, startsAt) => {
  const weekday = bangkokWeekday(startsAt);
  if (weekday === 0 || weekday === 6) return theatre.basePrice + 20;
  if (bangkokHour(startsAt) < 13) return theatre.basePrice - 20;
  return theatre.basePrice;
};

/**
 * หนังเรื่องนี้มีรอบในวันที่ day (นับจากวันนี้) ได้ไหม — เข้าฉายแล้วและยังไม่เลิกฉาย
 * หนัง "เร็ว ๆ นี้" ไม่มีรอบเลย เพราะหน้าเว็บยังไม่เปิดขายบัตรเรื่องที่สถานะเป็น COMING_SOON
 */
const showingOn = (movie, day) => {
  if (movie.status === 'COMING_SOON') return false;
  return movie.releaseInDays <= day && (movie.lastShowInDays ?? Infinity) >= day;
};

/**
 * จัดตารางรอบของทุกโรง ตั้งแต่ HISTORY_DAYS วันก่อนถึง DAYS_AHEAD วันข้างหน้า
 * แต่ละโรงเริ่มรอบแรกตาม opensAt แล้วต่อรอบถัดไปหลังรอบก่อนจบ + เวลาทำความสะอาด (TURNAROUND_MINUTES) + ช่วงพักสุ่ม
 * กติกาเดียวกับ assertNoOverlap จึงไม่มีรอบไหนชนกัน และเวลาเริ่มไม่ซ้ำกันทุกวัน
 *
 * movies/theatres = แถวที่บันทึกแล้ว (มี id) พร้อมฟิลด์เสริมจาก catalog.js
 * @returns {Array<{ movie, theatre, startsAt: Date, endsAt: Date, basePrice: number }>}
 */
export const buildSchedule = ({ movies, theatres, random, now }) => {
  const shows = [];

  for (let day = -HISTORY_DAYS; day < DAYS_AHEAD; day += 1) {
    const { start } = bangkokDayRange(dayKeyFrom(now, day));
    const closeMs = start.getTime() + CLOSE_HOUR * 60 * MINUTE;

    for (const theatre of theatres) {
      if (theatre.closedFromDay !== undefined && day >= theatre.closedFromDay) continue;
      const eligible = movies.filter(
        (movie) => movie.formats.includes(theatre.screenType) && showingOn(movie, day),
      );
      if (eligible.length === 0) continue;

      const [openHour, openMinute] = theatre.opensAt;
      let cursor = start.getTime() + (openHour * 60 + openMinute) * MINUTE;
      let previous = null;

      for (;;) {
        // ปัดเวลาเริ่มเป็นทุก 5 นาที ให้ดูเป็นตารางรอบจริง
        const startMs = Math.ceil(cursor / (5 * MINUTE)) * 5 * MINUTE;
        const fits = eligible.filter((movie) => startMs + movie.durationMin * MINUTE <= closeMs);
        if (fits.length === 0) break;
        // ไม่ฉายเรื่องเดิมติดกันสองรอบในโรงเดียว ถ้ายังมีเรื่องอื่นให้เลือก
        const pool = fits.length > 1 ? fits.filter((movie) => movie !== previous) : fits;
        const movie = random.weighted(pool, (item) => item.popularity);

        const startsAt = new Date(startMs);
        const endsAt = new Date(startMs + movie.durationMin * MINUTE);
        shows.push({ movie, theatre, startsAt, endsAt, basePrice: showtimePrice(theatre, startsAt) });

        previous = movie;
        cursor = endsAt.getTime() + (TURNAROUND_MINUTES + random.int(2, 8) * 5) * MINUTE;
      }
    }
  }

  return shows;
};
