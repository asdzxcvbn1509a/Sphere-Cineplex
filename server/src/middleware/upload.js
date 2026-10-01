import fs from 'node:fs';
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

/** สลิปโอนเงินที่ลูกค้าอัปโหลด */
export const uploadPaymentSlip = createSlipUpload(PAYMENT_SLIP_DIR);
/** สลิปโอนคืนที่ผู้ดูแลอัปโหลด */
export const uploadRefundSlip = createSlipUpload(REFUND_SLIP_DIR);

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
