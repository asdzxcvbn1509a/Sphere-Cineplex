import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { bangkokDayRange } from '../utils/datetime.js';
import { buildZonePrices, toPriceMap } from '../utils/pricing.js';

/**
 * นับเฉพาะที่นั่งที่เปิดขาย ให้ตรงกับผังที่นั่งและการจอง (ใช้แค่ที่นั่ง isActive ทั้งคู่)
 * เดิมนับทุกที่นั่งของโรง ที่นั่งที่ผู้ดูแลปิดใช้งานจึงกลายเป็น "ว่าง" — รอบที่ขายหมดแล้วไม่ขึ้นว่าเต็ม
 * ที่นั่งที่ถูกจองแล้วค่อยปิดใช้งานไม่นับทั้งสองฝั่ง จำนวนว่างจึงไม่เพี้ยน
 */
export const SELLABLE_SEAT_COUNTS = {
  theatreSeats: { seats: { where: { isActive: true } } },
  bookingSeats: { bookingSeats: { where: { seat: { isActive: true } } } },
};

const showtimeInclude = {
  theatre: {
    select: {
      id: true,
      name: true,
      screenType: true,
      _count: { select: SELLABLE_SEAT_COUNTS.theatreSeats },
    },
  },
  movie: { select: { id: true, titleTh: true, titleEn: true, posterUrl: true, durationMin: true } },
  zonePrices: { select: { zone: true, price: true } },
  _count: { select: SELLABLE_SEAT_COUNTS.bookingSeats },
};

const shapeShowtime = (showtime) => {
  const totalSeats = showtime.theatre._count.seats;
  const takenSeats = showtime._count.bookingSeats;
  return {
    id: showtime.id,
    movieId: showtime.movieId,
    movie: showtime.movie,
    theatre: {
      id: showtime.theatre.id,
      name: showtime.theatre.name,
      screenType: showtime.theatre.screenType,
    },
    startsAt: showtime.startsAt,
    endsAt: showtime.endsAt,
    basePrice: showtime.basePrice,
    status: showtime.status,
    prices: toPriceMap(showtime.zonePrices, showtime.basePrice),
    totalSeats,
    availableSeats: Math.max(totalSeats - takenSeats, 0),
  };
};

/**
 * includeCancelled ใช้ฝั่งผู้ดูแล — รอบที่ยกเลิกแล้วต้องยังเห็นในตาราง ไม่งั้นรอบจะหายไปเฉย ๆ
 * จนไม่รู้ว่าถูกยกเลิกหรือถูกลบ ส่วนหน้าลูกค้าเห็นเฉพาะรอบที่ยังขายอยู่
 */
