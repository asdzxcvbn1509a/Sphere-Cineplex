import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  env,
  isSupabaseConfigured,
  PAYMENT_SLIP_DIR,
  REFUND_SLIP_DIR,
  SLIP_DIR,
} from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * ที่เก็บไฟล์สลิป — ตั้ง SUPABASE_URL แล้วเก็บบน Supabase Storage ไม่งั้นเก็บลงดิสก์ใต้ UPLOAD_DIR
 * ส่วนอื่นของระบบรู้จักสลิปแค่ "ชื่อไฟล์" (ค่าที่ DB เก็บ) กับชนิดสลิป จึงไม่ต้องรู้ว่าไฟล์อยู่ที่ไหนจริง
 *
 * kind = 'payment' สลิปที่ลูกค้าโอนเข้ามา · 'refund' สลิปที่ผู้ดูแลโอนคืน
 * แยกกองด้วยชื่อเดียวกันทั้งสองที่: โฟลเดอร์บนดิสก์ และ prefix ใน bucket
 */

/** ตัดให้เหลือแค่ชื่อไฟล์ — กันชื่อที่พา path ออกนอกกองของตัวเอง */
const baseName = (storedName) => path.basename(String(storedName ?? ''));

/** DB ยังอ้างถึงแต่ไฟล์ไม่อยู่แล้ว = ไฟล์หายจากที่เก็บ (เช่น ดิสก์ไม่ถาวรถูกล้างตอน deploy) จึงไม่ควรเงียบ */
const missingFile = (kind, name) => {
  console.warn(`[slip] ไม่พบไฟล์สลิป ${kind}/${name} ในที่เก็บ`);
  return ApiError.notFound('SLIP_FILE_MISSING', 'ไม่พบไฟล์สลิปในที่เก็บ');
};

// ---------- ดิสก์ ----------

const SLIP_DIRS = { payment: PAYMENT_SLIP_DIR, refund: REFUND_SLIP_DIR };

/**
 * แปลงชื่อไฟล์ใน DB เป็น path จริง พร้อมกันการหลุดออกนอกโฟลเดอร์ที่กำหนด
 * ฐานข้อมูลเก็บแค่ชื่อไฟล์ ไม่เก็บ path จึงต้องบอกด้วยว่าเป็นสลิปชนิดไหน
 */
const resolveSlipPath = (storedName, kind = 'payment') => {
  const dir = SLIP_DIRS[kind] ?? PAYMENT_SLIP_DIR;
  const safeName = baseName(storedName);
  const full = path.join(dir, safeName);
  if (!full.startsWith(dir)) throw ApiError.badRequest('INVALID_PATH', 'ชื่อไฟล์ไม่ถูกต้อง');

  // ไฟล์ที่อัปโหลดไว้ก่อนแยกโฟลเดอร์ยังกองอยู่ที่ slips/ ชั้นนอก ต้องยังเปิดดูได้
  if (!fs.existsSync(full)) {
    const legacy = path.join(SLIP_DIR, safeName);
    if (fs.existsSync(legacy)) return legacy;
  }
  return full;
};

const diskStorage = {
  async save(kind, name, file) {
    // wx = ไม่เขียนทับไฟล์เดิม — ชื่อสุ่มชนกันแทบเป็นไปไม่ได้ แต่ถ้าชนจริงต้องไม่ทับสลิปของคนอื่น
    await fsp.writeFile(path.join(SLIP_DIRS[kind], baseName(name)), file.buffer, { flag: 'wx' });
  },
  async remove(kind, name) {
    await fsp.unlink(resolveSlipPath(name, kind));
  },
  async send(res, kind, name) {
    const filePath = resolveSlipPath(name, kind);
    // เช็กก่อนส่ง — ปล่อยให้ sendFile ไปเจอเองจะตอบเป็น 500 ทั้งที่แค่หาไฟล์ไม่เจอ
    if (!fs.existsSync(filePath)) throw missingFile(kind, name);
    // สลิปเป็นเอกสารการเงินส่วนตัว ไม่ให้ cache ไหนเก็บไว้ แบบเดียวกับที่เก็บบน Supabase
    // (cacheControl: false — ไม่งั้น sendFile ตั้ง public, max-age=0 ให้เอง)
    res.set('Cache-Control', 'private, no-store').sendFile(filePath, { cacheControl: false });
  },
};

