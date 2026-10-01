import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';

const MAX_ROWS = 26; // A–Z

export const rowLabelFor = (index) => {
  return String.fromCharCode(65 + index);
};

/**
 * ผังที่นั่งมาตรฐาน: แถวหน้าเป็นที่นั่งธรรมดา แถวกลางค่อนไปหลังเป็น Premium
 * และแถวสุดท้ายเป็นโซฟาคู่ (เลียนแบบผังโรงหนังจริง)
 */
export const zoneForRow = (rowIndex, rowsCount) => {
  if (rowsCount >= 4 && rowIndex === rowsCount - 1) return 'SOFA';
  if (rowIndex >= Math.floor(rowsCount * 0.45)) return 'PREMIUM';
  return 'NORMAL';
};

export const buildSeatGrid = (rowsCount, colsCount) => {
  const seats = [];
  for (let r = 0; r < rowsCount; r += 1) {
    const zone = zoneForRow(r, rowsCount);
    // โซฟาเป็นที่นั่งคู่ จึงมีจำนวนต่อแถวครึ่งเดียว
    const seatsInRow = zone === 'SOFA' ? Math.ceil(colsCount / 2) : colsCount;
    for (let c = 1; c <= seatsInRow; c += 1) {
      seats.push({ rowLabel: rowLabelFor(r), seatNumber: c, zone });
    }
  }
  return seats;
};

export const listTheatres = async () => {
  const theatres = await prisma.theatre.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { seats: true, showtimes: true } } },
  });
  return theatres.map((t) => ({
    id: t.id,
    name: t.name,
    screenType: t.screenType,
    rowsCount: t.rowsCount,
    colsCount: t.colsCount,
    isActive: t.isActive,
    seatCount: t._count.seats,
    showtimeCount: t._count.showtimes,
  }));
};

export const getTheatreById = async (id) => {
  const theatre = await prisma.theatre.findUnique({
    where: { id },
    include: { seats: { orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }] } },
  });
  if (!theatre) throw ApiError.notFound('THEATRE_NOT_FOUND', 'ไม่พบโรงภาพยนตร์นี้');

  const rowMap = new Map();
  for (const seat of theatre.seats) {
    if (!rowMap.has(seat.rowLabel)) rowMap.set(seat.rowLabel, []);
    rowMap.get(seat.rowLabel).push(seat);
  }

  return {
    ...theatre,
    seats: undefined,
    rows: [...rowMap.entries()].map(([rowLabel, seats]) => ({ rowLabel, seats })),
  };
};

export const createTheatre = async ({ name, screenType, rowsCount, colsCount }) => {
  assertGridSize(rowsCount, colsCount);
  const theatre = await prisma.theatre.create({
    data: {
      name,
      screenType,
      rowsCount,
      colsCount,
      seats: { create: buildSeatGrid(rowsCount, colsCount) },
    },
  });
  return getTheatreById(theatre.id);
};

export const updateTheatre = async (id, data) => {
  const theatre = await prisma.theatre.findUnique({ where: { id } });
  if (!theatre) throw ApiError.notFound('THEATRE_NOT_FOUND', 'ไม่พบโรงภาพยนตร์นี้');

  const resizing =
    (data.rowsCount !== undefined && data.rowsCount !== theatre.rowsCount) ||
    (data.colsCount !== undefined && data.colsCount !== theatre.colsCount);

  if (resizing) {
    const activeBookings = await prisma.bookingSeat.count({ where: { seat: { theatreId: id } } });
    if (activeBookings > 0) {
      throw ApiError.conflict(
        'THEATRE_HAS_BOOKINGS',
        'โรงนี้มีที่นั่งที่ถูกจองอยู่ ไม่สามารถเปลี่ยนขนาดผังได้',
      );
    }
    const rowsCount = data.rowsCount ?? theatre.rowsCount;
    const colsCount = data.colsCount ?? theatre.colsCount;
    assertGridSize(rowsCount, colsCount);

    await prisma.$transaction([
      prisma.seat.deleteMany({ where: { theatreId: id } }),
      prisma.theatre.update({
        where: { id },
        data: {
          ...data,
          seats: { create: buildSeatGrid(rowsCount, colsCount) },
        },
      }),
    ]);
    return getTheatreById(id);
  }

  await prisma.theatre.update({ where: { id }, data });
  return getTheatreById(id);
};

/**
 * ลบโรงได้เฉพาะโรงที่ไม่เคยมีการจองเลย — เหตุผลเดียวกับ deleteShowtime
 * (ลบโรง = cascade ลบรอบ → การจอง → รายการชำระเงินและคิวคืนเงิน) โรงที่เลิกใช้ให้ปิดใช้งานแทน
 */
export const deleteTheatre = async (id) => {
  const bookingCount = await prisma.booking.count({ where: { showtime: { theatreId: id } } });
  if (bookingCount > 0) {
    throw ApiError.conflict(
      'THEATRE_HAS_BOOKINGS',
      'โรงนี้มีประวัติการจอง ลบไม่ได้เพราะประวัติและรายการคืนเงินจะหายไปด้วย — ปิดใช้งานโรงแทน',
      { bookingCount },
    );
  }
  await prisma.theatre.delete({ where: { id } });
};

/** แก้โซน/เปิด-ปิดที่นั่งทีละหลายที่ (ใช้กับตัวแก้ผังฝั่ง admin) */
export const updateSeats = async (theatreId, { seatIds, zone, isActive }) => {
  const result = await prisma.seat.updateMany({
    where: { id: { in: seatIds }, theatreId },
    data: {
      ...(zone !== undefined && { zone }),
      ...(isActive !== undefined && { isActive }),
    },
  });
  return result.count;
};

const assertGridSize = (rowsCount, colsCount) => {
  if (rowsCount < 1 || rowsCount > MAX_ROWS) {
    throw ApiError.badRequest('INVALID_GRID', `จำนวนแถวต้องอยู่ระหว่าง 1–${MAX_ROWS}`);
  }
  if (colsCount < 1 || colsCount > 30) {
    throw ApiError.badRequest('INVALID_GRID', 'จำนวนที่นั่งต่อแถวต้องอยู่ระหว่าง 1–30');
  }
};
