import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { bangkokDateKey } from '../utils/datetime.js';

export const listMovies = async ({ status, q, includeArchived = false } = {}) => {
  const where = {};
  if (status) where.status = status;
  else if (!includeArchived) where.status = { not: 'ARCHIVED' };

  if (q) {
    where.OR = [
      { titleTh: { contains: q, mode: 'insensitive' } },
      { titleEn: { contains: q, mode: 'insensitive' } },
    ];
  }

  return prisma.movie.findMany({
    where,
    orderBy: [{ status: 'asc' }, { releaseDate: 'desc' }],
  });
};

/** รายละเอียดหนัง + วันที่ที่ยังมีรอบฉายให้เลือก (ตามเวลาไทย) */
export const getMovieById = async (id) => {
  const movie = await prisma.movie.findUnique({ where: { id } });
  if (!movie) throw ApiError.notFound('MOVIE_NOT_FOUND', 'ไม่พบภาพยนตร์เรื่องนี้');

  const showtimes = await prisma.showtime.findMany({
    where: { movieId: id, status: 'SCHEDULED', startsAt: { gte: new Date() } },
    select: { startsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  const availableDates = [...new Set(showtimes.map((s) => bangkokDateKey(s.startsAt)))];
  return { ...movie, availableDates };
};

export const createMovie = async (data) => {
  return prisma.movie.create({ data });
};

export const updateMovie = async (id, data) => {
  await ensureMovieExists(id);
  return prisma.movie.update({ where: { id }, data });
};

/**
 * ลบหนัง — ถ้ามีรอบฉายที่มีคนจองแล้วจะไม่ลบ แต่เปลี่ยนเป็น ARCHIVED แทน
 * เพื่อไม่ให้ประวัติการจองของผู้ใช้หายไป
 */
export const deleteMovie = async (id, { force = false } = {}) => {
  await ensureMovieExists(id);

  const [bookingCount, showtimeCount] = await Promise.all([
    prisma.booking.count({ where: { showtime: { movieId: id } } }),
    prisma.showtime.count({ where: { movieId: id } }),
  ]);

  // เดิมพอมีการจองแล้วจะเปลี่ยนเป็น ARCHIVED ให้เงียบ ๆ แทนการลบ
  // ผลคือผู้ดูแลกดลบเท่าไหร่ก็ไม่มีอะไรเกิดขึ้น และลบเรื่องนั้นทิ้งไม่ได้เลยตลอดไป
  // ตอนนี้บอกไปตรง ๆ ว่าลบไม่ได้เพราะอะไร แล้วให้เลือกเองว่าจะเก็บเข้าคลังหรือลบถาวร
  if (bookingCount > 0 && !force) {
    throw ApiError.conflict(
      'MOVIE_HAS_BOOKINGS',
      `เรื่องนี้มีการจองอยู่ ${bookingCount} รายการ ถ้าลบถาวรประวัติการจองของลูกค้าจะหายไปด้วย`,
      { bookingCount, showtimeCount },
    );
  }

  // ลบถาวรได้แค่เมื่อทุกอย่างจบแล้ว — ยังมีตั๋วรอบที่ยังไม่ฉาย สลิปรอตรวจ หรือเงินรอโอนคืน
  // ลบไปตอนนี้ลูกค้าจะเสียตั๋ว/เงินโดยไม่มีอะไรเหลือให้ตามเรื่องได้เลย
  if (bookingCount > 0) {
    const [activeBookings, openPayments] = await Promise.all([
      prisma.booking.count({
        where: {
          status: { in: ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID'] },
          showtime: { movieId: id, endsAt: { gt: new Date() } },
        },
      }),
      prisma.payment.count({
        where: {
          status: { in: ['PENDING_VERIFICATION', 'REFUND_PENDING'] },
          booking: { showtime: { movieId: id } },
        },
      }),
    ]);
    if (activeBookings > 0 || openPayments > 0) {
      throw ApiError.conflict(
        'MOVIE_HAS_OPEN_BOOKINGS',
        `ยังลบถาวรไม่ได้ — มีการจองที่ยังไม่จบ ${activeBookings} รายการ และสลิปรอตรวจ/เงินรอโอนคืน ${openPayments} รายการ ` +
          'ยกเลิกรอบฉายและคืนเงินให้เสร็จก่อน หรือเก็บเข้าคลังแทน',
        { activeBookings, openPayments },
      );
    }
  }

  // ลบแล้วรอบฉาย การจอง ที่นั่งที่จอง และรายการชำระเงินจะถูกลบตามไปด้วย (cascade ใน schema)
  await prisma.movie.delete({ where: { id } });
  return { deleted: true, bookingCount, showtimeCount };
};

const ensureMovieExists = async (id) => {
  const exists = await prisma.movie.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw ApiError.notFound('MOVIE_NOT_FOUND', 'ไม่พบภาพยนตร์เรื่องนี้');
};
