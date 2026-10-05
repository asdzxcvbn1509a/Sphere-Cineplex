import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReceiptNo, receiptLines, receiptYear, shapeReceipt } from './receipt.js';

const seat = (label, zone, price) => ({ id: `seat-${label}`, label, zone, price });

const paidBooking = (overrides = {}) => ({
  id: 'b1',
  userId: 'u1',
  code: 'TRS-ABC234',
  status: 'PAID',
  paidAt: new Date('2026-10-02T12:00:00Z'),
  seatSnapshot: [seat('A1', 'NORMAL', 200), seat('B1', 'PREMIUM', 280), seat('B2', 'PREMIUM', 280)],
  user: { id: 'u1', name: 'ชื่อปัจจุบัน', email: 'u1@test.local' },
  showtime: {
    startsAt: new Date('2026-10-03T12:00:00Z'),
    movie: { titleTh: 'ฤดูฝนที่หายไป', titleEn: 'The Vanished Monsoon' },
    theatre: { name: 'Theatre 1' },
  },
  ...overrides,
  payment: {
    method: 'PROMPTPAY',
    reference: '12345678',
    amount: 760,
    status: 'APPROVED',
    receiptNo: 'RC-2026-000001',
    receiptName: 'ชื่อตอนจ่าย',
    refundedAt: null,
    ...overrides.payment,
  },
});

test('เลขที่ใบเสร็จเติมศูนย์ให้ครบ 6 หลัก และไม่ตัดทิ้งเมื่อเกิน', () => {
  assert.equal(formatReceiptNo(2026, 123), 'RC-2026-000123');
  assert.equal(formatReceiptNo(2026, 1_234_567), 'RC-2026-1234567');
});

test('ปีของเลขที่ใบเสร็จนับตามเวลาไทย ไม่ใช่ UTC', () => {
  // 23:59 ของ 31 ธ.ค. ตามเวลาไทย ยังเป็นปีเดิม
  assert.equal(receiptYear(new Date('2026-12-31T16:59:59.999Z')), 2026);
  // 00:00 ของ 1 ม.ค. ตามเวลาไทย (ยังเป็น 31 ธ.ค. ตามเวลา UTC) ต้องขึ้นปีใหม่แล้ว
  assert.equal(receiptYear(new Date('2026-12-31T17:00:00Z')), 2027);
});

test('receiptLines รวมที่นั่งโซนและราคาเดียวกันเป็นบรรทัดเดียว และยอดรวมไม่เพี้ยน', () => {
  const seats = [seat('A1', 'NORMAL', 200), seat('B1', 'PREMIUM', 280), seat('B2', 'PREMIUM', 280)];
  const lines = receiptLines(seats);

  assert.deepEqual(lines, [
    { kind: 'SEATS', zone: 'NORMAL', unitPrice: 200, quantity: 1, amount: 200, seats: ['A1'] },
    { kind: 'SEATS', zone: 'PREMIUM', unitPrice: 280, quantity: 2, amount: 560, seats: ['B1', 'B2'] },
  ]);
  assert.equal(
    lines.reduce((sum, line) => sum + line.amount, 0),
    seats.reduce((sum, item) => sum + item.price, 0),
  );
});

test('receiptLines แยกบรรทัดเมื่อโซนเดียวกันแต่ราคาต่างกัน', () => {
  const lines = receiptLines([seat('A1', 'NORMAL', 200), seat('A2', 'NORMAL', 180)]);
  assert.equal(lines.length, 2);
});

test('shapeReceipt ใช้ชื่อที่เก็บไว้ตอนออกใบเสร็จ ไม่ใช่ชื่อปัจจุบันของผู้ใช้', () => {
  const receipt = shapeReceipt(paidBooking(), { name: 'Sphere Cineplex' });

  assert.equal(receipt.customer.name, 'ชื่อตอนจ่าย');
  assert.equal(receipt.receiptNo, 'RC-2026-000001');
  assert.equal(receipt.booking.userId, 'u1');
  assert.equal(receipt.totalAmount, 760);
  assert.equal(receipt.amountTextTh, 'เจ็ดร้อยหกสิบบาทถ้วน');
  assert.equal(receipt.amountTextEn, 'Seven Hundred Sixty Baht Only');
  assert.deepEqual(receipt.issuer, { name: 'Sphere Cineplex', address: null });
  assert.equal(receipt.lines.length, 2);
  assert.equal(receipt.refund, null);
});

