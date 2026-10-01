import { create } from 'zustand';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications.js';

/**
 * ตัวเลขแจ้งเตือนที่ยังไม่อ่าน ใช้ร่วมกันระหว่างกระดิ่งบน Header กับหน้า /notifications
 *
 * เดิมสองที่นี้ต่างคนต่างเก็บ state ของตัวเอง พออ่านแจ้งเตือนในหน้า /notifications
 * กระดิ่งบน Header จึงไม่รู้เรื่อง ตัวเลขค้างจนกว่าจะ poll รอบถัดไปหรือรีเฟรชหน้า
 * ย้ายมาไว้ที่เดียวแล้วทั้งสองฝั่งเห็นค่าเดียวกันทันที
 */
export const useNotificationStore = create((set, get) => ({
  items: [],
  unreadCount: 0,

  /** ใช้กับกระดิ่งบน Header — ขอแค่ตัวเลข ไม่ต้องดึงรายการทั้งหมด */
  fetchUnreadCount: async () => {
    try {
      const { data } = await getUnreadCount();
      set({ unreadCount: data.unreadCount });
    } catch {
      // โหลดไม่ได้ก็ไม่ควรรบกวนการใช้งานหน้าอื่น ปล่อยค่าเดิมไว้
    }
  },

  /** ใช้กับหน้า /notifications — ดึงรายการพร้อมตัวเลข */
  fetchNotifications: async () => {
    const { data } = await listNotifications();
    set({ items: data.notifications, unreadCount: data.unreadCount });
    return data;
  },

  /** ตัดตัวเลขลงทันทีไม่รอ API ตอบ กระดิ่งจะได้เปลี่ยนพร้อมกับที่ผู้ใช้กด */
  markRead: async (id) => {
    const target = get().items.find((item) => item.id === id);
    if (target && target.readAt) return;

    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));

    try {
      await markNotificationRead(id);
    } catch {
      // ถ้ายิงไม่ผ่าน ดึงค่าจริงจากเซิร์ฟเวอร์มาทับ กันตัวเลขเพี้ยนค้าง
      get().fetchUnreadCount();
    }
  },

  markAllRead: async () => {
    const now = new Date().toISOString();
    set((state) => ({
      items: state.items.map((item) => (item.readAt ? item : { ...item, readAt: now })),
      unreadCount: 0,
    }));

    try {
      await markAllNotificationsRead();
    } catch {
      get().fetchUnreadCount();
    }
  },

  /** เรียกตอนออกจากระบบ ไม่ให้ตัวเลขของคนก่อนหน้าค้างอยู่ */
  reset: () => set({ items: [], unreadCount: 0 }),
}));

export const useUnreadCount = () => useNotificationStore((state) => state.unreadCount);

export default useNotificationStore;
