import prisma from '../src/lib/prisma.js';
import { buildSeatGrid } from '../src/services/theatres.js';
import { buildZonePrices, toPriceMap } from '../src/utils/pricing.js';
import { generateBookingCode, generatePaymentReference } from '../src/utils/codes.js';
import { createPromptPayPayload } from '../src/utils/promptpay.js';
import { BANGKOK_OFFSET_MS, bangkokDateKey } from '../src/utils/datetime.js';
import { hashPassword } from '../src/utils/password.js';
import { issueReceiptNo } from '../src/services/receipts.js';

/**
 * รหัสผ่านของบัญชีตัวอย่าง — Password123 เขียนอยู่ใน README ใช้ได้แค่ตอนพัฒนา
 * seed เว็บที่เปิดให้คนนอกเข้าได้ต้องตั้ง SEED_PASSWORD ไม่งั้นใครก็ล็อกอินเป็นผู้ดูแลได้ (ดู DEPLOY.md)
 */
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Password123';

/** สร้าง Date จากวัน+ชั่วโมงตามเวลาไทย */
const bangkokTime = (dateKey, hour, minute = 0) => {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(Date.parse(`${dateKey}T${hh}:${mm}:00.000Z`) - BANGKOK_OFFSET_MS);
};

const dayKeyOffset = (offsetDays) => {
  return bangkokDateKey(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
};

const poster = (slug) => `https://picsum.photos/seed/${slug}/400/600`;
const backdrop = (slug) => `https://picsum.photos/seed/${slug}-bd/1280/720`;

const movies = [
  {
    titleTh: 'ฤดูฝนที่หายไป',
    titleEn: 'The Vanished Monsoon',
    synopsisTh:
      'เรื่องราวของช่างภาพสารคดีที่กลับบ้านเกิดในหน้าฝน แล้วพบว่าหมู่บ้านทั้งหมู่บ้านจำเธอไม่ได้ ระหว่างตามหาคำตอบ เธอค่อย ๆ ค้นพบความลับที่ครอบครัวเก็บงำมานานยี่สิบปี',
    synopsisEn:
      'A documentary photographer returns to her hometown during the rainy season to find that no one remembers her. Her search for answers unearths a secret her family buried twenty years ago.',
    posterUrl: poster('monsoon'),
    backdropUrl: backdrop('monsoon'),
    durationMin: 118,
    rating: 'PG13',
    genres: ['ดราม่า', 'ลึกลับ'],
    releaseDate: new Date('2026-08-14'),
    status: 'NOW_SHOWING',
  },
  {
    titleTh: 'ล่าข้ามมิติ',
    titleEn: 'Rift Runner',
    synopsisTh:
      'นักวิ่งส่งของในกรุงเทพฯ ปี 2078 บังเอิญได้ครอบครองอุปกรณ์ที่เปิดรอยแยกระหว่างมิติ เขามีเวลา 12 ชั่วโมงในการส่งของชิ้นสุดท้าย ก่อนที่เมืองทั้งเมืองจะถูกกลืนหายไป',
    synopsisEn:
      'A courier in 2078 Bangkok stumbles upon a device that tears open the space between worlds. He has twelve hours to complete one last delivery before the city collapses into the rift.',
    posterUrl: poster('rift'),
    backdropUrl: backdrop('rift'),
    durationMin: 132,
    rating: 'PG13',
    genres: ['ไซไฟ', 'แอ็คชั่น'],
    releaseDate: new Date('2026-08-28'),
    status: 'NOW_SHOWING',
  },
  {
    titleTh: 'บ้านเลขที่ 13',
    titleEn: 'House No. 13',
    synopsisTh:
      'ครอบครัวหนึ่งย้ายเข้าบ้านเช่าราคาถูกผิดปกติในซอยเปลี่ยว คืนแรกที่ย้ายเข้า เสียงเคาะประตูดังขึ้นสิบสามครั้งตรงเวลาเที่ยงคืน และดังต่อเนื่องทุกคืนไม่มีขาด',
    synopsisEn:
      'A family moves into a suspiciously cheap rental house. On the first night, thirteen knocks land on the door at exactly midnight — and every night after that.',
    posterUrl: poster('house13'),
    backdropUrl: backdrop('house13'),
    durationMin: 105,
    rating: 'N15',
    genres: ['สยองขวัญ', 'ระทึกขวัญ'],
    releaseDate: new Date('2026-09-01'),
    status: 'NOW_SHOWING',
  },
  {
    titleTh: 'รักครั้งสุดท้ายที่เชียงคาน',
    titleEn: 'Last Love in Chiang Khan',
    synopsisTh:
      'ชายหนุ่มผู้สูญเสียความทรงจำระยะสั้นเดินทางไปเชียงคานทุกปีเพื่อตามหาใครบางคนที่เขาจำหน้าไม่ได้ แต่จำความรู้สึกได้ทุกครั้ง',
    synopsisEn:
      'A young man with short-term memory loss travels to Chiang Khan every year, searching for someone whose face he cannot recall but whose presence he always feels.',
    posterUrl: poster('chiangkhan'),
    backdropUrl: backdrop('chiangkhan'),
    durationMin: 112,
    rating: 'G',
    genres: ['โรแมนติก', 'ดราม่า'],
    releaseDate: new Date('2026-07-24'),
    status: 'NOW_SHOWING',
  },
  {
    titleTh: 'ปฏิบัติการล่าฝัน',
    titleEn: 'Operation Daydream',
    synopsisTh:
      'พนักงานออฟฟิศสี่คนตัดสินใจลาออกพร้อมกันเพื่อเปิดร้านก๋วยเตี๋ยวเรือ แต่ทำเลที่เลือกดันอยู่ตรงข้ามร้านของอดีตเจ้านาย',
    synopsisEn:
      'Four office workers quit on the same day to open a boat-noodle shop — directly across the street from their former boss.',
    posterUrl: poster('daydream'),
    backdropUrl: backdrop('daydream'),
    durationMin: 98,
    rating: 'G',
    genres: ['ตลก', 'ฟีลกู๊ด'],
    releaseDate: new Date('2026-08-07'),
    status: 'NOW_SHOWING',
  },
  {
    titleTh: 'ตำนานนาคี ภาค 4',
    titleEn: 'Naga Legend IV',
    synopsisTh:
      'บทสรุปของตำนานพญานาคแห่งลุ่มน้ำโขง เมื่อคำสาบานเมื่อสามร้อยปีก่อนถูกทวงคืนในคืนวันออกพรรษา',
    synopsisEn:
      'The finale of the Mekong naga saga, as a three-hundred-year-old oath comes due on the night of the end of Buddhist Lent.',
    posterUrl: poster('naga'),
    backdropUrl: backdrop('naga'),
    durationMin: 140,
    rating: 'PG13',
    genres: ['แฟนตาซี', 'ผจญภัย'],
    releaseDate: new Date('2026-10-09'),
    status: 'COMING_SOON',
  },
];

const theatres = [
  { name: 'โรงที่ 1', screenType: '2D', rowsCount: 8, colsCount: 12, basePrice: 180 },
  { name: 'โรงที่ 2', screenType: '3D', rowsCount: 7, colsCount: 14, basePrice: 220 },
  { name: 'โรงที่ 3 (IMAX)', screenType: 'IMAX', rowsCount: 10, colsCount: 16, basePrice: 300 },
];

const SLOT_HOURS = [11, 14, 17, 20];
const DAYS_AHEAD = 7;

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

const main = async () => {
  console.log('🌱 เริ่ม seed ข้อมูล...');
  await reset();

  // hash ครั้งเดียวแล้วใช้ร่วมกัน — bcrypt ตั้งใจให้ช้า ทำซ้ำทุกบัญชีจะหน่วง seed โดยไม่จำเป็น
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@cinebook.test',
      phone: '0800000000',
      name: 'ผู้ดูแลระบบ',
      role: 'ADMIN',
      passwordHash,
    },
  });
  const customer = await prisma.user.create({
    data: {
      email: 'somchai@example.test',
      phone: '0891234567',
      name: 'สมชาย ใจดี',
      passwordHash,
    },
  });
  console.log(`   ✓ ผู้ใช้ 2 คน (admin: ${admin.email}, user: ${customer.email})`);

  const createdMovies = [];
  for (const movie of movies) {
    createdMovies.push(await prisma.movie.create({ data: movie }));
  }
  console.log(`   ✓ ภาพยนตร์ ${createdMovies.length} เรื่อง`);

  const createdTheatres = [];
  for (const theatre of theatres) {
    const { basePrice, ...data } = theatre;
    const created = await prisma.theatre.create({
      data: { ...data, seats: { create: buildSeatGrid(data.rowsCount, data.colsCount) } },
      include: { _count: { select: { seats: true } } },
    });
    createdTheatres.push({ ...created, basePrice });
    console.log(`   ✓ ${created.name}: ${created._count.seats} ที่นั่ง`);
  }

  const nowShowing = createdMovies.filter((m) => m.status === 'NOW_SHOWING');
  let showtimeCount = 0;

  for (let day = 0; day < DAYS_AHEAD; day += 1) {
    const dateKey = dayKeyOffset(day);
    for (let t = 0; t < createdTheatres.length; t += 1) {
      const theatre = createdTheatres[t];
      for (let s = 0; s < SLOT_HOURS.length; s += 1) {
        const movie = nowShowing[(day + t * 2 + s) % nowShowing.length];
        const startsAt = bangkokTime(dateKey, SLOT_HOURS[s]);
        // ข้ามรอบที่เวลาผ่านไปแล้วของวันนี้
        if (startsAt <= new Date()) continue;

        await prisma.showtime.create({
          data: {
            movieId: movie.id,
            theatreId: theatre.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + movie.durationMin * 60 * 1000),
            basePrice: theatre.basePrice,
            zonePrices: { create: buildZonePrices(theatre.basePrice) },
          },
        });
        showtimeCount += 1;
      }
    }
  }
  console.log(`   ✓ รอบฉาย ${showtimeCount} รอบ (${DAYS_AHEAD} วันข้างหน้า)`);

  await seedSampleBookings(customer);

  console.log('\n✅ seed เสร็จสมบูรณ์');
  console.log('   ผู้ดูแลระบบ : admin@cinebook.test (หรือเบอร์ 0800000000)');
  console.log('   ผู้ใช้ทั่วไป : somchai@example.test (หรือเบอร์ 0891234567)');
  // รหัสที่ตั้งเองไม่พิมพ์ออกมา — กันไปค้างอยู่ใน log หรือประวัติเทอร์มินัล
  console.log(
    `   รหัสผ่านทั้งสองบัญชี : ${process.env.SEED_PASSWORD ? '(ตามค่า SEED_PASSWORD)' : DEMO_PASSWORD}\n`,
  );
};

