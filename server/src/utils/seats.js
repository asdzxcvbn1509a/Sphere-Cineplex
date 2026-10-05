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
