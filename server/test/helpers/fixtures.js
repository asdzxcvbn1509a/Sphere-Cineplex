import fs from 'node:fs/promises';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import prisma from '../../src/lib/prisma.js';
import { PAYMENT_SLIP_DIR, REFUND_SLIP_DIR } from '../../src/config/env.js';
import { createTheatre } from '../../src/services/theatres.js';
import { createShowtime } from '../../src/services/showtimes.js';
import { createBooking } from '../../src/services/bookings.js';
import { approvePayment, uploadSlip } from '../../src/services/payments.js';

const fileId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);
let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

const MINUTE = 60 * 1000;
export const minutesFromNow = (minutes) => new Date(Date.now() + minutes * MINUTE);

/** ผู้ใช้ทดสอบ — passwordHash ใส่ค่าหลอก เคสที่ต้องล็อกอินจริงให้ตั้ง hash เอง */
export const createUser = async ({ role = 'USER', name, passwordHash = 'not-a-real-hash' } = {}) => {
  const n = next();
  return prisma.user.create({
    data: {
      email: `user${n}@test.local`,
      phone: `08${String(n).padStart(8, '0')}`,
      passwordHash,
      name: name ?? `ผู้ใช้ทดสอบ ${n}`,
      role,
    },
  });
};

export const createAdmin = (options = {}) => createUser({ ...options, role: 'ADMIN' });

export const createMovie = async ({ durationMin = 120 } = {}) => {
  const n = next();
  return prisma.movie.create({
    data: {
      titleTh: `หนังทดสอบ ${n}`,
      titleEn: `Test Movie ${n}`,
      synopsisTh: '',
      synopsisEn: '',
      posterUrl: 'https://example.com/poster.jpg',
      durationMin,
      genres: [],
      releaseDate: new Date(),
    },
  });
};

/** โรงเล็ก 3 แถว × 4 ที่ (แถว A ธรรมดา, B–C พรีเมียม) = 12 ที่นั่ง */
export const createSmallTheatre = async ({ rowsCount = 3, colsCount = 4 } = {}) => {
  return createTheatre({ name: `โรงทดสอบ ${next()}`, screenType: '2D', rowsCount, colsCount });
};

/**
 * รอบฉายพร้อมใช้ — ค่าเริ่มต้นคือพรุ่งนี้ (เลยกติกายกเลิกล่วงหน้า 3 ชั่วโมงไปไกล)
 * ส่ง movie/theatre เดิมมาได้เมื่อต้องการหลายรอบในโรงเดียวกัน (ต้องเว้นเวลาไม่ให้ชนกันเอง)
 */
export const createShowtimeFixture = async ({ startsAt = minutesFromNow(24 * 60), movie, theatre, basePrice = 200 } = {}) => {
  const theMovie = movie ?? (await createMovie());
  const theTheatre = theatre ?? (await createSmallTheatre());
  const showtime = await createShowtime({
    movieId: theMovie.id,
    theatreId: theTheatre.id,
    startsAt,
    basePrice,
  });
  const seats = await prisma.seat.findMany({
    where: { theatreId: theTheatre.id },
    orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }],
  });
  return { showtime, movie: theMovie, theatre: theTheatre, seats };
};

export const book = ({ user, showtime, seats }) => {
  return createBooking({ userId: user.id, showtimeId: showtime.id, seatIds: seats.map((s) => s.id) });
};

// PNG 1×1 จริง ๆ — ผ่านการตรวจ magic bytes ได้
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * เลียนแบบสิ่งที่ middleware อัปโหลดส่งต่อมาให้ service: ไฟล์ถูกเก็บลงที่เก็บแล้ว (เทสต์ใช้ดิสก์) + filename
 * path มีไว้ให้เทสต์เช็กว่าไฟล์ยังอยู่หรือถูกลบไปแล้ว — service เองใช้แค่ filename
 */
export const makeSlipFile = async ({ kind = 'payment', content = TINY_PNG, ext = '.png' } = {}) => {
  const dir = kind === 'refund' ? REFUND_SLIP_DIR : PAYMENT_SLIP_DIR;
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${fileId()}${ext}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content);
  return { path: filePath, filename };
};

export const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/** ส่งสลิปให้การจอง (สถานะ → PENDING_VERIFICATION) */
export const submitSlip = async (booking, user) => {
  return uploadSlip({ bookingId: booking.id, userId: user.id, file: await makeSlipFile() });
};

/** จองแล้วจ่ายจนเป็น PAID — คืนการจองล่าสุด */
export const createPaidBooking = async ({ user, admin, showtime, seats }) => {
  const booking = await book({ user, showtime, seats });
  await submitSlip(booking, user);
  const payment = await paymentOf(booking.id);
  return approvePayment({ paymentId: payment.id, adminId: admin.id });
};

/** ใบชำระเงินหลัก (ค่าตั๋วตอนจอง) — รายการส่วนต่างจากการเปลี่ยนที่นั่งใช้ paymentOfSeatChange */
export const paymentOf = (bookingId) => prisma.payment.findUnique({ where: { mainBookingId: bookingId } });

/** รายการเงินส่วนต่างของคำขอเปลี่ยนที่นั่ง (โอนเพิ่มหรือคืน) */
export const paymentOfSeatChange = (seatChangeId) => {
  return prisma.payment.findUnique({ where: { seatChangeId } });
};

export const bookingOf = (bookingId) => prisma.booking.findUnique({ where: { id: bookingId } });

/** ตรวจว่า promise ล้มด้วย ApiError รหัสที่คาดไว้ (ใช้คู่กับ assert.rejects) */
export const apiErrorWith = (code, status) => (error) => {
  if (error?.code !== code) {
    throw new Error(`คาดว่าจะได้ error ${code} แต่ได้ ${error?.code ?? error?.message}`);
  }
  if (status && error.status !== status) {
    throw new Error(`คาดว่าจะได้ status ${status} แต่ได้ ${error.status}`);
  }
  return true;
};