export const listShowtimes = async ({
  movieId,
  theatreId,
  date,
  includePast = false,
  includeCancelled = false,
} = {}) => {
  const where = includeCancelled ? {} : { status: 'SCHEDULED' };
  if (movieId) where.movieId = movieId;
  if (theatreId) where.theatreId = theatreId;

  if (date) {
    const range = bangkokDayRange(date);
    if (!range) throw ApiError.badRequest('INVALID_DATE', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
    // ในวันนี้ ไม่ต้องแสดงรอบที่เริ่มฉายไปแล้ว
    const from = includePast ? range.start : new Date(Math.max(range.start.getTime(), Date.now()));
    where.startsAt = { gte: from, lt: range.end };
  } else if (!includePast) {
    where.startsAt = { gte: new Date() };
  }

  const showtimes = await prisma.showtime.findMany({
    where,
    include: showtimeInclude,
    orderBy: { startsAt: 'asc' },
  });

  return showtimes.map(shapeShowtime);
};

export const getShowtimeById = async (id) => {
  const showtime = await prisma.showtime.findUnique({ where: { id }, include: showtimeInclude });
  if (!showtime) throw ApiError.notFound('SHOWTIME_NOT_FOUND', 'ไม่พบรอบฉายนี้');
  return shapeShowtime(showtime);
};

/**
 * ผังที่นั่งของรอบฉาย
 * ทุกแถวใน BookingSeat = ที่นั่งที่ยังถูกยึดอยู่จริง (การจองที่ยกเลิก/หมดอายุจะถูกลบทิ้ง)
 * จึงแยกได้แค่ว่าเป็น BOOKED (จ่ายแล้ว) หรือ HELD (กำลังรอชำระ/รอตรวจสลิป
 * รวมที่นั่งใหม่ที่กันไว้ให้คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง แม้การจองนั้นจะจ่ายแล้วก็ตาม)
 */
export const getSeatMap = async (showtimeId) => {
  const showtime = await prisma.showtime.findUnique({
    where: { id: showtimeId },
    include: {
      theatre: true,
      movie: { select: { id: true, titleTh: true, titleEn: true, posterUrl: true, durationMin: true } },
      zonePrices: { select: { zone: true, price: true } },
    },
  });
  if (!showtime) throw ApiError.notFound('SHOWTIME_NOT_FOUND', 'ไม่พบรอบฉายนี้');

  const [seats, occupied] = await Promise.all([
    prisma.seat.findMany({
      where: { theatreId: showtime.theatreId, isActive: true },
      orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }],
    }),
    prisma.bookingSeat.findMany({
      where: { showtimeId },
      select: { seatId: true, seatChangeId: true, booking: { select: { status: true } } },
    }),
  ]);

  const statusBySeatId = new Map(
    occupied.map((row) => [
      row.seatId,
      row.booking.status === 'PAID' && !row.seatChangeId ? 'BOOKED' : 'HELD',
    ]),
  );

  const prices = toPriceMap(showtime.zonePrices, showtime.basePrice);

  const rowMap = new Map();
  for (const seat of seats) {
    if (!rowMap.has(seat.rowLabel)) rowMap.set(seat.rowLabel, []);
    rowMap.get(seat.rowLabel).push({
      id: seat.id,
      seatNumber: seat.seatNumber,
      zone: seat.zone,
      price: prices[seat.zone],
      status: statusBySeatId.get(seat.id) ?? 'AVAILABLE',
    });
  }

  return {
    showtime: {
      id: showtime.id,
      startsAt: showtime.startsAt,
      endsAt: showtime.endsAt,
      basePrice: showtime.basePrice,
      movie: showtime.movie,
      theatre: {
        id: showtime.theatre.id,
        name: showtime.theatre.name,
        screenType: showtime.theatre.screenType,
      },
    },
    prices,
    rows: [...rowMap.entries()].map(([rowLabel, rowSeats]) => ({ rowLabel, seats: rowSeats })),
    stats: {
      total: seats.length,
      // นับจากที่นั่งในผังที่ยังไม่มีใครยึด — statusBySeatId อาจมีที่นั่งที่จองแล้วค่อยปิดใช้งาน ซึ่งไม่อยู่ในผัง
      available: seats.filter((seat) => !statusBySeatId.has(seat.id)).length,
    },
  };
};

// ---------- ฝั่ง Admin ----------

/** กันรอบฉายซ้อนเวลากันในโรงเดียวกัน (เผื่อเวลาทำความสะอาด 15 นาที) */
export const TURNAROUND_MINUTES = 15;

export const assertNoOverlap = async ({ theatreId, startsAt, endsAt, excludeId }) => {
  const bufferMs = TURNAROUND_MINUTES * 60 * 1000;
  const clash = await prisma.showtime.findFirst({
    where: {
      theatreId,
      status: 'SCHEDULED',
      ...(excludeId && { id: { not: excludeId } }),
      startsAt: { lt: new Date(endsAt.getTime() + bufferMs) },
      endsAt: { gt: new Date(startsAt.getTime() - bufferMs) },
    },
    include: { movie: { select: { titleTh: true } } },
  });

  if (clash) {
    throw ApiError.conflict(
      'SHOWTIME_OVERLAP',
      `รอบนี้ชนกับรอบของเรื่อง "${clash.movie.titleTh}" ในโรงเดียวกัน (ต้องเว้นอย่างน้อย ${TURNAROUND_MINUTES} นาที)`,
      { conflictingShowtimeId: clash.id, startsAt: clash.startsAt, endsAt: clash.endsAt },
    );
  }
};

/** ช่วงเวลาที่โรงเปิดให้จัดรอบฉาย (เวลาไทย) และความละเอียดของตัวเลือกเวลา */
const OPEN_HOUR = 10;
const CLOSE_HOUR = 24;
const SLOT_STEP_MINUTES = 15;

