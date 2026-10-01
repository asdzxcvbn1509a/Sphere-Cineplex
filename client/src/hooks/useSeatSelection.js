import { useCallback, useEffect, useState } from 'react';

const storageKey = (showtimeId) => `cinebook.seats.${showtimeId}`;

const readStored = (showtimeId) => {
  if (!showtimeId) return [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(showtimeId)) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

/**
 * จำที่นั่งที่เลือกไว้ใน sessionStorage
 * จำเป็นเพราะ flow เป็นแบบ lazy registration — ผู้ใช้เลือกที่นั่งก่อน แล้วค่อยถูกพาไปล็อกอิน
 * เมื่อกลับมาที่หน้าเดิม ที่นั่งที่เลือกไว้ต้องยังอยู่ครบ
 *
 * ค่าเริ่มต้นอ่านจาก sessionStorage ตั้งแต่ตอน render แรก (ไม่ใช่ใน useEffect)
 * มิฉะนั้น effect ที่คอยบันทึกจะเขียนทับด้วยอาร์เรย์ว่างก่อนที่ค่าที่โหลดมาจะถูก set
 */
export const useSeatSelection = (showtimeId, maxSeats = 8) => {
  const [state, setState] = useState(() => ({ id: showtimeId, seats: readStored(showtimeId) }));

  // เปลี่ยนรอบฉายระหว่างที่ component ยังอยู่ → สลับไปใช้ตะกร้าของรอบใหม่ทันทีในเฟรมเดียวกัน
  if (state.id !== showtimeId) {
    setState({ id: showtimeId, seats: readStored(showtimeId) });
  }

  const selected = state.id === showtimeId ? state.seats : [];

  useEffect(() => {
    if (!showtimeId || state.id !== showtimeId) return;
    try {
      sessionStorage.setItem(storageKey(showtimeId), JSON.stringify(state.seats));
    } catch {
      // เขียนไม่ได้ก็ยังใช้งานต่อได้ แค่ไม่จำข้ามหน้า
    }
  }, [showtimeId, state]);

  const toggle = useCallback(
    (seatId) => {
      setState((current) => {
        if (current.seats.includes(seatId)) {
          return { ...current, seats: current.seats.filter((id) => id !== seatId) };
        }
        if (current.seats.length >= maxSeats) return current;
        return { ...current, seats: [...current.seats, seatId] };
      });
    },
    [maxSeats],
  );

  const clear = useCallback(() => {
    setState((current) => ({ ...current, seats: [] }));
    try {
      sessionStorage.removeItem(storageKey(showtimeId));
    } catch {
      // ไม่เป็นไร
    }
  }, [showtimeId]);

  /** ตัดที่นั่งที่คนอื่นจองตัดหน้าไปแล้วออกจากรายการที่เลือก */
  const keepOnly = useCallback((validIds) => {
    setState((current) => {
      const next = current.seats.filter((id) => validIds.includes(id));
      return next.length === current.seats.length ? current : { ...current, seats: next };
    });
  }, []);

  return { selected, toggle, clear, keepOnly };
};

export default useSeatSelection;
