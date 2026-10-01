import nodemailer from 'nodemailer';
import { env, isMailConfigured, SMTP_SECURE } from '../config/env.js';

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

/**
 * ส่งอีเมล — คืน `delivered` บอกว่าออกไปทาง SMTP จริงหรือแค่ลงคอนโซล
 *
 * ตั้งใจไม่โยน error ต่อ เพราะทุกที่ที่เรียกใช้ตอนนี้ไม่ควรพังตามเมล
 * (ขอลิงก์ตั้งรหัสผ่านแล้วเซิร์ฟเวอร์เมลล่ม ผู้ใช้ก็ยังควรได้หน้าตอบกลับปกติ)
 * ความล้มเหลวไปโผล่ที่ log ของเซิร์ฟเวอร์แทน
 */
export const sendMail = async ({ to, subject, text, html }) => {
  if (!isMailConfigured) {
    printToConsole({ to, subject, text });
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
