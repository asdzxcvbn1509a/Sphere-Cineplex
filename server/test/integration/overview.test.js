import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../src/lib/prisma.js';
import { cancelBooking } from '../../src/services/bookings.js';
import { getOverview } from '../../src/services/reports.js';
import { requestSeatChange } from '../../src/services/seatChanges.js';
import { disconnectDb, resetDb, setupDatabase } from '../helpers/db.js';
import { createAdmin, createPaidBooking, createShowtimeFixture, createUser } from '../helpers/fixtures.js';

before(setupDatabase);
beforeEach(resetDb);
after(disconnectDb);

/**
 * หน้าภาพรวมของผู้ดูแล — โรงทดสอบ 3 แถว × 4 ที่ ราคาฐาน 200
 * seats[0..3] = A1–A4 ธรรมดา 200 · seats[4..7] = B1–B4 พรีเมียม 280 · seats[8..11] = C1–C4 พรีเมียม 280
 */
describe('ภาพรวมของผู้ดูแล', () => {
  test('รายได้เมื่อวานนับตั้งแต่เที่ยงคืนถึงเวลาเดียวกับตอนนี้เท่านั้น', async () => {
    // เวลาตายตัว 12:00 น. เวลาไทย — ไม่อิงนาฬิกาจริง เทสต์จะไม่พังเมื่อรันใกล้เที่ยงคืน
    const now = new Date('2026-03-10T12:00:00+07:00');
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);

    // ยอดไม่ซ้ำกันทุกใบ ผลรวมจึงบอกได้ว่านับใบไหนไปบ้าง
    const cases = [
      { seats: [seats[0]], paidAt: '2026-03-10T09:00:00+07:00' }, // วันนี้ · 200
      { seats: [seats[1], seats[2]], paidAt: '2026-03-09T11:59:00+07:00' }, // เมื่อวานก่อนเวลาตัด · 400
      { seats: [seats[4]], paidAt: '2026-03-09T12:00:00+07:00' }, // เมื่อวานตรงเวลาตัดพอดี ไม่นับ · 280
      { seats: [seats[5], seats[6]], paidAt: '2026-03-08T23:59:00+07:00' }, // เมื่อวานซืน · 560
    ];
    // จองทีละใบ — ผู้ใช้คนเดียวมีการจองที่ยังไม่จ่ายของรอบเดียวกันค้างพร้อมกันไม่ได้
    for (const item of cases) {
      const paid = await createPaidBooking({ user, admin, showtime, seats: item.seats });
      await prisma.booking.update({ where: { id: paid.id }, data: { paidAt: new Date(item.paidAt) } });
    }

    const overview = await getOverview(now);
    assert.equal(overview.date, '2026-03-10');
    assert.equal(overview.generatedAt.getTime(), now.getTime());
    assert.equal(overview.revenueToday, 200);
    assert.equal(overview.bookingsToday, 1);
    assert.equal(overview.revenueYesterday, 400);
  });

  test('แถวคืนเงินบอกชนิดรายการ — คืนส่วนต่างเปลี่ยนที่นั่ง กับยกเลิกการจองที่จ่ายแล้ว', async () => {
    const { showtime, seats } = await createShowtimeFixture();
    const [admin, user] = await Promise.all([createAdmin(), createUser()]);

    // ย้ายจาก B1+B2 (พรีเมียม) ไป B1+A1 — ถูกลง 80 บาท ส่วนต่างเข้าคิวคืนเงิน
    const moved = await createPaidBooking({ user, admin, showtime, seats: [seats[4], seats[5]] });
    await requestSeatChange({
      bookingId: moved.id,
      userId: user.id,
      seatIds: [seats[4].id, seats[0].id],
      refundAccount: { bankName: 'ธนาคารกสิกรไทย', accountNo: '1234567890' },
    });

    // จ่ายแล้วถูกผู้ดูแลยกเลิก — ค่าตั๋วทั้งใบเข้าคิวคืนเงิน
    const cancelled = await createPaidBooking({ user, admin, showtime, seats: [seats[8]] });
    await cancelBooking({ bookingId: cancelled.id, byAdmin: true });

    const overview = await getOverview();
    // เรียงก่อนเทียบ — สองใบอาจอัปเดตในมิลลิวินาทีเดียวกัน ลำดับตาม updatedAt จึงไม่แน่นอน
    assert.deepEqual(
      overview.recentRefunds.map((row) => [row.code, row.kind, row.amount, row.status]).sort(),
      [
        [moved.code, 'SEAT_CHANGE_REFUND', 80, 'REFUND_PENDING'],
        [cancelled.code, 'BOOKING', 280, 'REFUND_PENDING'],
      ].sort(),
    );
    // ยังไม่มีรายได้เมื่อวาน — ได้ 0 ไม่ใช่ null หน้าเว็บจะซ่อน % เทียบเอง
    assert.equal(overview.revenueYesterday, 0);
  });
});
