import api from './client.js';

// สร้างคำขอเปลี่ยนที่นั่งอยู่ที่ requestSeatChange ใน bookings.js — ไฟล์นี้คือขั้นถัดไปของคำขอที่ต้องโอนส่วนต่าง

/**
 * คำขอเปลี่ยนที่นั่ง + ข้อมูลชำระส่วนต่าง (qrPayload, holdSecondsLeft, canUploadSlip, lateSlipUntil)
 * status: PENDING_PAYMENT | PENDING_VERIFICATION | COMPLETED | CANCELLED | EXPIRED
 */
export const getSeatChange = async (seatChangeId) => {
  return await api.get(`/seat-changes/${seatChangeId}`);
};

/** อัปโหลดสลิปส่วนต่าง — หลังส่งแล้วหยุดนับถอยหลังระหว่างรอผู้ดูแลตรวจ (รวมสลิปส่งช้าในช่วงผ่อนผัน) */
export const uploadSeatChangeSlip = async (seatChangeId, file) => {
  const form = new FormData();
  form.append('slip', file);
  return await api.post(`/seat-changes/${seatChangeId}/slip`, form);
};

/**
 * ยกเลิกคำขอที่ยังไม่ได้ส่งสลิป — ที่นั่งใหม่ที่กันไว้ถูกปล่อย ที่นั่งเดิมไม่ได้แตะ
 * ส่งสลิปแล้วได้ 409 SEAT_CHANGE_AWAITING_VERIFICATION
 */
export const cancelSeatChange = async (seatChangeId) => {
  return await api.post(`/seat-changes/${seatChangeId}/cancel`);
};
