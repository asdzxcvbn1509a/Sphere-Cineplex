import api from './client.js';

/** ข้อมูลหน้าชำระเงิน — มี qrPayload สำหรับ render PromptPay QR และเวลาที่เหลือของการกันที่นั่ง */
export const getPayment = async (bookingId) => {
  return await api.get(`/payments/${bookingId}`);
};

/** อัปโหลดสลิปโอนเงิน — หลังส่งแล้วการจองจะเข้าสถานะรอผู้ดูแลระบบตรวจสอบ และหยุดนับถอยหลัง */
export const uploadSlip = async (bookingId, file) => {
  const form = new FormData();
  form.append('slip', file);
  return await api.post(`/payments/${bookingId}/slip`, form);
};

/**
 * ดึงรูปสลิปเป็น Blob
 * สลิปไม่ได้เปิดเป็นไฟล์ static จึงต้องดึงผ่าน API ที่ตรวจสิทธิ์ (เจ้าของการจองหรือ ADMIN)
 * แล้วค่อยแปลงเป็น object URL ให้ <img> ใช้
 */
export const getSlipBlob = async (bookingId, paymentId) => {
  return await api.get(`/payments/${bookingId}/slip`, {
    responseType: 'blob',
    params: paymentId ? { payment: paymentId } : undefined,
  });
};

/**
 * สลิปที่ผู้ดูแลโอนเงินคืน — เจ้าของการจองเปิดดูเป็นหลักฐานได้เช่นกัน
 * paymentId = รายการส่วนต่างเปลี่ยนที่นั่ง (ไม่ส่ง = ใบหลักของการจอง)
 */
export const getRefundSlipBlob = async (bookingId, paymentId) => {
  return await api.get(`/payments/${bookingId}/refund-slip`, {
    responseType: 'blob',
    params: paymentId ? { payment: paymentId } : undefined,
  });
};
