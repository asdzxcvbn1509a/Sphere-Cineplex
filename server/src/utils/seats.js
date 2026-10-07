/**
 * ที่นั่งในรูปที่เก็บลง Booking.seatSnapshot และ SeatChange.fromSeats/toSeats
 * ใช้ร่วมกันทั้งตอนจองและตอนเปลี่ยนที่นั่ง รูปแบบจึงตรงกันเสมอ
 */

export const seatLabel = (seat) => {
  return `${seat.rowLabel}${seat.seatNumber}`;
};

/** เรียงตามแถวแล้วตามเลขที่นั่ง (A1, A2, …, B1) */
export const sortSeats = (seats) => {
  return [...seats].sort(
    (a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber,
  );
};

/** ป้ายของที่นั่งใน snapshot (A1, A2, …) — ไม่มี snapshot ได้รายการว่าง */
export const seatLabels = (seats) => {
  return (seats ?? []).map((seat) => seat.label);
};

/**
 * เทียบ id ให้ได้ลำดับคงที่ — ทุกรายการเขียนที่นั่งเรียงตามลำดับนี้
 * สองรายการที่แย่งที่นั่งชุดเดียวกันจึงชนกันที่ที่นั่งแรกเหมือนกัน แทนที่จะรอกันเองจน deadlock
 */
export const compareIds = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** หนึ่งรายการใน seatSnapshot — price คือราคาที่ลูกค้าจ่ายจริงของที่นั่งนั้น */
export const snapshotSeat = (seat, price) => {
  return {
    id: seat.id,
    rowLabel: seat.rowLabel,
    seatNumber: seat.seatNumber,
    label: seatLabel(seat),
    zone: seat.zone,
    price,
  };
};
