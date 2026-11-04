/**
 * หนึ่งหน้าของรายการที่โหลดมาครบแล้วฝั่งหน้าเว็บ (ภาพยนตร์ · รอบฉาย · โรงภาพยนตร์)
 * หน้าที่เกินหน้าสุดท้าย (ลบรายการสุดท้ายของหน้า · ค้นจนเหลือน้อย · จอสูงขึ้นจนหน้าละหลายรายการขึ้น) ปัดเป็นหน้าสุดท้ายเอง
 * คืน { page, items } — page คือหน้าที่แสดงจริง ส่งต่อให้ Pagination
 */
export const slicePage = (items, page, pageSize) => {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { page: current, items: items.slice((current - 1) * pageSize, current * pageSize) };
};
