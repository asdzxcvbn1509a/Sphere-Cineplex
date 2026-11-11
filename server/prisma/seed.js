import path from 'node:path';
import prisma from '../src/lib/prisma.js';
import { env, isSupabaseConfigured, SERVER_ROOT, SLIP_DIR } from '../src/config/env.js';
import { buildSeatGrid } from '../src/services/theatres.js';
import { PENDING_SLIP_WHERE } from '../src/services/payments.js';
import { buildZonePrices, toPriceMap } from '../src/utils/pricing.js';
import { hashPassword } from '../src/utils/password.js';
import { ADMINS, CUSTOMERS, MOVIES, THEATRES } from './seed/catalog.js';
import { createRandom } from './seed/random.js';
import { buildSchedule, dayKeyFrom, DAYS_AHEAD, HISTORY_DAYS } from './seed/schedule.js';
import { buildInventory } from './seed/seating.js';
import { seedSales } from './seed/sales.js';
import { chooseTargets, pinsFor, runScenarios } from './seed/scenarios.js';
import { slipCounts } from './seed/slipImage.js';

/**
 * ข้อมูลตัวอย่างของระบบ — ล้างทุกตารางแล้วสร้างใหม่ทั้งหมด
 *
 * 1. แคตตาล็อก: ผู้ใช้ หนัง โรง ที่นั่ง และรอบฉายย้อนหลัง HISTORY_DAYS วันถึงล่วงหน้า DAYS_AHEAD วัน (seed/catalog.js, seed/schedule.js)
 * 2. ประวัติการขายที่จบแล้ว เขียนลงฐานตรงพร้อมเวลาย้อนหลัง (seed/sales.js)
 * 3. สถานการณ์ที่ยังเดินอยู่ เรียก service ตัวจริง (seed/scenarios.js)
 * รูปสลิปตัวอย่างเก็บลงที่เก็บสลิปเดียวกับ API (ดิสก์ หรือ Supabase ถ้าตั้ง SUPABASE_URL)
 */

/**
 * รหัสผ่านของบัญชีตัวอย่าง — Password123 เขียนอยู่ใน README ใช้ได้แค่ตอนพัฒนา
 * seed เว็บที่เปิดให้คนนอกเข้าได้ต้องตั้ง SEED_PASSWORD ไม่งั้นใครก็ล็อกอินเป็นผู้ดูแลได้ (ดู DEPLOY.md)
 */
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Password123';

const DAY = 24 * 60 * 60 * 1000;

const reset = async () => {
  // ลบตามลำดับความสัมพันธ์ เพื่อให้รัน seed ซ้ำได้เสมอ
  await prisma.notification.deleteMany();
  await prisma.bookingSeat.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.seatChange.deleteMany();
  // ตัวนับเลขใบเสร็จเริ่มใหม่ด้วย ใบตัวอย่างจะได้เริ่มที่ 000001
  await prisma.receiptCounter.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.zonePrice.deleteMany();
  await prisma.showtime.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.theatre.deleteMany();
  await prisma.movie.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
};

const seedUsers = async (now) => {
  // hash ครั้งเดียวแล้วใช้ร่วมกัน — bcrypt ตั้งใจให้ช้า ทำซ้ำทุกบัญชีจะหน่วง seed โดยไม่จำเป็น
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const create = ({ email, phone, name, joinedDaysAgo }, role) => {
    const joinedAt = new Date(now.getTime() - joinedDaysAgo * DAY);
    return prisma.user.create({
      data: { email, phone, name, role, passwordHash, createdAt: joinedAt, updatedAt: joinedAt },
    });
  };

  const admins = {};
  for (const admin of ADMINS) admins[admin.key] = await create(admin, 'ADMIN');
  const users = {};
  for (const customer of CUSTOMERS) {
    users[customer.key] = { ...(await create(customer, 'USER')), activity: customer.activity };
  }
  return { admins, users };
};

const seedMovies = async (now) => {
  const movies = [];
  for (const movie of MOVIES) {
    const { releaseInDays, lastShowInDays, popularity, formats, ...data } = movie;
    const releaseDate = new Date(`${dayKeyFrom(now, releaseInDays)}T00:00:00.000Z`);
    const created = await prisma.movie.create({ data: { ...data, releaseDate } });
    movies.push({ ...created, releaseInDays, lastShowInDays, popularity, formats });
  }
  return movies;
};

