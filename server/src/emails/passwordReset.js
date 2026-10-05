/**
 * เนื้อหาอีเมล "ตั้งรหัสผ่านใหม่" แยกออกมาจาก mailer เพราะเป็นคนละเรื่องกัน
 * mailer = ส่งยังไง · ไฟล์นี้ = เขียนว่าอะไร
 *
 * ส่งตามภาษาที่ผู้ใช้กำลังเปิดหน้าเว็บอยู่ตอนกดขอลิงก์ ไม่ใช่ภาษาของเซิร์ฟเวอร์
 */
import { escapeHtml } from './html.js';

const APP_NAME = 'CineBook';

const COPY = {
  th: {
    subject: `ตั้งรหัสผ่านใหม่ · ${APP_NAME}`,
    greeting: (name) => `สวัสดีคุณ ${name}`,
    intro: 'มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ได้เลย',
    button: 'ตั้งรหัสผ่านใหม่',
    fallback: 'ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์',
    expiry: (minutes) => `ลิงก์นี้ใช้ได้ภายใน ${minutes} นาที และใช้ได้ครั้งเดียว`,
    ignore:
      'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไรกับอีเมลฉบับนี้ รหัสผ่านเดิมยังใช้ได้ตามปกติ',
    signature: `ทีมงาน ${APP_NAME}`,
  },
  en: {
    subject: `Reset your password · ${APP_NAME}`,
    greeting: (name) => `Hi ${name},`,
    intro: 'Someone asked to reset the password for this account. Use the button below to set a new one.',
    button: 'Set a new password',
    fallback: 'If the button does not work, copy this link into your browser:',
    expiry: (minutes) => `This link works for ${minutes} minutes and can only be used once.`,
    ignore: 'If you did not ask for this, you can ignore this email — your current password still works.',
    signature: `The ${APP_NAME} team`,
  },
};

export const passwordResetEmail = ({ name, resetUrl, ttlMinutes, lang = 'th' }) => {
  const copy = COPY[lang] ?? COPY.th;

  const text = [
    copy.greeting(name),
    '',
    copy.intro,
    '',
    resetUrl,
    '',
    copy.expiry(ttlMinutes),
    copy.ignore,
    '',
    copy.signature,
  ].join('\n');

  // อีเมลต้องอ่านได้ทั้งบนพื้นสว่างและมืด จึงกำหนดสีพื้น/สีตัวอักษรเองทั้งหมด ไม่พึ่ง default ของโปรแกรมอ่านเมล
  const html = `
<div style="margin:0;padding:24px;background:#f4f4f6;font-family:'Segoe UI',Tahoma,sans-serif;color:#1a1a20">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#1a1a20">${APP_NAME}</p>
    <p style="margin:0 0 16px;font-size:15px">${escapeHtml(copy.greeting(name))}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6">${escapeHtml(copy.intro)}</p>
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(resetUrl)}"
         style="display:inline-block;background:#f5b301;color:#1a1a20;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px">
        ${escapeHtml(copy.button)}
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b6b78">${escapeHtml(copy.fallback)}</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all">
      <a href="${escapeHtml(resetUrl)}" style="color:#9a7400">${escapeHtml(resetUrl)}</a>
    </p>
    <p style="margin:0 0 4px;font-size:13px;color:#6b6b78">${escapeHtml(copy.expiry(ttlMinutes))}</p>
    <p style="margin:0 0 24px;font-size:13px;color:#6b6b78">${escapeHtml(copy.ignore)}</p>
    <p style="margin:0;font-size:13px;color:#6b6b78">${escapeHtml(copy.signature)}</p>
  </div>
</div>`.trim();

  return { subject: copy.subject, text, html };
};
