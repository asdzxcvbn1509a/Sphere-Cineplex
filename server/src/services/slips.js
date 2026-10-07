import prisma from '../lib/prisma.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { addMinutes } from '../utils/datetime.js';
import { removeSlip } from '../lib/slipStorage.js';

/**
 * เงินที่กันที่นั่งรอโอน — ค่าตั๋ว (การจอง) กับส่วนต่างเปลี่ยนที่นั่ง (คำขอ) ใช้ขั้นตอนเดียวกันทั้งหมด
 * นับถอยหลัง → ส่งสลิป (หรือส่งช้าในช่วงผ่อนผัน) → ผู้ดูแลตรวจ
 * ทั้งสองอย่างมีฟิลด์ชุดเดียวกัน (status, holdExpiresAt, expiredAt, payment) ฟังก์ชันในไฟล์นี้จึงรับได้ทั้งคู่ (holder)
 */

/** เวลาที่เหลือของ hold (วินาที) — null แปลว่าไม่ได้กำลังนับถอยหลัง (ใช้ทั้งการจองและคำขอเปลี่ยนที่นั่ง) */
export const holdSecondsLeft = (holder) => {
  if (!holder.holdExpiresAt) return null;
  return Math.max(0, Math.floor((holder.holdExpiresAt.getTime() - Date.now()) / 1000));
};

/** ใบชำระเงินที่ยังรับสลิปได้ — ยังไม่เคยส่ง หรือใบเดิมถูกปฏิเสธ/หมดเวลาไป */
export const SLIP_ACCEPTING_PAYMENT_STATUSES = ['AWAITING_SLIP', 'REJECTED'];

/**
 * รายการนี้ส่งสลิปได้ไหม และถ้าเลยเวลาชำระไปแล้ว ส่งช้าได้ถึงเมื่อไหร่ (holder ต้อง include payment มาแล้ว)
 *
 * - รอชำระอยู่ → ส่งได้เสมอ แม้เลยกำหนดแล้วแต่ job ยังไม่ได้ปล่อยที่นั่ง (ที่นั่งยังเป็นของเขาอยู่)
 * - หมดเวลาไปแล้ว → ส่งได้อีก LATE_SLIP_GRACE_MINUTES นับจากตอนหมดเวลา สำหรับคนที่โอนแล้วแต่ส่งหลักฐานไม่ทัน
 *   (ที่นั่งยังว่างก็ได้คืน ไม่ว่างแล้วผู้ดูแลยืนยันยอดแล้วคืนเงิน) — ต้องยังไม่มีสลิปที่รอตรวจหรือจบไปแล้ว
 */
export const slipUploadWindow = (holder, now = new Date()) => {
  const grace = env.LATE_SLIP_GRACE_MINUTES;

  if (holder.status === 'PENDING_PAYMENT') {
    const overdue = holder.holdExpiresAt && holder.holdExpiresAt <= now;
    return {
      canUpload: true,
      lateUntil: overdue && grace > 0 ? addMinutes(holder.holdExpiresAt, grace) : null,
    };
  }

  if (
    holder.status === 'EXPIRED' &&
    holder.expiredAt &&
    grace > 0 &&
    SLIP_ACCEPTING_PAYMENT_STATUSES.includes(holder.payment?.status)
  ) {
    const lateUntil = addMinutes(holder.expiredAt, grace);
    if (lateUntil > now) return { canUpload: true, lateUntil };
  }

  return { canUpload: false, lateUntil: null };
};

/**
 * ที่นั่งของรายการที่หมดเวลาไปแล้วเอาคืนไม่ได้ (ถูกจองต่อ, ปิดใช้งาน, รอบเริ่ม/ถูกยกเลิก, การจองเปลี่ยนไปแล้ว)
 * โยนจากใน transaction ของการส่งสลิปช้า เพื่อย้อนกลับแล้วไปทางเข้าคิวตรวจแบบคืนเงินแทน
 */
export class SeatsUnavailableError extends Error {}

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