/** "C5" → { rowLabel: 'C', seatNumber: 5 } */
const parseSeatLabel = (label) => ({ rowLabel: label[0], seatNumber: Number(label.slice(1)) });

const seedTheatres = async () => {
  const theatres = [];
  for (const theatre of THEATRES) {
    const { basePrice, opensAt, brokenSeats = [], closedFromDay, isActive = true, ...data } = theatre;
    const created = await prisma.theatre.create({
      data: { ...data, isActive, seats: { create: buildSeatGrid(data.rowsCount, data.colsCount) } },
    });
    if (brokenSeats.length > 0) {
      await prisma.seat.updateMany({
        where: { theatreId: created.id, OR: brokenSeats.map(parseSeatLabel) },
        data: { isActive: false },
      });
    }
    const seats = await prisma.seat.findMany({ where: { theatreId: created.id } });
    theatres.push({ ...created, basePrice, opensAt, closedFromDay, seats });
  }
  return theatres;
};

const seedShowtimes = async ({ movies, theatres, random, now }) => {
  const schedule = buildSchedule({ movies, theatres, random, now });
  const created = await prisma.showtime.createManyAndReturn({
    data: schedule.map(({ movie, theatre, startsAt, endsAt, basePrice }) => ({
      movieId: movie.id,
      theatreId: theatre.id,
      startsAt,
      endsAt,
      basePrice,
    })),
    select: { id: true, theatreId: true, startsAt: true },
  });
  // จับคู่ id กลับด้วย (โรง, เวลาเริ่ม) ซึ่ง unique อยู่แล้ว
  const idOf = new Map(created.map((row) => [`${row.theatreId}|${row.startsAt.getTime()}`, row.id]));

  const showtimes = schedule.map((show) => {
    const zonePrices = buildZonePrices(show.basePrice);
    return {
      ...show,
      id: idOf.get(`${show.theatre.id}|${show.startsAt.getTime()}`),
      status: 'SCHEDULED',
      zonePrices,
      priceMap: toPriceMap(zonePrices, show.basePrice),
    };
  });
  await prisma.zonePrice.createMany({
    data: showtimes.flatMap((showtime) => showtime.zonePrices.map((zp) => ({ ...zp, showtimeId: showtime.id }))),
  });
  return showtimes;
};

const countBy = async (model, field, where) => {
  const rows = await prisma[model].groupBy({ by: [field], where, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row[field], row._count._all]));
};

const formatCounts = (counts) => {
  return Object.entries(counts)
    .map(([key, count]) => `${key} ${count}`)
    .join(' · ');
};

const printSummary = async (now, scenarioNotes) => {
  const [users, movies, theatres, showtimes, bookings, payments, seatChanges, pendingSlips, notifications, unread] =
    await Promise.all([
      countBy('user', 'role'),
      countBy('movie', 'status'),
      countBy('theatre', 'isActive'),
      Promise.all([
        prisma.showtime.count({ where: { startsAt: { lte: now } } }),
        prisma.showtime.count({ where: { startsAt: { gt: now } } }),
        prisma.showtime.count({ where: { status: 'CANCELLED' } }),
      ]),
      countBy('booking', 'status'),
      countBy('payment', 'status'),
      countBy('seatChange', 'status'),
      prisma.payment.count({ where: PENDING_SLIP_WHERE }),
      prisma.notification.count(),
      prisma.notification.count({ where: { readAt: null } }),
    ]);
  const slips = slipCounts();
  const storage = isSupabaseConfigured
    ? `Supabase bucket "${env.SUPABASE_SLIP_BUCKET}"`
    : path.relative(SERVER_ROOT, SLIP_DIR);

  console.log(`   ✓ ผู้ใช้: ${formatCounts(users)}`);
  console.log(`   ✓ ภาพยนตร์: ${formatCounts(movies)}`);
  console.log(`   ✓ โรง: เปิด ${theatres.true ?? 0} · ปิดใช้งาน ${theatres.false ?? 0}`);
  console.log(
    `   ✓ รอบฉาย: ฉายไปแล้ว ${showtimes[0]} · กำลังจะฉาย ${showtimes[1]} · ถูกยกเลิก ${showtimes[2]} ` +
      `(ย้อนหลัง ${HISTORY_DAYS} วัน ถึงล่วงหน้า ${DAYS_AHEAD} วัน)`,
  );
  console.log(`   ✓ การจอง: ${formatCounts(bookings)}`);
  console.log(`   ✓ รายการเงิน: ${formatCounts(payments)} (สลิปรอตรวจในคิว ${pendingSlips})`);
  console.log(`   ✓ คำขอเปลี่ยนที่นั่ง: ${formatCounts(seatChanges)}`);
  console.log(`   ✓ แจ้งเตือน ${notifications} รายการ (ยังไม่อ่าน ${unread})`);
  console.log(`   ✓ รูปสลิปตัวอย่าง: โอนเข้า ${slips.payment} · โอนคืน ${slips.refund} → ${storage}`);
  for (const note of scenarioNotes) console.log(`   • ${note}`);
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * ฐานข้อมูลอยู่เครื่องอื่น (เช่น seed เว็บจริงตาม DEPLOY.md) แต่ไม่ได้ตั้ง Supabase Storage — รูปสลิปตัวอย่างจึงไปอยู่ในดิสก์
 * ของเครื่องที่รัน seed ซึ่ง API บนเซิร์ฟเวอร์มองไม่เห็น ผู้ดูแลจะเจอแต่ "ไม่มีรูปสลิป" ทุกใบ
 */
const slipsOnWrongMachine = () => {
  if (isSupabaseConfigured) return false;
  try {
    return !LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname);
  } catch {
    return false;
  }
};

