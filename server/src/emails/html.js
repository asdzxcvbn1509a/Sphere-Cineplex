/**
 * ตัวช่วยร่วมของเนื้อหาอีเมลแบบ HTML
 * ค่าที่มาจากผู้ใช้ (ชื่อ ชื่อเรื่อง) และลิงก์ต้องผ่าน escapeHtml ก่อนต่อเข้า HTML ทุกครั้ง
 */
export const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};
