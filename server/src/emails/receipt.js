/**
 * เนื้อหาอีเมล "ใบเสร็จรับเงิน" ที่ส่งหลังผู้ดูแลอนุมัติสลิป
 * mailer = ส่งยังไง · ไฟล์นี้ = เขียนว่าอะไร
 *
 * ใช้ label สองภาษาในฉบับเดียว ("ไทย / English" แบบใบเสร็จทั่วไปในไทย)
 * เพราะระบบไม่ได้เก็บภาษาที่ผู้ใช้เลือกไว้ และเมลนี้เกิดจากผู้ดูแลกดอนุมัติ ไม่ใช่จากหน้าเว็บของลูกค้า
 * เนื้อหาเป็นสรุปใบเสร็จ ส่วนฉบับเต็มที่พิมพ์/บันทึก PDF ได้อยู่บนหน้าเว็บตามลิงก์ในเมล
 */
import { escapeHtml } from './html.js';
import { formatBangkokLong } from '../utils/datetime.js';

const METHOD_LABEL = { PROMPTPAY: 'พร้อมเพย์ / PromptPay' };

const money = (amount) => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const bilingualDate = (date) => {
  return `${formatBangkokLong(date, 'th')} (${formatBangkokLong(date, 'en')})`;
};

const movieTitle = ({ titleTh, titleEn }) => {
  return titleEn && titleEn !== titleTh ? `${titleTh} (${titleEn})` : titleTh;
};

export const receiptEmail = ({ receipt, receiptUrl, ticketUrl }) => {
  const { issuer, showtime, payment } = receipt;
  // ใบเสร็จส่วนต่างเปลี่ยนที่นั่งมีบรรทัดเดียวที่บอกว่าย้ายจากไหนไปไหน ส่วนใบหลักไล่ที่นั่งทุกบรรทัด
  const seatChange = receipt.lines.find((line) => line.kind === 'SEAT_CHANGE');
  const seatRow = seatChange
    ? ['ส่วนต่างเปลี่ยนที่นั่ง / Seat change', `${seatChange.fromSeats.join(', ')} → ${seatChange.toSeats.join(', ')}`]
    : ['ที่นั่ง / Seats', receipt.lines.flatMap((line) => line.seats).join(', ')];
  const method = METHOD_LABEL[payment.method] ?? payment.method;

  const rows = [
    ['เลขที่ / Receipt no.', receipt.receiptNo],
    ['วันที่ / Date', bilingualDate(receipt.issuedAt)],
    ['ได้รับเงินจาก / Received from', receipt.customer.name],
    ['รหัสการจอง / Booking code', receipt.booking.code],
    ['ภาพยนตร์ / Movie', movieTitle(showtime.movie)],
    ['รอบฉาย / Showtime', `${bilingualDate(showtime.startsAt)} · ${showtime.theatre.name}`],
    seatRow,
    ['ชำระโดย / Paid via', `${method} · Ref. ${payment.reference}`],
  ];
  const total = `${money(receipt.totalAmount)} บาท (THB)`;
  const amountInWords = `(${receipt.amountTextTh} / ${receipt.amountTextEn})`;
  const electronicNote = 'ใบเสร็จนี้ออกโดยระบบอิเล็กทรอนิกส์ / This receipt was issued electronically.';

  const subject = `ใบเสร็จรับเงิน / Receipt ${receipt.receiptNo} · ${issuer.name}`;

  const text = [
    issuer.name,
    ...(issuer.address ? [issuer.address] : []),
    'ใบเสร็จรับเงิน / Receipt',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `รวมทั้งสิ้น / Total: ${total}`,
    amountInWords,
    '',
    'เปิดหรือพิมพ์ใบเสร็จฉบับเต็ม / View or print the full receipt:',
    receiptUrl,
    '',
    'E-Ticket:',
    ticketUrl,
    '',
    electronicNote,
  ].join('\n');

  // พื้นสว่างและกำหนดสีเองทั้งหมดเหมือนอีเมลตั้งรหัสผ่าน — อ่านได้ทั้งในโปรแกรมอ่านเมลที่เป็นธีมมืดและสว่าง
  const rowHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b6b78;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1a1a20">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');

  const html = `
<div style="margin:0;padding:24px;background:#f4f4f6;font-family:'Segoe UI',Tahoma,sans-serif;color:#1a1a20">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <p style="margin:0;font-size:18px;font-weight:700;color:#1a1a20">${escapeHtml(issuer.name)}</p>
    ${issuer.address ? `<p style="margin:4px 0 0;font-size:12px;color:#6b6b78">${escapeHtml(issuer.address)}</p>` : ''}
    <p style="margin:24px 0 4px;font-size:12px;letter-spacing:1px;color:#6b6b78">ใบเสร็จรับเงิน / RECEIPT</p>
    <p style="margin:0 0 16px;font-size:22px;font-weight:700;font-family:Consolas,'Courier New',monospace;color:#1a1a20">${escapeHtml(receipt.receiptNo)}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${rowHtml}
    </table>
    <div style="margin:20px 0 24px;padding:16px;border:1px solid #e4e4ea;border-radius:12px">
      <p style="margin:0;font-size:13px;color:#6b6b78">รวมทั้งสิ้น / Total</p>
      <p style="margin:4px 0;font-size:24px;font-weight:700;color:#1a1a20">${escapeHtml(total)}</p>
      <p style="margin:0;font-size:13px;color:#6b6b78">${escapeHtml(amountInWords)}</p>
    </div>
    <p style="margin:0 0 12px">
      <a href="${escapeHtml(receiptUrl)}"
         style="display:inline-block;background:#f5b301;color:#1a1a20;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px">
        เปิด / พิมพ์ใบเสร็จ · View receipt
      </a>
    </p>
    <p style="margin:0 0 24px;font-size:13px">
      <a href="${escapeHtml(ticketUrl)}" style="color:#9a7400">E-Ticket</a>
    </p>
    <p style="margin:0;font-size:12px;color:#6b6b78">${escapeHtml(electronicNote)}</p>
  </div>
</div>`.trim();

  return { subject, text, html };
};
