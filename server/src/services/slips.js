import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { removeSlip } from '../lib/slipStorage.js';

/**
 * เงินที่กันที่นั่งรอโอน — ค่าตั๋ว (การจอง) กับส่วนต่างเปลี่ยนที่นั่ง (คำขอ) ใช้ขั้นตอนเดียวกันทั้งหมด
 * นับถอยหลัง → ส่งสลิป → ผู้ดูแลตรวจ · หมดเวลาแล้วจบ ไม่มีการรับโอนหลังหมดเวลา
 * ทั้งสองอย่างมีฟิลด์ชุดเดียวกัน (status, holdExpiresAt, payment) ฟังก์ชันในไฟล์นี้จึงรับได้ทั้งคู่ (holder)
 */

/** เวลาที่เหลือของ hold (วินาที) — null แปลว่าไม่ได้กำลังนับถอยหลัง (ใช้ทั้งการจองและคำขอเปลี่ยนที่นั่ง) */
export const holdSecondsLeft = (holder) => {
  if (!holder.holdExpiresAt) return null;
  return Math.max(0, Math.floor((holder.holdExpiresAt.getTime() - Date.now()) / 1000));
};

/**
 * รายการนี้ส่งสลิปได้ไหม — ได้เฉพาะตอนรอชำระเงิน
 *
 * เลยกำหนดแล้วแต่ job (ทุก 30 วินาที) ยังไม่ได้ปล่อยที่นั่งก็ยังรับ เพราะที่นั่งยังเป็นของเขา
 * คนที่กดส่งก่อนหมดเวลาแต่อัปโหลดเสร็จช้าไปไม่กี่วินาทีจะได้ไม่ตกไป (หน้าเว็บซ่อนฟอร์มตอนนับถึง 0 อยู่แล้ว)
 * หมดเวลาแล้ว (EXPIRED) ไม่รับอีก — โอนแล้วแต่ส่งไม่ทันต้องติดต่อเจ้าหน้าที่ (ดู slipRefusal)
 */
export const canUploadSlip = (holder) => holder.status === 'PENDING_PAYMENT';

/**
 * ทำรายการกับไฟล์สลิปที่ middleware เก็บลงที่เก็บไว้แล้ว — task ล้มเมื่อไหร่ ลบไฟล์นั้นทิ้งแล้วโยน error ต่อ
 * ไม่งั้นไฟล์ของรายการที่ไม่สำเร็จจะค้างอยู่ในที่เก็บโดยไม่มีแถวไหนอ้างถึง (ไม่ได้แนบไฟล์มา = ไม่มีอะไรให้ลบ)
 */
export const discardSlipOnError = async (kind, file, task) => {
  try {
    return await task();
  } catch (error) {
    if (file) await removeSlip(kind, file.filename);
    throw error;
  }
};

/** ข้อมูลที่บันทึกลงใบชำระเงินตอนรับสลิป — ล้างผลตรวจของรอบก่อนด้วย (กรณีส่งใหม่หลังถูกปฏิเสธ) */
const slipFields = (file) => {
  return {
    slipPath: file.filename,
    slipUploadedAt: new Date(),
    status: 'PENDING_VERIFICATION',
    rejectReason: null,
    verifiedById: null,
    verifiedAt: null,
  };
};

/** เหตุที่ส่งสลิปไม่ได้ ตามสถานะของรายการตอนนี้ */
const slipRefusal = (holder, { notPayable, alreadySentCode, bookingCode }) => {
  if (holder.payment?.status === 'PENDING_VERIFICATION') {
    return ApiError.conflict(alreadySentCode, 'ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ');
  }
  if (holder.status === 'EXPIRED') {
    return ApiError.conflict(
      'HOLD_EXPIRED',
      `หมดเวลาส่งสลิปแล้ว หากโอนเงินไปแล้วกรุณาติดต่อเจ้าหน้าที่ พร้อมรหัสการจอง ${bookingCode}`,
    );
  }
  return notPayable();
};

/**
 * รับสลิปเข้าคิวให้ผู้ดูแลตรวจ — model = 'booking' (ค่าตั๋ว) หรือ 'seatChange' (ส่วนต่างเปลี่ยนที่นั่ง)
 * จุดสำคัญ: ตั้ง holdExpiresAt = null เพื่อ "หยุดนับถอยหลัง" ระหว่างรอผู้ดูแลตรวจ
 * ที่นั่งจะถูกยึดไว้จนกว่าจะอนุมัติหรือปฏิเสธ ลูกค้าจึงไม่เสียสิทธิ์เพราะความล่าช้าของผู้ดูแล
 *
 * holder ต้อง include payment มาแล้ว · canUpload = canUploadSlip หรือ canUploadTopUpSlip · reload = อ่าน holder ใหม่
 * ส่งไม่ได้: สลิปเดิมรอตรวจอยู่ = 409 alreadySentCode · หมดเวลาแล้ว = 409 HOLD_EXPIRED · อื่น ๆ = notPayable()
 */
export const queueSlipForReview = async ({
  model,
  holder,
  file,
  reload,
  canUpload,
  notPayable,
  alreadySentCode,
  bookingCode,
}) => {
  const refusal = (current) => slipRefusal(current, { notPayable, alreadySentCode, bookingCode });
  if (!canUpload(holder)) throw refusal(holder);

  const moved = await prisma.$transaction(async (tx) => {
    // เงื่อนไขสถานะอยู่ใน update — ถ้า job หมดเวลาหรือการยกเลิกชิงเปลี่ยนสถานะไปก่อนในจังหวะเดียวกัน
    // จะไม่โดนแถวไหน แทนที่จะเขียนทับสถานะที่เพิ่งเปลี่ยน
    // (ไม่เช็กว่าเลยกำหนดหรือยัง — ถ้า job ยังไม่ปล่อยที่นั่ง ที่นั่งก็ยังเป็นของคนนี้ รับสลิปได้เลย)
    const { count } = await tx[model].updateMany({
      where: { id: holder.id, status: 'PENDING_PAYMENT' },
      data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null },
    });
    if (count === 0) return false;
    await tx.payment.update({ where: { id: holder.payment.id }, data: slipFields(file) });
    return true;
  });

  // มีอย่างอื่นเปลี่ยนสถานะไปก่อนเสี้ยววินาที (job ปิดเพราะหมดเวลา, ยกเลิก, ส่งซ้ำจากอีกแท็บ)
  // อ่านใหม่แล้วตอบตามสถานะจริง — job ชนะก็คือหมดเวลาแล้ว ได้ HOLD_EXPIRED เหมือนส่งหลังหมดเวลา
  if (!moved) throw refusal(await reload());
};

// ---------- ผลตรวจสลิป (ค่าตั๋วและส่วนต่างเปลี่ยนที่นั่งบันทึกแบบเดียวกัน) ----------

export const approvedPaymentData = (adminId, at) => {
  return { status: 'APPROVED', verifiedById: adminId, verifiedAt: at, rejectReason: null };
};

export const rejectedPaymentData = (adminId, at, reason) => {
  return { status: 'REJECTED', rejectReason: reason, verifiedById: adminId, verifiedAt: at };
};