/**
 * คำนวณว่าโรงนี้ในวันนี้ มีรอบไหนจองเวลาไว้แล้วบ้าง และเหลือช่วงไหนที่ลงรอบใหม่ได้
 * ใช้กฎเดียวกับ assertNoOverlap (เว้นอย่างน้อย TURNAROUND_MINUTES ทั้งหัวและท้าย)
 * ให้ server เป็นคนคิด เพื่อไม่ให้ client ต้องเขียนกฎซ้ำแล้วหลุดจากกันภายหลัง
 */
export const getAvailability = async ({ theatreId, date, movieId, excludeId }) => {
  const range = bangkokDayRange(date);
  if (!range) throw ApiError.badRequest('INVALID_DATE', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');

  const windowStartMs = range.start.getTime() + OPEN_HOUR * 60 * 60 * 1000;
  const windowEndMs = range.start.getTime() + CLOSE_HOUR * 60 * 60 * 1000;

  const movie = await prisma.movie.findUnique({ where: { id: movieId } });
  if (!movie) throw ApiError.notFound('MOVIE_NOT_FOUND', 'ไม่พบภาพยนตร์เรื่องนี้');

  const showtimes = await prisma.showtime.findMany({
    where: {
      theatreId,
      status: 'SCHEDULED',
      ...(excludeId && { id: { not: excludeId } }),
      // เอาเฉพาะรอบที่คาบเกี่ยวกับช่วงเวลาทำการของวันนั้นจริง ๆ (เผื่อ buffer หัวท้าย)
      // ถ้าดึงกว้างกว่านี้ รอบของเมื่อวานจะติดมาแสดงในรายการทั้งที่ไม่ได้ชนกับช่องเวลาที่เสนอ
      startsAt: { lt: new Date(windowEndMs + TURNAROUND_MINUTES * 60 * 1000) },
      endsAt: { gt: new Date(windowStartMs - TURNAROUND_MINUTES * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
    include: { movie: { select: { titleTh: true, titleEn: true } } },
  });

  const bufferMs = TURNAROUND_MINUTES * 60 * 1000;
  const durationMs = movie.durationMin * 60 * 1000;
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;

  const conflictsAt = (startMs) => {
    const endMs = startMs + durationMs;
    return showtimes.some(
      (s) => s.startsAt.getTime() < endMs + bufferMs && s.endsAt.getTime() > startMs - bufferMs,
    );
  };

  const notBefore = Date.now();

  const freeSlots = [];
  for (let t = windowStartMs; t + durationMs <= windowEndMs; t += stepMs) {
    if (t < notBefore) continue;
    if (!conflictsAt(t)) freeSlots.push(new Date(t).toISOString());
  }

  return {
    turnaroundMinutes: TURNAROUND_MINUTES,
    durationMin: movie.durationMin,
    slotStepMinutes: SLOT_STEP_MINUTES,
    busy: showtimes.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      movie: s.movie,
    })),
    freeSlots,
  };
};

/** โรงที่ผู้ดูแลปิดไว้ (ปิดซ่อม เลิกใช้) ต้องรับรอบใหม่ไม่ได้ — ทางเลือกแทนการลบโรงที่มีประวัติการจอง */
const findActiveTheatre = async (theatreId) => {
  const theatre = await prisma.theatre.findUnique({ where: { id: theatreId } });
  if (!theatre) throw ApiError.notFound('THEATRE_NOT_FOUND', 'ไม่พบโรงภาพยนตร์นี้');
  if (!theatre.isActive) {
    throw ApiError.badRequest('THEATRE_INACTIVE', `โรง "${theatre.name}" ปิดใช้งานอยู่ ลงรอบฉายใหม่ไม่ได้`);
  }
  return theatre;
};

export const createShowtime = async ({ movieId, theatreId, startsAt, basePrice }) => {
  const movie = await prisma.movie.findUnique({ where: { id: movieId } });
  if (!movie) throw ApiError.notFound('MOVIE_NOT_FOUND', 'ไม่พบภาพยนตร์เรื่องนี้');

  await findActiveTheatre(theatreId);

  const start = new Date(startsAt);
  const end = new Date(start.getTime() + movie.durationMin * 60 * 1000);
  await assertNoOverlap({ theatreId, startsAt: start, endsAt: end });

  const showtime = await prisma.showtime.create({
    data: {
      movieId,
      theatreId,
      startsAt: start,
      endsAt: end,
      basePrice,
      zonePrices: { create: buildZonePrices(basePrice) },
    },
    include: showtimeInclude,
  });

  return shapeShowtime(showtime);
};

/**
 * แก้รอบฉาย — ย้ายเวลา/โรง และ/หรือเปลี่ยนราคา
 * การยกเลิกรอบไม่ได้ทำผ่านที่นี่ ต้องใช้ cancelShowtime ซึ่งปิดการจองและเข้าคิวคืนเงินให้ด้วย
 */
export const updateShowtime = async (id, data) => {
  const existing = await prisma.showtime.findUnique({ where: { id }, include: { movie: true } });
  if (!existing) throw ApiError.notFound('SHOWTIME_NOT_FOUND', 'ไม่พบรอบฉายนี้');
  if (existing.status === 'CANCELLED') {
    throw ApiError.conflict('SHOWTIME_ALREADY_CANCELLED', 'รอบนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
  }

  const theatreId = data.theatreId ?? existing.theatreId;
  const start = data.startsAt ? new Date(data.startsAt) : existing.startsAt;
  const end = new Date(start.getTime() + existing.movie.durationMin * 60 * 1000);

  // หน้าแก้รอบส่งเวลาและโรงมาทุกครั้งแม้ไม่ได้แตะ จึงต้องดูว่า "ค่าเปลี่ยนจริง" ไม่ใช่แค่ "มีส่งมา"
  // ไม่งั้นรอบที่มีคนจองแล้วจะแก้ราคาไม่ได้เลย ทั้งที่ไม่ได้ย้ายเวลาหรือโรง
  const theatreChanged = theatreId !== existing.theatreId;
  const moving = theatreChanged || start.getTime() !== existing.startsAt.getTime();

  if (moving) {
    const bookedCount = await prisma.bookingSeat.count({ where: { showtimeId: id } });
    if (bookedCount > 0) {
      throw ApiError.conflict(
        'SHOWTIME_HAS_BOOKINGS',
        'รอบนี้มีการจองแล้ว ไม่สามารถย้ายเวลา/โรงได้ (ยกเลิกรอบแทนหากจำเป็น)',
      );
    }
    if (theatreChanged) await findActiveTheatre(theatreId);
    await assertNoOverlap({ theatreId, startsAt: start, endsAt: end, excludeId: id });
  }

  const showtime = await prisma.$transaction(async (tx) => {
    if (data.basePrice !== undefined) {
      await tx.zonePrice.deleteMany({ where: { showtimeId: id } });
      await tx.zonePrice.createMany({
        data: buildZonePrices(data.basePrice).map((zp) => ({ ...zp, showtimeId: id })),
      });
    }
    return tx.showtime.update({
      where: { id },
      data: {
        ...(moving && { theatreId, startsAt: start, endsAt: end }),
        ...(data.basePrice !== undefined && { basePrice: data.basePrice }),
      },
      include: showtimeInclude,
    });
  });

  return shapeShowtime(showtime);
};

/**
 * ลบรอบได้เฉพาะรอบที่ไม่เคยมีใครจองเลย
 *
 * นับทุกการจองที่เคยมี ไม่ใช่แค่ที่นั่งที่ยังถูกยึด — การจองที่ยกเลิกแล้วไม่มี BookingSeat เหลือ
 * แต่ยังผูกกับรายการชำระเงินและคิวคืนเงินอยู่ ลบรอบทีเดียวทุกอย่างถูก cascade หายตามไปเงียบ ๆ
 * (ลูกค้าที่รอเงินคืนจะไม่ได้เงิน และไม่เหลือหลักฐานว่าเคยจ่าย) รอบที่ไม่ใช้แล้วให้ "ยกเลิกรอบ" แทน
 */
export const deleteShowtime = async (id) => {
  const bookingCount = await prisma.booking.count({ where: { showtimeId: id } });
  if (bookingCount > 0) {
    throw ApiError.conflict(
      'SHOWTIME_HAS_BOOKINGS',
      'รอบนี้มีประวัติการจอง ลบไม่ได้เพราะประวัติและรายการคืนเงินจะหายไปด้วย — ใช้ "ยกเลิกรอบ" แทน',
      { bookingCount },
    );
  }
  await prisma.showtime.delete({ where: { id } });
};
