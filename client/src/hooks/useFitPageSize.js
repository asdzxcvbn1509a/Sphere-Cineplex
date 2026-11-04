import { useEffect, useLayoutEffect, useState } from 'react';
import { FIT_QUERY } from '../components/admin/fitLayout.js';

/** จอเล็กกว่า xl เลื่อนหน้าได้ตามปกติ — หน้าละเท่าค่าเริ่มต้นของ server (DEFAULT_PAGE_SIZE ใน utils/pagination.js) */
export const SCROLL_PAGE_SIZE = 50;

/** server รับ pageSize ไม่เกินนี้ (MAX_PAGE_SIZE) — จอสูงมาก ๆ จะได้ไม่ขอเกินแล้วโดน 422 */
const MAX_PAGE_SIZE = 100;

/** รอให้หยุดลากขนาดหน้าต่างก่อนค่อยนับใหม่ — รายการจาก server จะได้ไม่ยิง API ทุกเฟรม */
const RESIZE_DELAY = 150;

const isFitScreen = () => window.matchMedia(FIT_QUERY).matches;

/**
 * จำนวนรายการต่อหน้าที่วางพอดีกล่องรายการของหน้าพอดีจอ (components/admin/fitLayout.js) — ทั้งหน้าไม่ต้องเลื่อน กดเลขหน้าแทน
 *
 * itemHeight = ระยะต่อแถว (px) ต้องตรงกับ class ความสูงของแถว (xl:h-*) — เส้นคั่นแถวของตาราง (border-collapse) อยู่ในความสูงนั้นแล้ว
 *   ทุกแถวสูงเท่ากันเพราะข้อความยาวถูกตัดด้วย … จึงนับจากค่าคงที่ได้เลย ไม่ต้องรอให้มีแถวมาวัด
 * ref ใส่ที่กล่องที่ยืดเต็มส่วนที่เหลือของหน้า (FIT_BODY) — หักความสูงหัวตารางให้เอง
 *   เป็น callback ref — กล่องถูกถอดแล้วใส่ใหม่ (เช่นหลังขึ้น ErrorBlock) ก็วัดกล่องใหม่ได้
 *
 * คืน { ref, pageSize, ready, active }
 *   active = จอ xl ที่หน้าพอดีจออยู่ · จอเล็กกว่านั้น pageSize = SCROLL_PAGE_SIZE และ ready ทันที
 *   ready = วัดเสร็จแล้ว — รายการที่ขอทีละหน้าจาก server ต้องรอค่านี้ ไม่งั้นได้ยิงสองรอบตอนเปิดหน้า (รอบแรกขนาดผิด)
 */
export const useFitPageSize = (itemHeight) => {
  const [box, setBox] = useState(null);
  const [active, setActive] = useState(isFitScreen);
  const [fitted, setFitted] = useState(null);

  // ย่อ/ขยายหน้าต่างข้ามขนาด xl — สลับระหว่างพอดีจอกับเลื่อนหน้าตามปกติ
  // ล้างค่าเดิมทิ้งตอนออกจากโหมดพอดีจอ กลับมาอีกครั้งจะได้รอวัดใหม่ ไม่ยิง API ด้วยขนาดของจอก่อนหน้า
  useEffect(() => {
    const media = window.matchMedia(FIT_QUERY);
    const onChange = () => {
      setActive(media.matches);
      if (!media.matches) setFitted(null);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // วัดทันทีที่ได้กล่อง ก่อนเบราว์เซอร์วาดจอ — ไม่เห็นรายการจำนวนผิดแวบขึ้นมา
  useLayoutEffect(() => {
    if (!active || !box) return undefined;

    const measure = () => {
      const head = box.querySelector('thead')?.offsetHeight ?? 0;
      const rows = Math.floor((box.clientHeight - head) / itemHeight);
      setFitted(Math.min(MAX_PAGE_SIZE, Math.max(1, rows)));
    };

    measure();
    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, RESIZE_DELAY);
    });
    observer.observe(box);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [active, box, itemHeight]);

  if (!active) return { ref: setBox, pageSize: SCROLL_PAGE_SIZE, ready: true, active };
  return { ref: setBox, pageSize: fitted ?? SCROLL_PAGE_SIZE, ready: fitted !== null, active };
};

export default useFitPageSize;
