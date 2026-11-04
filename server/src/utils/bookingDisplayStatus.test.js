import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_STATUSES,
  anyDisplayStatusWhere,
  displayStatusOf,
  displayStatusWhere,
} from './bookingDisplayStatus.js';

const money = (kind, status) => ({ kind, status });
const change = (status, payment = null) => ({ status, payment });

/** แถวการจองรูปเดียวกับที่ Prisma โหลดด้วย bookingInclude — ค่าเริ่มต้นคือใบที่จ่ายแล้วและไม่มีอะไรค้าง */
const booking = ({ status = 'PAID', payment = money('BOOKING', 'APPROVED'), seatChanges = [] } = {}) => {
  return { status, payment, seatChanges };
};

test('ป้ายจากสถานะของการจองตรง ๆ', () => {
  assert.equal(
    displayStatusOf(booking({ status: 'PENDING_PAYMENT', payment: money('BOOKING', 'AWAITING_SLIP') })),
    'PENDING_PAYMENT',
  );
  assert.equal(
    displayStatusOf(booking({ status: 'PENDING_VERIFICATION', payment: money('BOOKING', 'PENDING_VERIFICATION') })),
    'PENDING_VERIFICATION',
  );
  assert.equal(displayStatusOf(booking()), 'PAID');
  assert.equal(
    displayStatusOf(booking({ status: 'CANCELLED', payment: money('BOOKING', 'REJECTED') })),
    'CANCELLED',
  );
  assert.equal(displayStatusOf(booking({ status: 'EXPIRED', payment: money('BOOKING', 'REJECTED') })), 'EXPIRED');
  // แถวที่ไม่มีรายการเงินหรือไม่ได้ include คำขอเปลี่ยนที่นั่งมาก็ต้องไม่พัง
  assert.equal(displayStatusOf({ status: 'CANCELLED', payment: null }), 'CANCELLED');
});

test('สลิปค่าตั๋วที่ส่งหลังหมดเวลา — การจองยัง EXPIRED แต่ป้ายเป็นรอตรวจสอบสลิป', () => {
  const late = booking({ status: 'EXPIRED', payment: money('BOOKING', 'PENDING_VERIFICATION') });
  assert.equal(displayStatusOf(late), 'PENDING_VERIFICATION');
});

