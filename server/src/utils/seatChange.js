import ApiError from './ApiError.js';
import { compareIds, snapshotSeat, sortSeats } from './seats.js';

/**
 * คำนวณการเปลี่ยนที่นั่ง — ส่วนที่ไม่แตะฐานข้อมูล เทสต์ได้ตรง ๆ (ตรวจสิทธิ์ ล็อก และบันทึกอยู่ที่ services/seatChanges.js)
 * หน้าเว็บมีสำเนากติการาคาชุดเดียวกันไว้แสดงส่วนต่างก่อนกดยืนยัน (client/src/utils/seatChange.js) — แก้ที่นี่ต้องแก้ที่นั่นด้วย
 *
 * กติการาคา
 * - ที่นั่งที่คงไว้ ใช้รายการเดิมใน snapshot ทั้งก้อน (ราคาที่จ่ายไว้)
 * - ที่นั่งใหม่ในโซนที่ลูกค้ามีอยู่แล้ว คิดราคาที่จ่ายไว้ของโซนนั้น → ย้ายในโซนเดิมฟรีเสมอ แม้ผู้ดูแลจะปรับราคารอบภายหลัง
 * - ที่นั่งใหม่ในโซนที่ยังไม่มี คิดราคาปัจจุบันของรอบ
 * ส่วนต่าง = ยอดใหม่ − ยอดเดิม (บวก = ลูกค้าโอนเพิ่ม · ลบ = คืนให้ลูกค้า)
 *
 * @param {object} args
 * @param {Array} args.fromSeats seatSnapshot ปัจจุบันของการจอง
 * @param {Array} args.newSeats แถว Seat ของชุดใหม่ทั้งหมด (รวมที่นั่งที่คงไว้) — ไม่ซ้ำกัน
 * @param {Record<string, number>} args.priceMap ราคาปัจจุบันของรอบต่อโซน (toPriceMap)
 */
export const planSeatChange = ({ fromSeats, newSeats, priceMap }) => {
  if (newSeats.length !== fromSeats.length) {
    throw ApiError.badRequest(
      'SEAT_COUNT_MISMATCH',
      `ต้องเลือกที่นั่งให้ครบ ${fromSeats.length} ที่ เท่ากับที่จองไว้`,
      { required: fromSeats.length },
    );
  }

  const fromById = new Map(fromSeats.map((seat) => [seat.id, seat]));
  const newIds = new Set(newSeats.map((seat) => seat.id));
  const released = fromSeats.filter((seat) => !newIds.has(seat.id)).map((seat) => seat.id);
  // จำนวนเท่ากันและไม่มีที่นั่งไหนถูกปล่อย = ชุดเดิมทุกที่
  if (released.length === 0) {
    throw ApiError.badRequest('NO_SEAT_CHANGE', 'ที่นั่งที่เลือกเป็นชุดเดิม ยังไม่ได้เปลี่ยนที่นั่ง');
  }

  // หนึ่งการจองมีราคาเดียวต่อโซนเสมอ (ทั้งตอนจองและหลังเปลี่ยนที่นั่ง) จึงหยิบราคาแรกที่เจอของแต่ละโซนได้เลย
  const paidByZone = {};
  for (const seat of fromSeats) paidByZone[seat.zone] ??= seat.price;

  const toSeats = sortSeats(newSeats).map(
    (seat) => fromById.get(seat.id) ?? snapshotSeat(seat, paidByZone[seat.zone] ?? priceMap[seat.zone]),
  );
  // บันทึกที่นั่งใหม่เรียงตาม id เสมอ แบบเดียวกับตอนจอง — สองรายการที่แย่งที่นั่งชุดเดียวกันจะชนกันที่ที่นั่งแรกเหมือนกัน
  // แทนที่จะรอกันเองจนเกิด deadlock
  const added = toSeats
    .filter((seat) => !fromById.has(seat.id))
    .map((seat) => ({ seatId: seat.id, price: seat.price }))
    .sort((a, b) => compareIds(a.seatId, b.seatId));

  const total = (seats) => seats.reduce((sum, seat) => sum + seat.price, 0);
  const fromAmount = total(fromSeats);
  const toAmount = total(toSeats);

  return { toSeats, fromAmount, toAmount, diffAmount: toAmount - fromAmount, added, released };
};

/** สองชุดมีโซนตรงกันครบทุกที่ (ไม่สนลำดับ) — ผู้ดูแลย้ายแทนได้เฉพาะแบบนี้ จึงไม่มีส่วนต่างราคา */
export const sameZones = (a, b) => {
  const zones = (seats) => seats.map((seat) => seat.zone).sort().join();
  return zones(a) === zones(b);
};
