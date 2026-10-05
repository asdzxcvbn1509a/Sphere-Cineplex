import { bahtText, bahtTextEn } from './bahtText.js';
import { bangkokDateKey } from './datetime.js';

/**
 * ใบเสร็จรับเงิน (E-Receipt) — ส่วนที่ไม่แตะฐานข้อมูล ไม่ผูกกับ env และเทสต์ได้ตรง ๆ
 * การออกเลขและการตรวจสิทธิ์อยู่ที่ services/receipts.js
 */

export const RECEIPT_PREFIX = 'RC';

/** ปีของเลขที่ใบเสร็จ = ปี ค.ศ. ตามเวลาไทย — อนุมัติตอนตีหนึ่งของวันที่ 1 ม.ค. (เวลาไทย) ต้องขึ้นชุดของปีใหม่แล้ว */
export const receiptYear = (date) => {
  return Number(bangkokDateKey(date).slice(0, 4));
};

/** RC-2026-000123 — เกินล้านใบในปีเดียวเลขก็แค่ยาวขึ้น ไม่ถูกตัดจนซ้ำกัน */
export const formatReceiptNo = (year, sequence) => {
  return `${RECEIPT_PREFIX}-${year}-${String(sequence).padStart(6, '0')}`;
};

/**
 * รายการบนใบเสร็จ — ที่นั่งโซนเดียวกันราคาเดียวกันรวมเป็นบรรทัดเดียว เช่น "พรีเมียม B1, B2 × 2"
 * ใช้ราคาจาก seatSnapshot (ราคา ณ ตอนจอง) ไม่ใช่ราคาปัจจุบันของรอบ เพราะผู้ดูแลแก้ราคารอบทีหลังได้
 */
export const receiptLines = (seats = []) => {
  const lines = new Map();
  for (const seat of seats) {
    const key = `${seat.zone}:${seat.price}`;
    const line = lines.get(key) ?? {
      kind: 'SEATS',
      zone: seat.zone,
      unitPrice: seat.price,
      quantity: 0,
      amount: 0,
      seats: [],
    };
    line.quantity += 1;
    line.amount += seat.price;
    line.seats.push(seat.label);
    lines.set(key, line);
  }
  return [...lines.values()];
};

/**
 * ใบเสร็จส่วนต่างจากการเปลี่ยนที่นั่ง — บรรทัดเดียว บอกว่าย้ายจากที่นั่งไหนไปไหน
 * ที่นั่งเอาจากคำขอเปลี่ยนที่นั่ง (ไม่เปลี่ยนอีกหลังย้ายเสร็จ) ใบเสร็จจึงคงเดิมแม้จะย้ายต่ออีกรอบ
 */
const seatChangeLine = (payment) => {
  const labels = (seats) => (seats ?? []).map((seat) => seat.label);
  return {
    kind: 'SEAT_CHANGE',
    fromSeats: labels(payment.seatChange?.fromSeats),
    toSeats: labels(payment.seatChange?.toSeats),
    quantity: 1,
    unitPrice: payment.amount,
    amount: payment.amount,
  };
};

const seatLabels = (seats = []) => {
  return seats.map((seat) => seat.label).sort();
};

const REFUND_STATUSES = ['REFUND_PENDING', 'REFUNDED'];

/**
 * ข้อมูลใบเสร็จที่ส่งให้หน้าเว็บ และใช้ทำอีเมล
 * booking ต้อง include user, showtime.movie, showtime.theatre และ payment (ใบหลัก) มาแล้ว
 * issuer ({ name, address }) ส่งมาจาก service ที่อ่านค่าจาก env
 * payment = รายการเงินที่ออกใบเสร็จ — ไม่ส่งมาคือใบหลัก (ค่าตั๋วตอนจอง)
 *   ส่งรายการส่วนต่าง (SEAT_CHANGE_TOPUP ที่ include seatChange) มาคือใบเสร็จส่วนต่างเปลี่ยนที่นั่ง
 *
 * ชื่อผู้จ่ายและที่นั่งใช้สำเนาที่เก็บไว้ตอนออกใบเสร็จ (receiptName, receiptSeats) ก่อนเสมอ
 * ผู้ใช้แก้ชื่อหรือเปลี่ยนที่นั่งทีหลังได้ แต่ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม
 */
export const shapeReceipt = (booking, issuer, payment = booking.payment) => {
  const { showtime } = booking;
  const topUp = payment.kind === 'SEAT_CHANGE_TOPUP';
  const seats = payment.receiptSeats ?? booking.seatSnapshot;
  // เปลี่ยนที่นั่งหลังออกใบเสร็จ — ใบเสร็จยังเป็นที่นั่งตอนจ่าย แต่บอกที่นั่งปัจจุบันไว้ คนถือใบเสร็จจะได้ไม่งงว่าทำไมไม่ตรงตั๋ว
  const current = seatLabels(booking.seatSnapshot);
  const seatsChanged = !topUp && current.join() !== seatLabels(seats).join();
  // ยกเลิกหลังจ่ายแล้วคืนเงินเป็นยอดสุทธิในรายการเดียวบนใบหลัก ใบเสร็จส่วนต่างจึงดูสถานะคืนเงินจากใบหลักด้วย
  const main = booking.payment ?? payment;

  return {
    receiptNo: payment.receiptNo,
    kind: payment.kind ?? 'BOOKING',
    // วันที่ใบเสร็จ = เวลาที่ผู้ดูแลยืนยันยอด (ใบหลักตั้งพร้อม paidAt และไม่เปลี่ยนอีกหลังอนุมัติ)
    issuedAt: topUp ? payment.verifiedAt : booking.paidAt,
    issuer: { name: issuer.name, address: issuer.address || null },
    customer: { name: payment.receiptName ?? booking.user?.name ?? '' },
    // userId ให้หน้าเว็บรู้ว่าผู้ดูแลกำลังเปิดใบเสร็จของตัวเองหรือของลูกค้า (ทางกลับคนละหน้า)
    booking: { id: booking.id, code: booking.code, status: booking.status, userId: booking.userId },
    showtime: {
      startsAt: showtime.startsAt,
      movie: { titleTh: showtime.movie.titleTh, titleEn: showtime.movie.titleEn },
      theatre: { name: showtime.theatre.name },
    },
    lines: topUp ? [seatChangeLine(payment)] : receiptLines(seats),
    seatsChangedTo: seatsChanged ? current : null,
    totalAmount: payment.amount,
    // ตั้งชื่อแบบ xxxTh/xxxEn ให้หน้าเว็บใช้ pick(receipt, 'amountText') ได้เหมือนชื่อเรื่อง
    amountTextTh: bahtText(payment.amount),
    amountTextEn: bahtTextEn(payment.amount),
    payment: { method: payment.method, reference: payment.reference },
    // ยกเลิกหลังจ่ายแล้ว — ใบเสร็จยังอยู่ (เป็นหลักฐานว่ารับเงินมาจริง) แต่ต้องบอกว่าเงินก้อนนี้คืน/กำลังคืนแล้ว
    refund: REFUND_STATUSES.includes(main.status)
      ? { status: main.status, refundedAt: main.refundedAt }
      : null,
  };
};
