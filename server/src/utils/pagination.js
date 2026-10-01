import { z } from 'zod';

/**
 * แบ่งหน้ารายการฝั่งผู้ดูแล (การจอง สลิป คืนเงิน ผู้ใช้)
 * เดิมทุกรายการตัดที่ 100 แถวล่าสุดตายตัว ข้อมูลที่เก่ากว่านั้นเปิดดูจากหน้าเว็บไม่ได้เลย
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** ใช้ต่อท้าย query schema ของ route: listQuery.extend(paginationQuery) */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

/** แปลง page/pageSize เป็น skip/take ของ Prisma (เรียกจาก service ได้โดยไม่ผ่าน route ด้วย) */
export const toPage = ({ page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) => {
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};
