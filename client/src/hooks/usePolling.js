import { useEffect, useRef } from 'react';

/**
 * เรียกฟังก์ชันซ้ำตามรอบเวลา ใช้กับหน้า "รอ admin ตรวจสลิป"
 * หยุดอัตโนมัติเมื่อแท็บถูกซ่อน เพื่อไม่ยิง request ทิ้งไว้เปล่า ๆ
 */
export const usePolling = (callback, intervalMs, enabled = true) => {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;

    let timer = null;

    const tick = () => {
      if (document.visibilityState === 'visible') savedCallback.current?.();
    };

    const start = () => {
      if (timer === null) timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
};

export default usePolling;
