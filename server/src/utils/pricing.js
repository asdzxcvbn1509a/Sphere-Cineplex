/**
 * คิดราคาที่นั่งจากราคาโซนของรอบฉายนั้น
 * ถ้าโซนไหนไม่ได้กำหนดราคาไว้ ให้ตกกลับไปใช้ basePrice ของรอบ
 */

/** ตัวคูณราคาต่อโซน ใช้ตอนสร้างรอบฉายเพื่อ generate ZonePrice อัตโนมัติ */
export const ZONE_MULTIPLIER = {
  NORMAL: 1,
  PREMIUM: 1.4,
  SOFA: 2.2,
};

export const SEAT_ZONES = Object.keys(ZONE_MULTIPLIER);

/** ปัดราคาขึ้นเป็นหลักสิบบาท ให้ตัวเลขดูเป็นราคาตั๋วจริง (เช่น 180, 260, 400) */
export const zonePriceFromBase = (basePrice, zone) => {
  const multiplier = ZONE_MULTIPLIER[zone] ?? 1;
  return Math.ceil((basePrice * multiplier) / 10) * 10;
};

export const buildZonePrices = (basePrice) => {
  return SEAT_ZONES.map((zone) => ({ zone, price: zonePriceFromBase(basePrice, zone) }));
};

/** แปลง ZonePrice[] เป็น map { NORMAL: 180, ... } พร้อม fallback ทุกโซน */
export const toPriceMap = (zonePrices, basePrice) => {
  const map = {};
  for (const zone of SEAT_ZONES) map[zone] = basePrice;
  for (const zp of zonePrices ?? []) map[zp.zone] = zp.price;
  return map;
};

/**
 * คิดราคารวมของที่นั่งที่เลือก
 * @returns {{ items: Array<{seatId: string, price: number}>, total: number }}
 */
export const priceSeats = (seats, priceMap) => {
  const items = seats.map((seat) => ({
    seatId: seat.id,
    price: priceMap[seat.zone] ?? 0,
  }));
  const total = items.reduce((sum, item) => sum + item.price, 0);
  return { items, total };
};