test('ส่วนต่างเปลี่ยนที่นั่ง — รอโอน · สลิปรอตรวจ (ทั้งคำขอที่เปิดอยู่และสลิปส่งช้า) · รอคืน', () => {
  const awaitingTopUp = booking({
    seatChanges: [change('PENDING_PAYMENT', money('SEAT_CHANGE_TOPUP', 'AWAITING_SLIP'))],
  });
  assert.equal(displayStatusOf(awaitingTopUp), 'TOPUP_PENDING_PAYMENT');

  const topUpReview = booking({
    seatChanges: [change('PENDING_VERIFICATION', money('SEAT_CHANGE_TOPUP', 'PENDING_VERIFICATION'))],
  });
  assert.equal(displayStatusOf(topUpReview), 'TOPUP_PENDING_VERIFICATION');

  const lateTopUp = booking({
    seatChanges: [change('EXPIRED', money('SEAT_CHANGE_TOPUP', 'PENDING_VERIFICATION'))],
  });
  assert.equal(displayStatusOf(lateTopUp), 'TOPUP_PENDING_VERIFICATION');

  const cheaperSeats = booking({
    seatChanges: [change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUND_PENDING'))],
  });
  assert.equal(displayStatusOf(cheaperSeats), 'DIFF_REFUND_PENDING');

  // ส่วนต่างที่โอนหลังหมดเวลาแล้วที่นั่งไม่ว่าง — ผู้ดูแลยืนยันยอดแล้วต้องคืน
  const lateTopUpRefund = booking({
    seatChanges: [change('EXPIRED', money('SEAT_CHANGE_TOPUP', 'REFUND_PENDING'))],
  });
  assert.equal(displayStatusOf(lateTopUpRefund), 'DIFF_REFUND_PENDING');
});

test('ย้ายฟรีหรือจ่ายส่วนต่างจบแล้ว ยังเป็นชำระเงินสำเร็จ', () => {
  assert.equal(displayStatusOf(booking({ seatChanges: [change('COMPLETED')] })), 'PAID');
  assert.equal(
    displayStatusOf(booking({ seatChanges: [change('COMPLETED', money('SEAT_CHANGE_TOPUP', 'APPROVED'))] })),
    'PAID',
  );
  // คำขอที่ปิดไปโดยไม่ได้ย้าย (ยังไม่ส่งสลิป) ไม่มีเงินค้าง
  assert.equal(
    displayStatusOf(booking({ seatChanges: [change('CANCELLED', money('SEAT_CHANGE_TOPUP', 'REJECTED'))] })),
    'PAID',
  );
});

test('การจองที่ปิดแล้วรอเงินคืน — แยกยกเลิกกับหมดเวลา', () => {
  assert.equal(
    displayStatusOf(booking({ status: 'CANCELLED', payment: money('BOOKING', 'REFUND_PENDING') })),
    'CANCELLED_REFUND_PENDING',
  );
  assert.equal(
    displayStatusOf(booking({ status: 'EXPIRED', payment: money('BOOKING', 'REFUND_PENDING') })),
    'EXPIRED_REFUND_PENDING',
  );
});

test('คืนเงินสำเร็จ — ใบที่ปิดแล้ว และใบที่ยังใช้ได้แต่คืนส่วนต่างไปแล้ว', () => {
  assert.equal(
    displayStatusOf(booking({ status: 'CANCELLED', payment: money('BOOKING', 'REFUNDED') })),
    'REFUNDED',
  );
  assert.equal(displayStatusOf(booking({ status: 'EXPIRED', payment: money('BOOKING', 'REFUNDED') })), 'REFUNDED');
  assert.equal(
    displayStatusOf(booking({ seatChanges: [change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUNDED'))] })),
    'REFUNDED',
  );
});

test('ลำดับกฎ — เรื่องที่ยังค้างชนะเรื่องที่จบไปแล้ว', () => {
  const refunded = change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUNDED'));

  // คืนส่วนต่างรอบแรกไปแล้ว แต่ย้ายไปที่ถูกกว่าอีกรอบ
  const refundAgain = booking({
    seatChanges: [refunded, change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUND_PENDING'))],
  });
  assert.equal(displayStatusOf(refundAgain), 'DIFF_REFUND_PENDING');

  // คืนส่วนต่างไปแล้ว แล้วขอย้ายไปที่แพงกว่าซึ่งยังไม่โอน
  const topUpAfterRefund = booking({
    seatChanges: [refunded, change('PENDING_PAYMENT', money('SEAT_CHANGE_TOPUP', 'AWAITING_SLIP'))],
  });
  assert.equal(displayStatusOf(topUpAfterRefund), 'TOPUP_PENDING_PAYMENT');

  // สลิปที่รอผู้ดูแลตรวจมาก่อนเงินที่รอโอนคืน
  const slipAndRefund = booking({
    seatChanges: [
      change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUND_PENDING')),
      change('EXPIRED', money('SEAT_CHANGE_TOPUP', 'PENDING_VERIFICATION')),
    ],
  });
  assert.equal(displayStatusOf(slipAndRefund), 'TOPUP_PENDING_VERIFICATION');

  // ยกเลิกแล้ว: เงินก้อนไหนยังไม่คืนก็ยังรอเงินคืน — ใบหลักหรือส่วนต่างก็ตาม
  const mainPending = booking({
    status: 'CANCELLED',
    payment: money('BOOKING', 'REFUND_PENDING'),
    seatChanges: [refunded],
  });
  assert.equal(displayStatusOf(mainPending), 'CANCELLED_REFUND_PENDING');
  const diffPending = booking({
    status: 'CANCELLED',
    payment: money('BOOKING', 'REFUNDED'),
    seatChanges: [change('COMPLETED', money('SEAT_CHANGE_REFUND', 'REFUND_PENDING'))],
  });
  assert.equal(displayStatusOf(diffPending), 'CANCELLED_REFUND_PENDING');
});

test('ค่าที่เป็นไปได้ไม่ซ้ำกัน และเงื่อนไขกรองตัดทุกกฎที่มาก่อนออก', () => {
  assert.equal(new Set(DISPLAY_STATUSES).size, DISPLAY_STATUSES.length);
  assert.equal(DISPLAY_STATUSES.length, 11);

  // กฎแรกไม่มีอะไรต้องตัด
  assert.deepEqual(displayStatusWhere('PENDING_PAYMENT'), { status: 'PENDING_PAYMENT' });

  const refunded = displayStatusWhere('REFUNDED');
  assert.deepEqual(refunded.AND, [{ payments: { some: { status: 'REFUNDED' } } }]);
  assert.equal(refunded.NOT.length, DISPLAY_STATUSES.indexOf('REFUNDED'));

  const expired = displayStatusWhere('EXPIRED');
  assert.equal(expired.NOT.length, DISPLAY_STATUSES.length - 1);

  assert.throws(() => displayStatusWhere('NOPE'));
});

test('กรองเป็นกลุ่ม — ป้ายเดียวได้เงื่อนไขเดิม หลายป้าย OR กัน และค่าซ้ำถูกตัด', () => {
  assert.deepEqual(anyDisplayStatusWhere(['PAID']), displayStatusWhere('PAID'));
  assert.deepEqual(anyDisplayStatusWhere(['PENDING_PAYMENT', 'TOPUP_PENDING_PAYMENT']), {
    OR: [displayStatusWhere('PENDING_PAYMENT'), displayStatusWhere('TOPUP_PENDING_PAYMENT')],
  });
  assert.deepEqual(anyDisplayStatusWhere(['EXPIRED', 'EXPIRED']), displayStatusWhere('EXPIRED'));
  assert.throws(() => anyDisplayStatusWhere(['PAID', 'NOPE']));
});
