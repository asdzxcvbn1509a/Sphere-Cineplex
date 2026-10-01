import prisma from '../lib/prisma.js';
import { notify } from '../services/notifications.js';

const REMINDER_LEAD_MINUTES = 60;

/** แจ้งเตือนผู้ใช้ล่วงหน้า 1 ชั่วโมงก่อนรอบฉาย (ฟีเจอร์ที่ผู้ตอบแบบสอบถามอยากได้มากที่สุด) */
export const sendShowtimeReminders = async () => {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      status: 'PAID',
      reminderSentAt: null,
      // รอบที่ถูกยกเลิกต้องไม่ไปเตือนว่า "ใกล้ถึงเวลาฉาย"
      showtime: { status: 'SCHEDULED', startsAt: { gt: now, lte: until } },
    },
    include: {
      showtime: {
        include: {
          movie: { select: { titleTh: true, titleEn: true } },
          theatre: { select: { name: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const booking of bookings) {
    const timeText = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
    }).format(booking.showtime.startsAt);

    const delivered = await prisma.$transaction(async (tx) => {
      // จองสิทธิ์ส่งก่อนค่อยสร้างแจ้งเตือน — ถ้ามีอีก process (เช่นรันเซิร์ฟเวอร์สองตัว) ส่งไปแล้ว
      // หรือการจองเพิ่งถูกยกเลิก update จะไม่โดนแถวไหน ลูกค้าจึงไม่ได้แจ้งเตือนซ้ำ/ผิดใบ
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: 'PAID', reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (count === 0) return false;
      await notify(
        {
          userId: booking.userId,
          type: 'SHOWTIME_REMINDER',
          context: {
            movieTh: booking.showtime.movie.titleTh,
            movieEn: booking.showtime.movie.titleEn,
            theatre: booking.showtime.theatre.name,
            timeText,
          },
          data: { bookingId: booking.id },
        },
        tx,
      );
      return true;
    });
    if (delivered) sent += 1;
  }

  return sent;
};
