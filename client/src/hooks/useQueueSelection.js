import { useRef, useState } from 'react';
import { STACKED_QUERY } from '../components/admin/queueLayout.js';

/**
 * ใบที่เลือกในคิวงานแบบสามแผง (ตรวจสลิป · คืนเงิน)
 *
 * - ใบที่เลือกหายจากคิว (ผู้ดูแลอีกคนทำไปแล้ว หรือเปลี่ยนหน้า/ลำดับ/แท็บ) ก็ตกไปใบแรกเอง แผงทำงานจะไม่ว่างทั้งที่ยังมีคิว
 * - จอที่แผงเรียงลงมา แผงที่ใช้ทำงานอยู่ใต้รายการ — เลือกใบแล้วพาไปที่แผงนั้นเลย (panelRef) ไม่ต้องเลื่อนหาเอง
 *
 * คืน { selected, select, moveOnFrom, panelRef }
 */
export const useQueueSelection = (items) => {
  const [selectedId, setSelectedId] = useState(null);
  const panelRef = useRef(null);

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const reveal = () => {
    if (window.matchMedia(STACKED_QUERY).matches) {
      panelRef.current?.scrollIntoView({ block: 'start' });
    }
  };

  const select = (item) => {
    setSelectedId(item.id);
    reveal();
  };

  /**
   * ทำใบนี้เสร็จแล้วไปใบถัดไปเอง (ใบสุดท้ายของหน้า = ใบก่อนหน้า) ผู้ดูแลทำต่อได้ทันที
   * เว้นแต่ระหว่างรอผลผู้ดูแลกดเลือกใบอื่นไปแล้ว — null คือยังไม่เคยกดเลือก แผงแสดงใบแรกอยู่ ซึ่งก็คือใบที่เพิ่งทำ
   */
  const moveOnFrom = (item) => {
    const index = items.findIndex((other) => other.id === item.id);
    const next = (items[index + 1] ?? items[index - 1])?.id ?? null;
    setSelectedId((current) => (current === null || current === item.id ? next : current));
    reveal();
  };

  return { selected, select, moveOnFrom, panelRef };
};

export default useQueueSelection;
