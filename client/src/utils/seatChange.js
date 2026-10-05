/**
 * ส่วนต่างราคาของการเปลี่ยนที่นั่ง — ไว้แสดงก่อนกดยืนยันเท่านั้น ยอดจริงให้ server คิด
 * ต้องตรงกับ planSeatChange ฝั่ง server (server/src/utils/seatChange.js)
 * - ที่นั่งที่คงไว้ ราคาเดิมที่จ่ายไว้
 * - ที่นั่งใหม่ในโซนที่การจองมีอยู่แล้ว ใช้ราคาที่จ่ายไว้ของโซนนั้น (ย้ายในโซนเดิมฟรีเสมอ)
 * - ที่นั่งใหม่ในโซนที่ยังไม่มี ใช้ราคาปัจจุบันของรอบ (ราคาในผังที่นั่ง)
 *
 * @param currentSeats ที่นั่งปัจจุบันของการจอง (booking.seats — มี id, zone, price ที่จ่ายไว้)
 * @param selectedSeats ที่นั่งที่เลือกจากผัง (มี id, zone, price ปัจจุบัน)
 */
export const previewSeatChange = (currentSeats, selectedSeats) => {
  const currentById = new Map(currentSeats.map((seat) => [seat.id, seat]));
  const paidByZone = {};
  for (const seat of currentSeats) paidByZone[seat.zone] ??= seat.price;

  const priceOf = (seat) => currentById.get(seat.id)?.price ?? paidByZone[seat.zone] ?? seat.price;
  const fromAmount = currentSeats.reduce((sum, seat) => sum + seat.price, 0);
  const toAmount = selectedSeats.reduce((sum, seat) => sum + priceOf(seat), 0);
  return { fromAmount, toAmount, diffAmount: toAmount - fromAmount };
};

/** โซนตรงกันครบทุกที่ — ผู้ดูแลย้ายแทนได้เฉพาะแบบนี้ (server ตรวจซ้ำอีกชั้น) */
export const sameZones = (a, b) => {
  const zones = (seats) => seats.map((seat) => seat.zone).sort().join();
  return zones(a) === zones(b);
};
