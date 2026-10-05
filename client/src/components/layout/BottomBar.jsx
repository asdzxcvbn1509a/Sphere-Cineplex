import { useCallback } from 'react';
import clsx from 'clsx';

/**
 * แถบสรุปติดขอบล่างของหน้าเลือกที่นั่งและหน้าเปลี่ยนที่นั่ง
 * ความสูงเปลี่ยนตามจอและจำนวนบรรทัด (มือถือเรียงซ้อนกัน) จึงวัดความสูงจริงแล้วตั้งเป็น --bottom-bar
 * layout ใช้ค่านี้เว้นที่ท้ายหน้าให้เนื้อหาไม่ถูกบัง และ toast ใช้ลอยขึ้นเหนือแถบ ไม่ทับปุ่มยืนยัน
 */
const BottomBar = ({ className, children }) => {
  // ref callback คืนฟังก์ชัน cleanup ได้ (React 19) — แถบหายไปเมื่อไหร่ ค่าก็ถูกลบตาม
  // ต้องเป็นฟังก์ชันเดิมทุก render ไม่งั้นแตะที่นั่งทีไรค่าจะถูกลบแล้วตั้งใหม่ หน้ากระตุก
  const measure = useCallback((node) => {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--bottom-bar', `${node.offsetHeight}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--bottom-bar');
    };
  }, []);

  return (
    <div
      ref={measure}
      className={clsx(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur',
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4">
        {children}
      </div>
    </div>
  );
};

export default BottomBar;
