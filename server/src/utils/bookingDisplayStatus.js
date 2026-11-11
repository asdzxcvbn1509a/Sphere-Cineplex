/**
 * สถานะที่หน้า "การจอง" ของผู้ดูแลแสดงเป็นป้ายและใช้กรอง — ละเอียดกว่าสถานะของการจองเอง
 * เรื่องเงินที่ยังค้าง (ส่วนต่างเปลี่ยนที่นั่ง เงินที่รอโอนคืน) ไม่ได้ทำให้สถานะการจองเปลี่ยน
 * แต่ผู้ดูแลต้องเห็นจากตารางเลยว่าใบนี้รออะไรอยู่ โดยไม่ต้องเปิดดูทีละใบ
 *
 * กฎเรียงตามลำดับ ข้อแรกที่ตรงชนะ: ลูกค้าต้องจ่าย → สลิปรอตรวจ → เงินรอโอนคืน → คืนแล้ว → สถานะของการจอง
 * แต่ละข้อเขียนเงื่อนไขไว้สองแบบติดกัน — matches ใช้กับแถวที่โหลดมาแล้ว (ป้ายในตาราง) · where ใช้กรองในฐานข้อมูล
 * สองแบบต้องตรงกันเสมอ ไม่งั้นเลือกตัวกรองแล้วจะได้แถวที่ป้ายไม่ตรงกับที่เลือก (integration test ตรวจทุกค่า)
 */

/** รายการเงินทั้งหมดของการจอง = ใบหลัก + ส่วนต่างของคำขอเปลี่ยนที่นั่ง (ชุดเดียวกับ relation payments ใน where) */
const paymentsOf = (booking) => {
  return [booking.payment, ...(booking.seatChanges ?? []).map((change) => change.payment)].filter(Boolean);
};

const hasPayment = (booking, predicate) => paymentsOf(booking).some(predicate);

/** ป้ายที่มาจากสถานะของการจองตรง ๆ */
const byBookingStatus = (status) => ({
  status,
  matches: (booking) => booking.status === status,
  where: { status },
});

/**
 * มีเงินรอโอนคืน — แยกป้ายตามสถานะการจอง
 * ใบที่ยังใช้ได้ (PAID) ใบหลักยัง APPROVED อยู่ เงินที่รอคืนจึงเป็นส่วนต่างเปลี่ยนที่นั่งเสมอ
 */
const refundPending = (status, bookingStatus) => ({
  status,
  matches: (booking) =>
    booking.status === bookingStatus && hasPayment(booking, (payment) => payment.status === 'REFUND_PENDING'),
  where: { status: bookingStatus, payments: { some: { status: 'REFUND_PENDING' } } },
});

const RULES = [
  byBookingStatus('PENDING_PAYMENT'),
  byBookingStatus('PENDING_VERIFICATION'),
  {
    status: 'TOPUP_PENDING_PAYMENT',
    matches: (booking) =>
      booking.status === 'PAID' &&
      (booking.seatChanges ?? []).some((change) => change.status === 'PENDING_PAYMENT'),
    where: { status: 'PAID', seatChanges: { some: { status: 'PENDING_PAYMENT' } } },
  },
  {
    // สลิปส่วนต่างเปลี่ยนที่นั่งรอผู้ดูแลตรวจ (การจองยัง PAID ระหว่างนั้น)
    status: 'TOPUP_PENDING_VERIFICATION',
    matches: (booking) =>
      hasPayment(
        booking,
        (payment) => payment.kind === 'SEAT_CHANGE_TOPUP' && payment.status === 'PENDING_VERIFICATION',
      ),
    where: { payments: { some: { kind: 'SEAT_CHANGE_TOPUP', status: 'PENDING_VERIFICATION' } } },
  },
  refundPending('DIFF_REFUND_PENDING', 'PAID'),
  refundPending('CANCELLED_REFUND_PENDING', 'CANCELLED'),
  {
    // โอนคืนครบแล้ว — ใบที่ปิดไปแล้ว หรือใบที่ยังใช้ได้แต่คืนส่วนต่างเปลี่ยนที่นั่งไปแล้ว (ใบนี้ยังยกเลิกได้ตามปกติ)
    status: 'REFUNDED',
    matches: (booking) => hasPayment(booking, (payment) => payment.status === 'REFUNDED'),
    where: { payments: { some: { status: 'REFUNDED' } } },
  },
  byBookingStatus('PAID'),
  byBookingStatus('CANCELLED'),
  byBookingStatus('EXPIRED'),
];

/** ค่าที่เป็นไปได้ทั้งหมด (เรียงตามลำดับกฎ) — ใช้ตรวจ query ของ GET /api/admin/bookings */
export const DISPLAY_STATUSES = RULES.map((rule) => rule.status);

/** booking ต้องเป็นแถวจาก Prisma ที่ include payment และ seatChanges.payment มาแล้ว (bookingInclude) */
export const displayStatusOf = (booking) => {
  return RULES.find((rule) => rule.matches(booking))?.status ?? booking.status;
};

/** เงื่อนไข Prisma ของป้ายนี้ = ตรงกฎของตัวเอง และไม่ตรงกฎข้อไหนที่มาก่อน */
export const displayStatusWhere = (status) => {
  const index = RULES.findIndex((rule) => rule.status === status);
  if (index === -1) throw new Error(`Unknown booking display status: ${status}`);
  const earlier = RULES.slice(0, index).map((rule) => rule.where);
  return earlier.length > 0 ? { AND: [RULES[index].where], NOT: earlier } : RULES[index].where;
};

/**
 * ตรงป้ายใดป้ายหนึ่งในรายการ — ตัวกรองของหน้าการจองส่งมาเป็นกลุ่ม (เช่น "ที่ต้องชำระ" = รอชำระเงิน + รอชำระส่วนต่าง)
 * ป้ายของแต่ละใบมีได้ป้ายเดียว เงื่อนไขของแต่ละป้ายจึงไม่ทับกัน OR กันได้ตรง ๆ
 */
export const anyDisplayStatusWhere = (statuses) => {
  const wheres = [...new Set(statuses)].map(displayStatusWhere);
  return wheres.length === 1 ? wheres[0] : { OR: wheres };
};
