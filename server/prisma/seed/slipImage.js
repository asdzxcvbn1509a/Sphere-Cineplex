import zlib from 'node:zlib';
import { BANGKOK_OFFSET_MS } from '../../src/utils/datetime.js';
import { removeSlip, saveSlip } from '../../src/lib/slipStorage.js';

/**
 * รูปสลิปตัวอย่างของ seed — PNG ที่วาดเอง (ไม่ต้องลง library เพิ่ม) มียอดเงิน เลขอ้างอิง และรหัสการจอง
 * ผู้ดูแลจึงลองตรวจสลิปเทียบยอดได้จริง (มีใบหนึ่งที่ยอดไม่ตรงไว้ลองกดปฏิเสธ)
 * เขียนคำว่า DEMO / NOT A REAL TRANSFER ไว้ชัด ๆ และไม่ใช้สีหรือหน้าตาของธนาคารไหน — ต้องไม่มีใครเอาไปใช้เป็นหลักฐานโอนเงินได้
 *
 * ชื่อไฟล์คงที่ (seed-pay-0001.png, seed-ref-0001.png, ...) และลบชื่อเดิมก่อนเขียนทุกครั้ง
 * รัน seed ซ้ำจึงเขียนทับชุดเดิม ไฟล์ไม่งอกเพิ่มทุกรอบ (ที่เก็บสลิปไม่เขียนทับไฟล์เดิมให้เอง — flag 'wx' / upsert: false)
 */

const WIDTH = 360;
const HEIGHT = 600;
const STRIDE = 1 + WIDTH * 3;

// ฟอนต์ 5×7 จุด (บิตซ้ายสุด = คอลัมน์แรก) เฉพาะตัวอักษรที่ใช้บนสลิป
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8],
  ':': [0, 12, 12, 0, 12, 12, 0], '*': [0, 4, 21, 14, 21, 4, 0], '/': [0, 1, 2, 4, 8, 16, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

const COLORS = {
  page: [238, 241, 244],
  card: [255, 255, 255],
  label: [104, 112, 122],
  text: [27, 31, 36],
  // สีกลาง ๆ ที่ไม่ตรงกับแบรนด์ธนาคารไหน — เขียว = เงินเข้า, คราม = เงินคืน
  payment: [31, 122, 108],
  refund: [74, 79, 181],
  onAccent: [255, 255, 255],
};

const fillRect = (raw, x, y, w, h, [r, g, b]) => {
  for (let row = y; row < y + h; row += 1) {
    let i = row * STRIDE + 1 + x * 3;
    for (let col = 0; col < w; col += 1) {
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      i += 3;
    }
  }
};

const textWidth = (text, scale) => text.length * 6 * scale - scale;

const drawText = (raw, text, x, y, scale, color) => {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] ?? GLYPHS[' '];
    glyph.forEach((bits, row) => {
      for (let col = 0; col < 5; col += 1) {
        if ((bits >> (4 - col)) & 1) fillRect(raw, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    });
    cursor += 6 * scale;
  }
};

const drawCentered = (raw, text, y, scale, color) => {
  drawText(raw, text, Math.round((WIDTH - textWidth(text, scale)) / 2), y, scale, color);
};

const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
};

const encodePng = (raw) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // 8 บิตต่อช่องสี
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

// พื้นหลัง หัวสลิป และป้ายกำกับเหมือนกันทุกใบ — วาดครั้งเดียวแล้วคัดลอกไปเติมค่าของแต่ละใบ
const templates = new Map();