const main = async () => {
  console.log('🌱 เริ่ม seed ข้อมูล...');
  const now = new Date();
  const random = createRandom();
  await reset();

  const { admins, users } = await seedUsers(now);
  const movies = await seedMovies(now);
  const theatres = await seedTheatres();
  const showtimes = await seedShowtimes({ movies, theatres, random, now });

  const world = {
    now,
    random,
    admins,
    users,
    bookers: Object.values(users).filter((user) => user.activity > 0),
    showtimes,
    inventory: new Map(theatres.map((theatre) => [theatre.id, buildInventory(theatre.seats)])),
    // ระหว่างสุ่มยอดขาย: รอบ → ที่นั่งที่ขายไปแล้ว · รอบ → ลูกค้าที่จองรอบนั้นแล้ว (ดู sales.js)
    taken: new Map(),
    bookedUsers: new Map(),
  };

  const targets = chooseTargets(world);
  const pinned = await seedSales(world, { pins: pinsFor(world, targets), targets });
  const scenarioNotes = await runScenarios(world, targets, pinned);

  await printSummary(now, scenarioNotes);

  console.log('\n✅ seed เสร็จสมบูรณ์');
  console.log('   ผู้ดูแลระบบ : admin@cinebook.test (หรือเบอร์ 0800000000) · staff@cinebook.test');
  console.log('   ผู้ใช้ทั่วไป : somchai@example.test (หรือเบอร์ 0891234567) — มีการจองครบทุกแท็บ');
  console.log(`   ลูกค้าอื่น ๆ : ${CUSTOMERS.length - 1} บัญชี @example.test (ดูรายชื่อใน prisma/seed/catalog.js)`);
  // รหัสที่ตั้งเองไม่พิมพ์ออกมา — กันไปค้างอยู่ใน log หรือประวัติเทอร์มินัล
  console.log(
    `   รหัสผ่านทุกบัญชี : ${process.env.SEED_PASSWORD ? '(ตามค่า SEED_PASSWORD)' : DEMO_PASSWORD}`,
  );
  console.log(
    `   ⏱  การจองที่ยังรอชำระจะหมดเวลาภายใน ${env.SEAT_HOLD_MINUTES} นาทีหลังเปิด API ตามกติกาจริง\n`,
  );
  if (slipsOnWrongMachine()) {
    console.warn('   ⚠  ฐานข้อมูลไม่ได้อยู่บนเครื่องนี้ แต่ไม่ได้ตั้ง SUPABASE_URL — รูปสลิปตัวอย่างถูกเขียนลงดิสก์ของเครื่องนี้');
    console.warn('      เว็บที่ใช้ฐานนี้จะเปิดรูปสลิปไม่ได้ ให้ตั้ง SUPABASE_URL กับ SUPABASE_SECRET_KEY แล้ว seed ใหม่ (ดู DEPLOY.md)\n');
  }
};

main()
  .catch((err) => {
    console.error('❌ seed ล้มเหลว:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
