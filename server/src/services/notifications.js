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
  // closed = การจองปิดไปแล้ว (รอบเริ่มฉาย หรือเป็นสลิปที่ส่งหลังหมดเวลา) จึงไม่ได้ให้จ่ายใหม่
  PAYMENT_REJECTED: (ctx) =>
    ctx.closed
      ? {
          titleTh: 'สลิปไม่ผ่านการตรวจสอบ',
          titleEn: 'Slip was rejected',
          bodyTh: `สลิปของการจอง ${ctx.code} ไม่ผ่านการตรวจสอบ (${ctx.reason}) และการจองนี้ปิดแล้ว หากโอนเงินไปแล้วจริงกรุณาติดต่อเจ้าหน้าที่พร้อมรหัสการจอง`,
          bodyEn: `The slip for booking ${ctx.code} was rejected (${ctx.reason}) and the booking is now closed. If you did transfer the money, please contact us with your booking code.`,
        }
      : {
          titleTh: 'สลิปไม่ผ่านการตรวจสอบ',
          titleEn: 'Slip was rejected',
          bodyTh: `การจอง ${ctx.code} ยังไม่สำเร็จ (${ctx.reason}) กรุณาชำระเงินและส่งสลิปใหม่อีกครั้ง`,
          bodyEn: `Booking ${ctx.code} was not approved (${ctx.reason}). Please pay and upload the slip again.`,
        },
  LATE_PAYMENT_REFUND: (ctx) => ({
    titleTh: 'ได้รับเงินแล้ว — จะโอนคืนให้',
    titleEn: 'Payment received — refund on the way',
    bodyTh: `เราได้รับเงิน ${ctx.amount} บาท ของการจอง ${ctx.code} แล้ว แต่ที่นั่งถูกปล่อยไปก่อนสลิปมาถึง จึงจะโอนเงินคืนให้ กรุณาแจ้งบัญชีรับเงินคืนที่หน้า "การจองของฉัน"`,
    bodyEn: `We received ${ctx.amount} THB for booking ${ctx.code}, but the seats were released before your slip arrived, so we will refund you. Please add your bank account on the "My bookings" page.`,
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
  SHOWTIME_CANCELLED: (ctx) => ({
    titleTh: 'รอบฉายถูกยกเลิก',
    titleEn: 'Showtime cancelled',
    bodyTh:
      `รอบ "${ctx.movieTh}" ${ctx.whenTh} ถูกยกเลิก${ctx.reason ? ` (${ctx.reason})` : ''} ` +
      `การจอง ${ctx.code} จึงถูกยกเลิกด้วย` +
      (ctx.refund ? ' เราจะโอนเงินคืนให้ กรุณาแจ้งบัญชีรับเงินคืนที่หน้า "การจองของฉัน"' : ''),
    bodyEn:
      `The "${ctx.movieEn}" showtime on ${ctx.whenEn} was cancelled${ctx.reason ? ` (${ctx.reason})` : ''}, ` +
      `so booking ${ctx.code} was cancelled too.` +
      (ctx.refund ? ' We will refund you — please add your bank account on the "My bookings" page.' : ''),
  }),
};

/**
 * ข้อมูลหนึ่งแถวของการแจ้งเตือน (ยังไม่บันทึก) — แยกออกมาให้ทั้ง notify ทีละใบ
 * และ createMany ตอนแจ้งหลายคนพร้อมกัน (เช่น ยกเลิกทั้งรอบ) ใช้ข้อความชุดเดียวกัน
 */
export const buildNotification = ({ userId, type, context = {}, data = null }) => {
  return { userId, type, ...templates[type](context), data };
};

/**
 * สร้างการแจ้งเตือน — ส่ง `client` เป็น tx ได้เมื่อเรียกจากใน transaction
 * @param {keyof typeof templates} type
 */
export const notify = (notification, client = prisma) => {
  return client.notification.create({ data: buildNotification(notification) });
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