const template = (kind) => {
  if (!templates.has(kind)) {
    const raw = Buffer.alloc(STRIDE * HEIGHT); // ไบต์แรกของทุกแถว = 0 (PNG filter: none)
    const accent = COLORS[kind];
    fillRect(raw, 0, 0, WIDTH, HEIGHT, COLORS.page);
    fillRect(raw, 0, 0, WIDTH, 120, accent);
    drawCentered(raw, kind === 'refund' ? 'DEMO REFUND' : 'DEMO SLIP', 30, 4, COLORS.onAccent);
    drawCentered(raw, 'SAMPLE DATA ONLY', 80, 2, COLORS.onAccent);
    fillRect(raw, 20, 140, WIDTH - 40, 390, COLORS.card);
    fillRect(raw, 20, 140, WIDTH - 40, 6, accent);
    drawText(raw, kind === 'refund' ? 'REFUND TRANSFER' : 'PROMPTPAY TRANSFER', 36, 166, 2, COLORS.label);
    drawText(raw, 'AMOUNT', 36, 206, 2, COLORS.label);
    drawText(raw, 'REF', 36, 296, 2, COLORS.label);
    drawText(raw, 'BOOKING', 36, 356, 2, COLORS.label);
    drawText(raw, 'DATE', 36, 416, 2, COLORS.label);
    drawCentered(raw, 'NOT A REAL TRANSFER', 556, 2, COLORS.label);
    templates.set(kind, raw);
  }
  return Buffer.from(templates.get(kind));
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 05 NOV 2026 14:05 ตามเวลาไทย */
const slipDate = (at) => {
  const d = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const slipAmount = (amount) => `${amount.toLocaleString('en-US')}.00 THB`;

const render = (kind, { amount, reference, code, at, to }) => {
  const raw = template(kind);
  drawText(raw, slipAmount(amount), 36, 232, 3, COLORS[kind]);
  drawText(raw, reference, 36, 320, 2, COLORS.text);
  drawText(raw, code, 36, 380, 2, COLORS.text);
  drawText(raw, slipDate(at), 36, 440, 2, COLORS.text);
  drawText(raw, to, 36, 490, 2, COLORS.text);
  return encodePng(raw);
};

/** สลิปที่ลูกค้าโอนเข้ามา — amount คือยอดที่ "เขียนบนสลิป" (ตั้งให้ไม่ตรงกับยอดที่ต้องจ่ายได้) */
export const renderPaymentSlip = ({ amount, reference, code, at }) => {
  return render('payment', { amount, reference, code, at, to: 'TO SPHERE CINEPLEX' });
};

/** สลิปที่ผู้ดูแลโอนคืน — แสดงเลขบัญชีปลายทางแค่ 4 ตัวท้าย */
export const renderRefundSlip = ({ amount, accountNo, code, at }) => {
  return render('refund', {
    amount,
    reference: `ACCOUNT ***${String(accountNo ?? '').slice(-4)}`,
    code,
    at,
    to: 'FROM SPHERE CINEPLEX',
  });
};

const counters = { payment: 0, refund: 0 };

/** ชื่อไฟล์ถัดไปของสลิปชนิดนั้น — ชื่อเดิมทุกครั้งที่รัน seed (ดูหมายเหตุบนสุด) */
export const nextSlipName = (kind) => {
  counters[kind] += 1;
  return `seed-${kind === 'refund' ? 'ref' : 'pay'}-${String(counters[kind]).padStart(4, '0')}.png`;
};

export const slipCounts = () => ({ ...counters });

/**
 * เขียนสลิปลงที่เก็บจริง (ดิสก์หรือ Supabase ตามค่า env เดียวกับ API) — jobs: [{ kind, name, render: () => Buffer }]
 * ทำทีละ 8 ไฟล์พร้อมกัน ตอน seed ฐานบน cloud จะได้ไม่ต้องรออัปโหลดทีละไฟล์
 */
export const storeSlips = async (jobs, concurrency = 8) => {
  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      const job = jobs[index];
      index += 1;
      await removeSlip(job.kind, job.name);
      await saveSlip(job.kind, job.name, { buffer: job.render(), mimetype: 'image/png' });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
};

/** สร้างและเก็บสลิปหนึ่งใบ แล้วคืนในรูปเดียวกับที่ middleware อัปโหลดส่งให้ service ({ filename }) */
export const storeSlip = async (kind, renderSlip) => {
  const name = nextSlipName(kind);
  await storeSlips([{ kind, name, render: renderSlip }]);
  return { filename: name };
};