/**
 * รับสลิปเข้าคิวให้ผู้ดูแลตรวจ — model = 'booking' (ค่าตั๋ว) หรือ 'seatChange' (ส่วนต่างเปลี่ยนที่นั่ง)
 * จุดสำคัญ: ตั้ง holdExpiresAt = null เพื่อ "หยุดนับถอยหลัง" ระหว่างรอผู้ดูแลตรวจ
 * ที่นั่งจะถูกยึดไว้จนกว่าจะอนุมัติหรือปฏิเสธ ลูกค้าจึงไม่เสียสิทธิ์เพราะความล่าช้าของผู้ดูแล
 *
 * holder ต้อง include payment มาแล้ว · window = slipUploadWindow หรือ topUpSlipWindow
 * reload = อ่าน holder ใหม่ · acceptLate(holder, slipData) = ทางของสลิปที่ส่งหลังหมดเวลา
 * ส่งไม่ได้แล้ว: สลิปเดิมรอตรวจอยู่ = 409 alreadySentCode · เลยช่วงผ่อนผัน = 409 HOLD_EXPIRED · อื่น ๆ = notPayable()
 */
export const queueSlipForReview = async ({
  model,
  holder,
  file,
  reload,
  acceptLate,
  window,
  notPayable,
  alreadySentCode,
  bookingCode,
}) => {
  if (!window(holder).canUpload) {
    if (holder.payment.status === 'PENDING_VERIFICATION') {
      throw ApiError.conflict(alreadySentCode, 'ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ');
    }
    if (holder.status === 'EXPIRED') {
      throw ApiError.conflict(
        'HOLD_EXPIRED',
        `หมดเวลาส่งสลิปแล้ว หากโอนเงินไปแล้วกรุณาติดต่อเจ้าหน้าที่ พร้อมรหัสการจอง ${bookingCode}`,
      );
    }
    throw notPayable();
  }

  const slipData = slipFields(file);
  let current = holder;
  if (current.status === 'PENDING_PAYMENT') {
    const moved = await prisma.$transaction(async (tx) => {
      // เงื่อนไขสถานะอยู่ใน update — ถ้า job หมดเวลาหรือการยกเลิกชิงเปลี่ยนสถานะไปก่อนในจังหวะเดียวกัน
      // จะไม่โดนแถวไหน แทนที่จะเขียนทับสถานะที่เพิ่งเปลี่ยน
      // (ไม่เช็กว่าเลยกำหนดหรือยัง — ถ้า job ยังไม่ปล่อยที่นั่ง ที่นั่งก็ยังเป็นของคนนี้ รับสลิปได้เลย)
      const { count } = await tx[model].updateMany({
        where: { id: holder.id, status: 'PENDING_PAYMENT' },
        data: { status: 'PENDING_VERIFICATION', holdExpiresAt: null },
      });
      if (count === 0) return false;
      await tx.payment.update({ where: { id: holder.payment.id }, data: slipData });
      return true;
    });
    if (!moved) {
      // job เพิ่งปิดรายการนี้ไปในจังหวะเดียวกันพอดี — อ่านใหม่แล้วไปทางสลิปส่งช้า
      // ลูกค้าไม่ควรเห็น error เพียงเพราะกดส่งตรงเสี้ยววินาทีที่ job ทำงาน
      current = await reload();
      if (current.status !== 'EXPIRED' || !window(current).canUpload) throw notPayable();
    }
  }
  if (current.status === 'EXPIRED') await acceptLate(current, slipData);
};

// ---------- ผลตรวจสลิป (ค่าตั๋วและส่วนต่างเปลี่ยนที่นั่งบันทึกแบบเดียวกัน) ----------

export const approvedPaymentData = (adminId, at) => {
  return { status: 'APPROVED', verifiedById: adminId, verifiedAt: at, rejectReason: null };
};

export const rejectedPaymentData = (adminId, at, reason) => {
  return { status: 'REJECTED', rejectReason: reason, verifiedById: adminId, verifiedAt: at };
};

/** สลิปที่ส่งหลังหมดเวลาแล้วที่นั่งไม่ว่าง — ยืนยันยอดแล้วเข้าคิวคืนเงินเต็มจำนวนที่โอนมา */
export const lateRefundPaymentData = (adminId, at, amount) => {
  return {
    status: 'REFUND_PENDING',
    verifiedById: adminId,
    verifiedAt: at,
    rejectReason: null,
    refundDueAt: at,
    refundAmount: amount,
  };
};
