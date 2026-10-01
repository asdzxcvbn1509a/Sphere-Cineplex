import { useEffect, useRef, useState } from 'react';

/**
 * นับถอยหลังไปยังเวลาที่กำหนด
 * ส่ง null เข้ามาได้ (เช่น ระหว่างรอ admin ตรวจสลิป ที่ hold ถูกหยุดไว้) — จะคืน null
 */
export const useCountdown = (targetIso, onExpire) => {
  const [secondsLeft, setSecondsLeft] = useState(() => computeLeft(targetIso));
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    expiredRef.current = false;
    setSecondsLeft(computeLeft(targetIso));
    if (!targetIso) return undefined;

    const timer = setInterval(() => {
      const left = computeLeft(targetIso);
      setSecondsLeft(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [targetIso]);

  return secondsLeft;
};

const computeLeft = (targetIso) => {
  if (!targetIso) return null;
  const diffMs = new Date(targetIso).getTime() - Date.now();
  return Math.max(0, Math.floor(diffMs / 1000));
};

export default useCountdown;