test('shapeReceipt ใส่สถานะคืนเงินเมื่อยกเลิกหลังจ่ายแล้ว', () => {
  const refundedAt = new Date('2026-10-04T03:00:00Z');
  const pending = shapeReceipt(
    paidBooking({ status: 'CANCELLED', payment: { status: 'REFUND_PENDING' } }),
    { name: 'Sphere Cineplex' },
  );
  const refunded = shapeReceipt(
    paidBooking({ status: 'CANCELLED', payment: { status: 'REFUNDED', refundedAt } }),
    { name: 'Sphere Cineplex', address: '123 ถนนตัวอย่าง' },
  );

  assert.deepEqual(pending.refund, { status: 'REFUND_PENDING', refundedAt: null });
  assert.deepEqual(refunded.refund, { status: 'REFUNDED', refundedAt });
  assert.equal(refunded.issuer.address, '123 ถนนตัวอย่าง');
  // เลขที่ใบเสร็จเดิมยังอยู่ — ใบเสร็จเป็นหลักฐานว่ารับเงินมาจริง ไม่ได้หายไปเพราะคืนเงิน
  assert.equal(refunded.receiptNo, 'RC-2026-000001');
});

test('shapeReceipt ใช้ที่นั่งที่ตรึงไว้ตอนออกใบเสร็จ และบอกที่นั่งปัจจุบันเมื่อเปลี่ยนที่นั่งภายหลัง', () => {
  const unchanged = shapeReceipt(
    paidBooking({ payment: { receiptSeats: paidBooking().seatSnapshot } }),
    { name: 'Sphere Cineplex' },
  );
  assert.equal(unchanged.seatsChangedTo, null);

  // ย้าย A1 → A4 หลังออกใบเสร็จ (ราคาเท่าเดิม)
  const moved = shapeReceipt(
    paidBooking({
      seatSnapshot: [seat('A4', 'NORMAL', 200), seat('B1', 'PREMIUM', 280), seat('B2', 'PREMIUM', 280)],
      payment: { receiptSeats: paidBooking().seatSnapshot },
    }),
    { name: 'Sphere Cineplex' },
  );
  assert.deepEqual(moved.lines[0].seats, ['A1']);
  assert.deepEqual(moved.seatsChangedTo, ['A4', 'B1', 'B2']);
  assert.equal(moved.totalAmount, 760);
});

test('shapeReceipt ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง — บรรทัดเดียว from → to วันที่ตามเวลาอนุมัติ และตราคืนเงินตามใบหลัก', () => {
  const verifiedAt = new Date('2026-10-02T15:00:00Z');
  const topUp = {
    kind: 'SEAT_CHANGE_TOPUP',
    method: 'PROMPTPAY',
    reference: '87654321',
    amount: 80,
    status: 'APPROVED',
    receiptNo: 'RC-2026-000002',
    receiptName: 'ชื่อตอนจ่าย',
    verifiedAt,
    seatChange: {
      fromSeats: [seat('A1', 'NORMAL', 200)],
      toSeats: [seat('C1', 'PREMIUM', 280)],
    },
  };

  const receipt = shapeReceipt(paidBooking(), { name: 'Sphere Cineplex' }, topUp);
  assert.equal(receipt.kind, 'SEAT_CHANGE_TOPUP');
  assert.equal(receipt.receiptNo, 'RC-2026-000002');
  assert.deepEqual(receipt.issuedAt, verifiedAt);
  assert.deepEqual(receipt.lines, [
    { kind: 'SEAT_CHANGE', fromSeats: ['A1'], toSeats: ['C1'], quantity: 1, unitPrice: 80, amount: 80 },
  ]);
  assert.equal(receipt.totalAmount, 80);
  assert.equal(receipt.amountTextTh, 'แปดสิบบาทถ้วน');
  assert.equal(receipt.payment.reference, '87654321');
  assert.equal(receipt.seatsChangedTo, null);
  assert.equal(receipt.refund, null);

  // ยกเลิกการจองแล้ว — คืนเป็นยอดสุทธิบนใบหลัก ใบเสร็จส่วนต่างต้องขึ้นตราเดียวกัน
  const cancelled = shapeReceipt(
    paidBooking({ status: 'CANCELLED', payment: { status: 'REFUND_PENDING' } }),
    { name: 'Sphere Cineplex' },
    topUp,
  );
  assert.deepEqual(cancelled.refund, { status: 'REFUND_PENDING', refundedAt: null });
});
