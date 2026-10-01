import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { customAlphabet } from 'nanoid';
import { env, PAYMENT_SLIP_DIR, REFUND_SLIP_DIR, SLIP_DIR } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const SLIP_DIRS = { payment: PAYMENT_SLIP_DIR, refund: REFUND_SLIP_DIR };
for (const dir of Object.values(SLIP_DIRS)) fs.mkdirSync(dir, { recursive: true });

const fileId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 24);

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const createSlipUpload = (dir) =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      // ไม่ใช้ชื่อไฟล์จากผู้ใช้เลย — กัน path traversal และชื่อซ้ำ
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${fileId()}${ALLOWED[file.mimetype]}`),
    }),
    limits: { fileSize: env.MAX_SLIP_SIZE_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED[file.mimetype]) {
        return cb(ApiError.badRequest('UNSUPPORTED_FILE_TYPE', 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP'));
      }
      cb(null, true);
    },
  }).single('slip');

/** ไบต์แรกของไฟล์รูปแต่ละชนิด (magic bytes) */
const SIGNATURES = {
  'image/jpeg': (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  'image/png': (head) =>
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (head) =>
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP',
};

/**
 * ตรวจไส้ในไฟล์ว่าเป็นรูปจริงตามชนิดที่บอกมา — mimetype ใน multipart เป็นค่าที่ฝั่งส่งตั้งเองได้
 * ไม่ตรวจตรงนี้ ใครก็อัปโหลด HTML/สคริปต์โดยบอกว่าเป็น image/png แล้วไปค้างอยู่ในโฟลเดอร์สลิปได้
 * ไฟล์ที่ไม่ผ่านถูกลบทันที ไม่ปล่อยค้างไว้รอใครมาเก็บ
 */
export const verifySlipContent = async (req, _res, next) => {
  if (!req.file) return next();
  try {
    const handle = await fsp.open(req.file.path, 'r');
    const head = Buffer.alloc(12);
    try {
      await handle.read(head, 0, head.length, 0);
    } finally {
      await handle.close();
    }
    if (!SIGNATURES[req.file.mimetype]?.(head)) {
      await fsp.unlink(req.file.path).catch(() => {});
      return next(
        ApiError.badRequest('UNSUPPORTED_FILE_TYPE', 'ไฟล์นี้ไม่ใช่รูปภาพ JPG, PNG หรือ WEBP ที่ถูกต้อง'),
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** สลิปโอนเงินที่ลูกค้าอัปโหลด */
export const uploadPaymentSlip = [createSlipUpload(PAYMENT_SLIP_DIR), verifySlipContent];
/** สลิปโอนคืนที่ผู้ดูแลอัปโหลด */
export const uploadRefundSlip = [createSlipUpload(REFUND_SLIP_DIR), verifySlipContent];

/**
 * แปลงชื่อไฟล์ใน DB เป็น path จริง พร้อมกันการหลุดออกนอกโฟลเดอร์ที่กำหนด
 * ฐานข้อมูลเก็บแค่ชื่อไฟล์ ไม่เก็บ path จึงต้องบอกด้วยว่าเป็นสลิปชนิดไหน
 */
export const resolveSlipPath = (storedName, kind = 'payment') => {
  const dir = SLIP_DIRS[kind] ?? PAYMENT_SLIP_DIR;
  const safeName = path.basename(String(storedName ?? ''));
  const full = path.join(dir, safeName);
  if (!full.startsWith(dir)) throw ApiError.badRequest('INVALID_PATH', 'ชื่อไฟล์ไม่ถูกต้อง');

  // ไฟล์ที่อัปโหลดไว้ก่อนแยกโฟลเดอร์ยังกองอยู่ที่ slips/ ชั้นนอก ต้องยังเปิดดูได้
  if (!fs.existsSync(full)) {
    const legacy = path.join(SLIP_DIR, safeName);
    if (fs.existsSync(legacy)) return legacy;
  }
  return full;
};
