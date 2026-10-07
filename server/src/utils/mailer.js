import nodemailer from 'nodemailer';
import { env, isDev, isMailConfigured, SMTP_SECURE } from '../config/env.js';

/**
 * สร้าง transporter ครั้งเดียวแล้วใช้ซ้ำ — nodemailer คง connection pool ไว้ให้เอง
 * สร้างแบบ lazy เพราะถ้าไม่มีใครส่งเมลเลยก็ไม่ต้องเปิดการเชื่อมต่อทิ้งไว้
 */
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: SMTP_SECURE,
      // ผู้ให้บริการบางเจ้า (เช่น SMTP ภายในองค์กร) ไม่ต้องล็อกอิน จึงส่ง auth ไปเฉพาะตอนที่ตั้งค่าไว้
      ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }),
    });
  }
  return transporter;
};

/** พิมพ์เนื้อเมลลง console แบบอ่านง่าย ใช้ตอนยังไม่ได้ตั้ง SMTP */
const printToConsole = ({ to, subject, text }) => {
  const body = text
    .trim()
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n');
  console.log(
    [
      '',
      '📧 ─── อีเมลขาออก (ยังไม่ได้ตั้ง SMTP_HOST จึงยังไม่ส่งจริง) ───',
      `   ถึง: ${to}`,
      `   เรื่อง: ${subject}`,
      '',
      body,
      '───────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
};

/** เหลือแค่โดเมนของผู้รับ — พอให้รู้ว่ามีเมลตกหล่น โดยไม่เก็บที่อยู่อีเมลของลูกค้าไว้ใน log */
const maskRecipient = (to) => String(to ?? '').replace(/^[^@]*/, '***');

/**
 * ส่งอีเมล — คืน `delivered` บอกว่าออกไปทาง SMTP จริงหรือไม่
 *
 * ตั้งใจไม่โยน error ต่อ เพราะทุกที่ที่เรียกใช้ตอนนี้ไม่ควรพังตามเมล
 * (ขอลิงก์ตั้งรหัสผ่านแล้วเซิร์ฟเวอร์เมลล่ม ผู้ใช้ก็ยังควรได้หน้าตอบกลับปกติ)
 * ความล้มเหลวไปโผล่ที่ log ของเซิร์ฟเวอร์แทน
 */
export const sendMail = async ({ to, subject, text, html }) => {
  if (!isMailConfigured) {
    // พิมพ์ทั้งฉบับเฉพาะตอนพัฒนา จะได้กดลิงก์ทดสอบจนจบขั้นตอนได้โดยไม่ต้องมีเมลเซิร์ฟเวอร์
    // production ห้ามพิมพ์เนื้อเมล — ลิงก์ตั้งรหัสผ่านใน log = ใครเปิด log ได้ก็ยึดบัญชีนั้นได้ (log มักถูกส่งต่อไปเก็บที่อื่นด้วย)
    // ตอนรันเทสต์ไม่ต้องพิมพ์อะไรเลย — ทุกการอนุมัติสลิปส่งใบเสร็จ ถ้าพิมพ์หมดผลเทสต์จะจมอยู่ใต้เนื้ออีเมล
    if (isDev) printToConsole({ to, subject, text });
    else if (env.NODE_ENV === 'production') {
      console.warn(`[mail] ยังไม่ได้ตั้ง SMTP_HOST — ไม่ได้ส่งอีเมล "${subject}" ถึง ${maskRecipient(to)}`);
    }
    return { delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
    return { delivered: true };
  } catch (error) {
    console.error(`[mail] ส่งอีเมลถึง ${to} ไม่สำเร็จ:`, error.message);
    return { delivered: false, reason: 'SEND_FAILED' };
  }
};