// ---------- Supabase Storage ----------

const FOLDERS = { payment: 'payments', refund: 'refunds' };

let bucket = null;

/** สร้าง client ครั้งแรกที่ใช้แล้วใช้ซ้ำ (แบบเดียวกับ transporter ของ mailer) */
const getBucket = () => {
  if (!bucket) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      // server ไม่มีผู้ใช้ล็อกอินค้างไว้ ไม่ต้องเก็บหรือต่ออายุ session
      auth: { persistSession: false, autoRefreshToken: false },
    });
    bucket = supabase.storage.from(env.SUPABASE_SLIP_BUCKET);
  }
  return bucket;
};

/** ชื่อ object ใน bucket — prefix ตามชนิดสลิป ให้ตรงกับโครงโฟลเดอร์บนดิสก์ */
const objectKey = (kind, name) => `${FOLDERS[kind]}/${baseName(name)}`;

const supabaseStorage = {
  async save(kind, name, file) {
    const { error } = await getBucket().upload(objectKey(kind, name), file.buffer, {
      contentType: file.mimetype,
      // ไม่เขียนทับ object เดิม เหตุผลเดียวกับ flag 'wx' ของดิสก์
      upsert: false,
    });
    if (error) throw error;
  },
  async remove(kind, name) {
    const { error } = await getBucket().remove([objectKey(kind, name)]);
    if (error) throw error;
  },
  async send(res, kind, name) {
    const { data, error } = await getBucket().download(objectKey(kind, name));
    if (error) {
      if (error.status === 404 || error.statusCode === '404') throw missingFile(kind, name);
      throw error;
    }
    res
      .type(path.extname(name))
      // สลิปเป็นเอกสารการเงินส่วนตัว — ไม่ให้ cache ไหนระหว่างทางเก็บไว้
      .set('Cache-Control', 'private, no-store')
      .send(Buffer.from(await data.arrayBuffer()));
  },
};

const driver = isSupabaseConfigured ? supabaseStorage : diskStorage;

if (!isSupabaseConfigured) {
  for (const dir of Object.values(SLIP_DIRS)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * เก็บสลิปที่ผ่านการตรวจแล้ว
 * name = ชื่อที่จะบันทึกลง DB (สุ่มมาจาก middleware/upload.js) · file = ไฟล์จาก multer (buffer + mimetype)
 */
export const saveSlip = (kind, name, file) => driver.save(kind, name, file);

/**
 * ลบสลิปแบบ best-effort — ใช้เก็บกวาดหลังทำรายการไม่สำเร็จ หรือเมื่อมีสลิปใบใหม่มาแทนใบเก่า
 * ไม่โยน error ต่อ เพราะรายการหลักจบไปแล้ว (สำเร็จหรือล้มก็ตาม) ลบไฟล์ไม่ได้ไม่ควรเปลี่ยนผลนั้น — ไปโผล่ใน log แทน
 */
export const removeSlip = async (kind, name) => {
  if (!name) return;
  try {
    await driver.remove(kind, name);
  } catch (error) {
    // ไฟล์ไม่อยู่แล้วก็ได้ผลเดียวกับลบสำเร็จ
    if (error?.code === 'ENOENT') return;
    console.error(`[slip] ลบสลิป ${kind}/${name} ไม่สำเร็จ:`, error.message);
  }
};

/** ส่งรูปสลิปกลับเป็น response — เรียกหลังตรวจสิทธิ์ผู้ขอแล้วเท่านั้น */
export const sendSlip = (res, kind, name) => driver.send(res, kind, name);
