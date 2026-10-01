import prisma from '../lib/prisma.js';

/**
 * ข้อความแจ้งเตือนเก็บทั้งไทยและอังกฤษไว้ในแถวเดียว
 * เพราะผู้ใช้สลับภาษาได้ตลอดเวลา — จะ render ภาษาไหนค่อยตัดสินที่ฝั่ง client
 */
const templates = {
  PAYMENT_APPROVED: (ctx) => ({
    titleTh: 'ยืนยันการชำระเงินแล้ว',
    titleEn: 'Payment confirmed',
    bodyTh: `การจอง ${ctx.code} ได้รับการยืนยันแล้ว เปิดดู E-Ticket ได้ทันที`,
    bodyEn: `Booking ${ctx.code} is confirmed. Your e-ticket is ready.`,
  }),
  REFUND_COMPLETED: (ctx) => ({
    titleTh: 'คืนเงินเรียบร้อยแล้ว',
    titleEn: 'Refund completed',
    bodyTh: `คืนเงิน ${ctx.amount} บาท ของการจอง ${ctx.code} เรียบร้อยแล้ว กรุณาตรวจสอบยอดในบัญชีของคุณ`,
    bodyEn: `We refunded ${ctx.amount} THB for booking ${ctx.code}. Please check your bank account.`,
  }),
  PAYMENT_REJECTED: (ctx) => ({
    titleTh: 'สลิปไม่ผ่านการตรวจสอบ',
    titleEn: 'Slip was rejected',
    bodyTh: `การจอง ${ctx.code} ยังไม่สำเร็จ (${ctx.reason}) กรุณาชำระเงินและส่งสลิปใหม่อีกครั้ง`,
    bodyEn: `Booking ${ctx.code} was not approved (${ctx.reason}). Please pay and upload the slip again.`,
  }),
  BOOKING_CANCELLED: (ctx) => ({
    titleTh: 'ยกเลิกการจองแล้ว',
    titleEn: 'Booking cancelled',
    bodyTh: `การจอง ${ctx.code} ถูกยกเลิกเรียบร้อย ที่นั่งถูกคืนเข้าระบบแล้ว`,
    bodyEn: `Booking ${ctx.code} has been cancelled and the seats were released.`,
  }),
  BOOKING_EXPIRED: (ctx) => ({
    titleTh: 'หมดเวลาชำระเงิน',
    titleEn: 'Payment window expired',
    bodyTh: `การจอง ${ctx.code} หมดเวลาชำระเงิน ที่นั่งถูกปล่อยให้ผู้อื่นแล้ว`,
    bodyEn: `Booking ${ctx.code} expired before payment. The seats are available to others again.`,
  }),
  SHOWTIME_REMINDER: (ctx) => ({
    titleTh: 'ใกล้ถึงเวลาฉายแล้ว',
    titleEn: 'Your movie starts soon',
    bodyTh: `"${ctx.movieTh}" รอบ ${ctx.timeText} ที่ ${ctx.theatre} — เตรียม E-Ticket ให้พร้อมนะ`,
    bodyEn: `"${ctx.movieEn}" at ${ctx.timeText}, ${ctx.theatre} — have your e-ticket ready.`,
  }),
};

/**
 * สร้างการแจ้งเตือน — ส่ง `client` เป็น tx ได้เมื่อเรียกจากใน transaction
 * @param {'PAYMENT_APPROVED'|'PAYMENT_REJECTED'|'BOOKING_CANCELLED'|'BOOKING_EXPIRED'|'SHOWTIME_REMINDER'} type
 */
export const notify = ({ userId, type, context = {}, data = null }, client = prisma) => {
  const content = templates[type](context);
  return client.notification.create({
    data: { userId, type, ...content, data },
  });
};

export const listNotifications = async (userId, { unreadOnly = false, limit = 50 } = {}) => {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(unreadOnly && { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: items, unreadCount };
};

export const markRead = async (userId, notificationId) => {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
};

export const markAllRead = async (userId) => {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
};
