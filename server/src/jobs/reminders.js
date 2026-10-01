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

  for (const booking of bookings) {
    const timeText = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
    }).format(booking.showtime.startsAt);

    await prisma.$transaction(async (tx) => {
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
      await tx.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: new Date() },
      });
    });
  }

  return bookings.length;
};
