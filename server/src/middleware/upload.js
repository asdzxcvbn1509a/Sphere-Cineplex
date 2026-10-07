import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { customAlphabet } from 'nanoid';
import { env } from '../config/env.js';
import { saveSlip } from '../lib/slipStorage.js';
import ApiError from '../utils/ApiError.js';

const fileId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 24);

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * พักไฟล์ไว้ในหน่วยความจำก่อน (ไม่เกิน MAX_SLIP_SIZE_MB) ให้ตรวจไส้ในได้ก่อนส่งไปที่เก็บจริง
 * ไฟล์ที่ไม่ผ่านการตรวจจึงไม่ถูกเขียนลงที่ไหนเลย ไม่ว่าที่เก็บจะเป็นดิสก์หรือ Supabase
 *
 * จำกัดช่องข้อความด้วย — ค่าเริ่มต้นของ multer รับช่องข้อความได้ไม่จำกัดจำนวน ช่องละ 1MB และเก็บทั้งหมดไว้ใน memory
 * ก่อนที่ service จะได้ตรวจว่าเป็นเจ้าของการจองหรือไม่ ใครล็อกอินได้ก็ส่งช่องปลอมรัว ๆ จน API หน่วยความจำเต็มได้
 * ฟอร์มจริงมีแค่ไฟล์ `slip` กับ `note` ของผู้ดูแล (ช่องกรอกจำกัด 200 ตัว — ภาษาไทยไม่เกิน 600 ไบต์)
 */
const receiveSlip = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_SLIP_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 4 * 1024,
    parts: 6,
  },
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
 * ไม่ตรวจตรงนี้ ใครก็อัปโหลด HTML/สคริปต์โดยบอกว่าเป็น image/png แล้วไปค้างอยู่ในที่เก็บสลิปได้
 */
export const verifySlipContent = (req, _res, next) => {
  if (!req.file) return next();
  if (!SIGNATURES[req.file.mimetype]?.(req.file.buffer)) {
    return next(
      ApiError.badRequest('UNSUPPORTED_FILE_TYPE', 'ไฟล์นี้ไม่ใช่รูปภาพ JPG, PNG หรือ WEBP ที่ถูกต้อง'),
    );
  }
  next();
};

/**
 * เก็บไฟล์ที่ผ่านการตรวจแล้วลงที่เก็บจริง แล้วส่งชื่อไฟล์ต่อให้ service ทาง req.file.filename
 * ถ้าทำรายการไม่สำเร็จ service เป็นคนลบไฟล์นี้ทิ้งเอง (removeSlip)
 */
const storeSlip = (kind) => async (req, _res, next) => {
  if (!req.file) return next();
  try {
    // ไม่ใช้ชื่อไฟล์จากผู้ใช้เลย — กัน path traversal และชื่อซ้ำ
    const filename = `${Date.now()}-${fileId()}${ALLOWED[req.file.mimetype]}`;
    await saveSlip(kind, filename, req.file);
    req.file.filename = filename;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * กันสคริปต์อัปโหลดสลิปวนรัว ๆ — ทุกครั้งที่อัปโหลด ไฟล์ถูกอ่านเข้า memory และเขียนลงที่เก็บ (Supabase) ก่อน
 * service จะตรวจว่าเป็นเจ้าของการจองหรือไม่ แล้วค่อยลบทิ้งเมื่อไม่ผ่าน คนที่ไม่ได้เป็นเจ้าของก็ทำให้เปลืองได้
 * ลูกค้าจริงส่งสลิปไม่กี่ครั้งต่อการจอง จึงนับทุกคำขอต่อบัญชี (route ผ่าน authenticate มาแล้ว)
 * ใช้ตัวเดียวกันทั้งสลิปค่าตั๋วและสลิปส่วนต่างเปลี่ยนที่นั่ง โควตาจึงรวมกัน
 */
const slipUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: {
    error: {
      code: 'SLIP_RATE_LIMITED',
      message: 'ส่งสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    },
  },
});

/** สลิปโอนเงินที่ลูกค้าอัปโหลด (ค่าตั๋ว และส่วนต่างเปลี่ยนที่นั่ง) */
export const uploadPaymentSlip = [
  slipUploadLimiter,
  receiveSlip,
  verifySlipContent,
  storeSlip('payment'),
];
/** สลิปโอนคืนที่ผู้ดูแลอัปโหลด */
export const uploadRefundSlip = [receiveSlip, verifySlipContent, storeSlip('refund')];
