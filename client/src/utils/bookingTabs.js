/**
 * แท็บของหน้าการจองของฉัน — แบ่งจากรายการทั้งหมด (scope=all) ในเว็บเอง สลับแท็บจึงไม่ต้องรอโหลดใหม่
 * การจองหนึ่งใบอยู่ได้แท็บเดียว ตรวจตามลำดับ: สิ่งที่ลูกค้าต้องทำก่อน แล้วค่อยสิ่งที่รอผู้ดูแล
 */
export const BOOKING_TABS = ['unpaid', 'pending', 'paid', 'cancelled', 'history'];

/** ใบที่ปิดไปแล้วแต่ยังค้างเงินลูกค้าอยู่ — ค่าตั๋ว หรือส่วนต่างเปลี่ยนที่นั่งที่รอผู้ดูแลโอนคืน */
const owesRefund = (booking) => {
  if (booking.payment?.status === 'REFUND_PENDING') return true;
  return (booking.seatChange?.history ?? []).some(
    (change) => change.payment?.status === 'REFUND_PENDING',
  );
};

export const bookingTab = (booking, now = new Date()) => {
  const openChange = booking.seatChange?.open?.status;
  // ลูกค้าต้องโอนเงิน — ค่าตั๋ว หรือส่วนต่างของที่นั่งใหม่ที่แพงกว่าเดิม
  if (booking.status === 'PENDING_PAYMENT' || openChange === 'PENDING_PAYMENT') return 'unpaid';
  // รอผู้ดูแลตรวจสลิป — ค่าตั๋ว หรือส่วนต่างเปลี่ยนที่นั่ง
  if (booking.status === 'PENDING_VERIFICATION' || openChange === 'PENDING_VERIFICATION') return 'pending';

  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
    // ปิดไปแล้วแต่ยังรอผู้ดูแลอยู่ (ตรวจสลิปที่ส่งหลังหมดเวลา / โอนเงินคืน) — ย้ายไปแท็บยกเลิกเมื่อเรื่องเงินจบ
    if (booking.payment?.status === 'PENDING_VERIFICATION' || owesRefund(booking)) return 'pending';
    return 'cancelled';
  }

  // ชำระแล้ว — ตั๋วยังใช้ได้จนรอบฉายจบ คนที่มาสายยังเปิดตั๋วจากแท็บสำเร็จได้
  // ส่วนต่างเปลี่ยนที่นั่งที่รอโอนคืนไม่ทำให้ย้ายแท็บ เพราะตั๋วยังใช้ได้ การ์ดมีชิปบอกอยู่แล้ว
  return new Date(booking.showtime.endsAt) > now ? 'paid' : 'history';
};

/** { unpaid: [...], pending: [...], ... } — คงลำดับเดิมจาก server (จองล่าสุดก่อน) */
export const groupBookingsByTab = (bookings, now = new Date()) => {
  const groups = Object.fromEntries(BOOKING_TABS.map((tab) => [tab, []]));
  for (const booking of bookings) groups[bookingTab(booking, now)].push(booking);
  return groups;
};

/**
 * แท็บที่เปิดให้เมื่อ URL ไม่ได้ระบุ (กดเมนูด้านบน) — งานที่ค้างอยู่ก่อน ไม่มีก็ไปที่ตั๋วที่ยังใช้ได้
 * ส่วนใหญ่ไม่มีอะไรค้างจ่าย ถ้าเปิดแท็บที่ต้องชำระทุกครั้งจะเจอแต่แท็บว่าง
 */
export const defaultBookingTab = (groups) => {
  if (groups.unpaid.length > 0) return 'unpaid';
  if (groups.pending.length > 0) return 'pending';
  return 'paid';
};
