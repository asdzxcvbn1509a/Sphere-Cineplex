import test from 'node:test';
import assert from 'node:assert/strict';
import { planSeatChange, sameZones } from './seatChange.js';
import { snapshotSeat } from './seats.js';

/** แถว Seat จากฐานข้อมูล — id ตั้งให้เรียงตามป้ายที่นั่ง จะได้อ่านผลลัพธ์ง่าย */
const seatRow = (label, zone) => ({
  id: `seat-${label}`,
  rowLabel: label[0],
  seatNumber: Number(label.slice(1)),
  zone,
});
const paid = (label, zone, price) => snapshotSeat(seatRow(label, zone), price);

// ราคาปัจจุบันของรอบ — ผู้ดูแลขึ้นราคาไปแล้วหลังลูกค้าจอง (ตอนจอง NORMAL 200 / PREMIUM 280)
const priceMap = { NORMAL: 220, PREMIUM: 300, SOFA: 480 };

test('ย้ายในโซนเดิมฟรีเสมอ แม้ราคารอบเปลี่ยนไปแล้ว — ที่นั่งใหม่ใช้ราคาที่จ่ายไว้', () => {
  const plan = planSeatChange({
    fromSeats: [paid('A1', 'NORMAL', 200), paid('A2', 'NORMAL', 200)],
    newSeats: [seatRow('A5', 'NORMAL'), seatRow('A6', 'NORMAL')],
    priceMap,
  });

  assert.equal(plan.diffAmount, 0);
  assert.equal(plan.toAmount, 400);
  assert.deepEqual(
    plan.toSeats.map((seat) => [seat.label, seat.price]),
    [['A5', 200], ['A6', 200]],
  );
  assert.deepEqual(plan.released, ['seat-A1', 'seat-A2']);
});

test('ย้ายไปโซนที่แพงกว่า — คิดราคาปัจจุบันของโซนใหม่ ลบราคาที่จ่ายไว้ของที่นั่งเดิม', () => {
  const plan = planSeatChange({
    fromSeats: [paid('A1', 'NORMAL', 200), paid('A2', 'NORMAL', 200)],
    newSeats: [seatRow('A1', 'NORMAL'), seatRow('B3', 'PREMIUM')],
    priceMap,
  });

  assert.equal(plan.fromAmount, 400);
  assert.equal(plan.toAmount, 500); // A1 เดิม 200 + B3 พรีเมียมราคาปัจจุบัน 300
  assert.equal(plan.diffAmount, 100);
  assert.deepEqual(plan.added, [{ seatId: 'seat-B3', price: 300 }]);
  assert.deepEqual(plan.released, ['seat-A2']);
});

test('ที่นั่งที่คงไว้ใช้รายการเดิมทั้งก้อน — ไม่ถูกคิดราคาใหม่', () => {
  const kept = paid('B1', 'PREMIUM', 280);
  const plan = planSeatChange({
    fromSeats: [kept, paid('B2', 'PREMIUM', 280)],
    newSeats: [seatRow('B1', 'PREMIUM'), seatRow('C4', 'SOFA')],
    priceMap,
  });

  assert.deepEqual(plan.toSeats[0], kept);
  assert.equal(plan.diffAmount, 480 - 280);
});

test('ย้ายไปโซนที่ถูกกว่า — ส่วนต่างติดลบ (ต้องคืนเงิน)', () => {
  const plan = planSeatChange({
    fromSeats: [paid('B1', 'PREMIUM', 280)],
    newSeats: [seatRow('A3', 'NORMAL')],
    priceMap,
  });

  assert.equal(plan.toAmount, 220);
  assert.equal(plan.diffAmount, -60);
});

test('ย้ายไปโซนที่มีอยู่แล้วในการจองเดียวกัน — ใช้ราคาที่จ่ายไว้ของโซนนั้น ไม่ใช่ราคาปัจจุบัน', () => {
  const plan = planSeatChange({
    fromSeats: [paid('A1', 'NORMAL', 200), paid('B1', 'PREMIUM', 280)],
    newSeats: [seatRow('A1', 'NORMAL'), seatRow('A2', 'NORMAL')],
    priceMap,
  });

  assert.equal(plan.toSeats[1].price, 200);
  assert.equal(plan.diffAmount, -80);
});

test('ที่นั่งใหม่เรียงตาม id เสมอ กันสองรายการรอกันเองจน deadlock', () => {
  const plan = planSeatChange({
    fromSeats: [paid('A1', 'NORMAL', 200), paid('A2', 'NORMAL', 200)],
    newSeats: [seatRow('A9', 'NORMAL'), seatRow('A7', 'NORMAL')],
    priceMap,
  });

  assert.deepEqual(
    plan.added.map((item) => item.seatId),
    ['seat-A7', 'seat-A9'],
  );
});

test('จำนวนที่นั่งไม่เท่าเดิม หรือเลือกชุดเดิมทุกที่ — ไม่ผ่าน', () => {
  const fromSeats = [paid('A1', 'NORMAL', 200), paid('A2', 'NORMAL', 200)];

  assert.throws(
    () => planSeatChange({ fromSeats, newSeats: [seatRow('A1', 'NORMAL')], priceMap }),
    (error) => error.code === 'SEAT_COUNT_MISMATCH' && error.details.required === 2,
  );
  assert.throws(
    () =>
      planSeatChange({
        fromSeats,
        newSeats: [seatRow('A2', 'NORMAL'), seatRow('A1', 'NORMAL')],
        priceMap,
      }),
    (error) => error.code === 'NO_SEAT_CHANGE',
  );
});

test('sameZones เทียบโซนครบทุกที่โดยไม่สนลำดับ', () => {
  const a = [paid('A1', 'NORMAL', 200), paid('B1', 'PREMIUM', 280)];
  assert.equal(sameZones(a, [paid('B4', 'PREMIUM', 280), paid('A7', 'NORMAL', 200)]), true);
  assert.equal(sameZones(a, [paid('A4', 'NORMAL', 200), paid('A7', 'NORMAL', 200)]), false);
});
