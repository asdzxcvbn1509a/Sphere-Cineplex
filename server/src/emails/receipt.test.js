import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptEmail } from './receipt.js';

const receipt = {
  receiptNo: 'RC-2026-000042',
  issuedAt: new Date('2026-10-02T12:05:00Z'),
  issuer: { name: 'Sphere Cineplex', address: null },
  customer: { name: '<b>สมชาย</b>' },
  booking: { id: 'b1', code: 'TRS-ABC234', status: 'PAID' },
  showtime: {
    startsAt: new Date('2026-10-03T12:00:00Z'),
    movie: { titleTh: 'ฤดูฝนที่หายไป', titleEn: 'The Vanished Monsoon' },
    theatre: { name: 'Theatre 1' },
  },
  lines: [{ zone: 'PREMIUM', unitPrice: 280, quantity: 2, amount: 560, seats: ['B1', 'B2'] }],
  totalAmount: 560,
  amountTextTh: 'ห้าร้อยหกสิบบาทถ้วน',
  amountTextEn: 'Five Hundred Sixty Baht Only',
  payment: { method: 'PROMPTPAY', reference: '12345678' },
  refund: null,
};

const urls = {
  receiptUrl: 'http://localhost:5173/booking/b1/receipt',
  ticketUrl: 'http://localhost:5173/booking/b1/ticket',
};

test('หัวเรื่องมีเลขที่ใบเสร็จและชื่อผู้ออก ลูกค้าค้นในกล่องจดหมายเจอ', () => {
  const { subject } = receiptEmail({ receipt, ...urls });
  assert.ok(subject.includes('RC-2026-000042'));
  assert.ok(subject.includes('Sphere Cineplex'));
});

test('เนื้อความแบบข้อความล้วนมียอดเงิน จำนวนเงินเป็นตัวอักษร ที่นั่ง และลิงก์ไปใบเสร็จฉบับเต็ม', () => {
  const { text } = receiptEmail({ receipt, ...urls });
  assert.ok(text.includes('560.00'));
  assert.ok(text.includes('ห้าร้อยหกสิบบาทถ้วน'));
  assert.ok(text.includes('B1, B2'));
  assert.ok(text.includes(urls.receiptUrl));
  assert.ok(text.includes(urls.ticketUrl));
});

test('ค่าที่มาจากผู้ใช้ถูก escape ก่อนลง HTML', () => {
  const { html } = receiptEmail({ receipt, ...urls });
  assert.ok(html.includes('&lt;b&gt;สมชาย&lt;/b&gt;'));
  assert.ok(!html.includes('<b>สมชาย</b>'));
  assert.ok(html.includes(`href="${urls.receiptUrl}"`));
});

test('ไม่มีที่อยู่ผู้ออกก็ไม่เว้นบรรทัดว่างไว้ · มีก็แสดง', () => {
  const without = receiptEmail({ receipt, ...urls });
  const withAddress = receiptEmail({
    receipt: { ...receipt, issuer: { name: 'Sphere Cineplex', address: '99 ถนนตัวอย่าง' } },
    ...urls,
  });
  assert.ok(!without.text.split('\n').slice(0, 2).includes(''));
  assert.ok(withAddress.text.includes('99 ถนนตัวอย่าง'));
  assert.ok(withAddress.html.includes('99 ถนนตัวอย่าง'));
});

test('ใบเสร็จส่วนต่างเปลี่ยนที่นั่งบอกว่าย้ายจากที่นั่งไหนไปไหน', () => {
  const { text, html } = receiptEmail({
    receipt: {
      ...receipt,
      kind: 'SEAT_CHANGE_TOPUP',
      lines: [{ kind: 'SEAT_CHANGE', fromSeats: ['A1', 'A2'], toSeats: ['C1', 'C2'], quantity: 1, unitPrice: 160, amount: 160 }],
      totalAmount: 160,
    },
    ...urls,
  });
  assert.ok(text.includes('A1, A2 → C1, C2'));
  assert.ok(text.includes('Seat change'));
  assert.ok(html.includes('A1, A2 → C1, C2'));
});
