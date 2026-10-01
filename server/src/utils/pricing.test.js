import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZonePrices, priceSeats, toPriceMap, zonePriceFromBase } from './pricing.js';

test('ราคาต่อโซนคิดจากราคาฐานและปัดขึ้นเป็นหลักสิบ', () => {
  assert.equal(zonePriceFromBase(180, 'NORMAL'), 180);
  assert.equal(zonePriceFromBase(180, 'PREMIUM'), 260); // 180 * 1.4 = 252 → 260
  assert.equal(zonePriceFromBase(180, 'SOFA'), 400); // 180 * 2.2 = 396 → 400
});

test('buildZonePrices สร้างครบทุกโซน', () => {
  const prices = buildZonePrices(300);
  assert.deepEqual(
    prices.map((zone) => zone.zone).sort(),
    ['NORMAL', 'PREMIUM', 'SOFA'],
  );
  assert.equal(prices.find((zone) => zone.zone === 'NORMAL').price, 300);
});

test('toPriceMap ใช้ basePrice เป็นค่าสำรองเมื่อโซนนั้นไม่มีราคากำหนดไว้', () => {
  const map = toPriceMap([{ zone: 'PREMIUM', price: 999 }], 150);

  assert.equal(map.PREMIUM, 999);
  assert.equal(map.NORMAL, 150, 'โซนที่ไม่ได้กำหนดต้องตกกลับไปใช้ราคาฐาน');
  assert.equal(map.SOFA, 150);
});

test('priceSeats รวมราคาข้ามโซนได้ถูกต้อง', () => {
  const priceMap = { NORMAL: 180, PREMIUM: 260, SOFA: 400 };
  const seats = [
    { id: 'a', zone: 'NORMAL' },
    { id: 'b', zone: 'PREMIUM' },
    { id: 'c', zone: 'SOFA' },
  ];

  const { items, total } = priceSeats(seats, priceMap);

  assert.equal(total, 840);
  assert.deepEqual(items, [
    { seatId: 'a', price: 180 },
    { seatId: 'b', price: 260 },
    { seatId: 'c', price: 400 },
  ]);
});

test('ไม่เลือกที่นั่งเลย ยอดรวมต้องเป็นศูนย์', () => {
  assert.equal(priceSeats([], { NORMAL: 180 }).total, 0);
});
