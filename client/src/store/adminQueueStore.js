import { create } from 'zustand';
import { getQueueCounts } from '../api/admin.js';

/**
 * ตัวเลขงานค้างที่โชว์เป็นป้ายบนเมนู admin (ตรวจสลิป / คืนเงิน)
 *
 * เก็บไว้ที่เดียวเหมือนกระดิ่งแจ้งเตือน เพราะป้ายอยู่บน sidebar แต่คนกดอนุมัติ
 * อยู่ในหน้าเนื้อหา ถ้าต่างคนต่างถือ state ตัวเลขจะค้างจนกว่าจะรีเฟรชหน้า
 */
export const useAdminQueueStore = create((set) => ({
  pendingSlips: 0,
  pendingRefunds: 0,
  /** ยอดรวมที่ยังต้องโอนคืน — บรรทัดสรุปของหน้าคืนเงินใช้ทั้งสองแท็บ */
  pendingRefundAmount: 0,

  /** ดึงตัวเลขจริงจากเซิร์ฟเวอร์ — เรียกหลังอนุมัติ/ปฏิเสธ/บันทึกคืนเงินทุกครั้ง */
  refresh: async () => {
    try {
      const { data } = await getQueueCounts();
      set({
        pendingSlips: data.pendingSlips,
        pendingRefunds: data.pendingRefunds,
        pendingRefundAmount: data.pendingRefundAmount,
      });
    } catch {
      // โหลดตัวเลขไม่ได้ไม่ควรรบกวนงานหลัก ปล่อยค่าเดิมไว้แล้วรอรอบถัดไป
    }
  },

  /** ใช้เมื่อหน้าที่เปิดอยู่มีตัวเลขอยู่แล้ว (เช่น /admin) จะได้ไม่ต้องยิงซ้ำ */
  setCounts: (counts) => set(counts),

  /** เรียกตอนออกจากระบบ ไม่ให้ตัวเลขของผู้ดูแลคนก่อนค้างอยู่ */
  reset: () => set({ pendingSlips: 0, pendingRefunds: 0, pendingRefundAmount: 0 }),
}));

export default useAdminQueueStore;