/** ใส่การจองที่ชำระแล้วไว้บ้าง เพื่อให้หน้ารายงานของ admin และหน้าใบเสร็จมีข้อมูลให้ดูทันที */
const seedSampleBookings = async (customer) => {
  const showtimes = await prisma.showtime.findMany({
    take: 3,
    orderBy: { startsAt: 'asc' },
    include: { zonePrices: true, theatre: true },
  });

  let created = 0;
  const paid = [];
  for (const [index, showtime] of showtimes.entries()) {
    const seats = await prisma.seat.findMany({
      where: { theatreId: showtime.theatreId },
      orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }],
      skip: 3 + index * 5,
      take: 2,
    });
    if (seats.length < 2) continue;

    const priceMap = toPriceMap(showtime.zonePrices, showtime.basePrice);
    const seatSnapshot = seats.map((seat) => ({
      id: seat.id,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      label: `${seat.rowLabel}${seat.seatNumber}`,
      zone: seat.zone,
      price: priceMap[seat.zone],
    }));
    const total = seatSnapshot.reduce((sum, seat) => sum + seat.price, 0);
    const paidAt = new Date(Date.now() - (index + 1) * 12 * 60 * 60 * 1000);

    const booking = await prisma.booking.create({
      data: {
        code: generateBookingCode(),
        userId: customer.id,
        showtimeId: showtime.id,
        status: 'PAID',
        totalAmount: total,
        holdExpiresAt: null,
        paidAt,
        seatSnapshot,
        seats: {
          create: seatSnapshot.map((seat) => ({
            showtimeId: showtime.id,
            seatId: seat.id,
            price: seat.price,
          })),
        },
      },
    });

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        // ใบหลัก (ค่าตั๋วตอนจอง) — booking.payment อ่านผ่านตัวนี้
        mainBookingId: booking.id,
        amount: total,
        qrPayload: createPromptPayPayload(total),
        reference: generatePaymentReference(),
        status: 'APPROVED',
        slipUploadedAt: paidAt,
        verifiedAt: paidAt,
      },
    });
    paid.push({ paymentId: payment.id, paidAt, seatSnapshot });
    created += 1;
  }

  // ออกเลขใบเสร็จตามเวลาที่จ่ายจริง (เก่าไปใหม่) แบบเดียวกับตอนอนุมัติสลิป — ลูปข้างบนสร้างใบที่จ่ายล่าสุดก่อน
  paid.sort((a, b) => a.paidAt - b.paidAt);
  for (const { paymentId, paidAt, seatSnapshot } of paid) {
    const receiptNo = await issueReceiptNo(prisma, paidAt);
    await prisma.payment.update({
      where: { id: paymentId },
      data: { receiptNo, receiptName: customer.name, receiptSeats: seatSnapshot },
    });
  }

  console.log(`   ✓ ตัวอย่างการจองที่ชำระแล้ว ${created} รายการ (พร้อมใบเสร็จ)`);
};

main()
  .catch((err) => {
    console.error('❌ seed ล้มเหลว:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
