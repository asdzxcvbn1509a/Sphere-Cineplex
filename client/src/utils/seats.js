/**
 * เรียงที่นั่งตามแถวแล้วตามเลขที่นั่ง (A1, A2, …, A10, B1) — ตรงกับ sortSeats ฝั่ง server (server/src/utils/seats.js)
 * เรียงชื่อเป็นสตริงตรง ๆ จะได้ A10 ก่อน A2
 */
export const sortSeats = (seats) => {
  return [...seats].sort(
    (a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber,
  );
};

/** ชื่อที่นั่งแบบ A1, A2 ตามลำดับในผัง */
export const seatLabels = (seats) => {
  return sortSeats(seats)
    .map((seat) => `${seat.rowLabel}${seat.seatNumber}`)
    .join(', ');
};
