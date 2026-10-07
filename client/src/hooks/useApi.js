import { useCallback, useEffect, useRef, useState } from 'react';
import { apiError } from '../api/client.js';

/**
 * โหลดข้อมูลจาก API พร้อมสถานะ loading / error — แทน useState({ loading, error }) + then/catch ที่ทุกหน้าเคยเขียนเอง
 *
 * fetcher({ silent }) คืน "ข้อมูล" ที่หน้าใช้ (แปลง axios response เอง) · deps เปลี่ยนเมื่อไหร่โหลดใหม่
 * reload({ silent: true }) โหลดซ้ำโดยไม่โชว์ loading (polling, หลังกดปุ่ม) แต่ถ้าพังก็ยังขึ้น error เหมือนรอบปกติ
 * คำตอบของคำขอเก่าที่มาถึงหลังคำขอใหม่ถูกทิ้ง — สลับแท็บหรือวันเร็ว ๆ แล้วข้อมูลเก่าจะไม่มาทับข้อมูลใหม่
 */
export const useApi = (fetcher, deps) => {
  const [data, setData] = useState(undefined);
  const [status, setStatus] = useState({ loading: true, error: null });
  const latestRequest = useRef(0);
  const savedFetcher = useRef(fetcher);
  savedFetcher.current = fetcher;

  const reload = useCallback(async ({ silent = false } = {}) => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    if (!silent) setStatus({ loading: true, error: null });
    try {
      const next = await savedFetcher.current({ silent });
      if (request !== latestRequest.current) return undefined;
      setData(next);
      setStatus({ loading: false, error: null });
      return next;
    } catch (error) {
      if (request === latestRequest.current) {
        setStatus({ loading: false, error: apiError(error).message });
      }
      return undefined;
    }
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, loading: status.loading, error: status.error, reload };
};

/**
 * รายการแบบแบ่งหน้าของหน้าผู้ดูแล — fetchPage({ silent }) คืน { items, total, pageSize }
 *
 * ถ้าหน้าที่ขอเกินหน้าสุดท้าย (จัดการใบสุดท้ายของหน้าเสร็จ, ?page= เก่าใน URL) ไปหน้าสุดท้ายที่มีข้อมูลเองแทนโชว์รายการว่าง
 * คิดจาก total ในคำตอบ ไม่ลบหนึ่งจากหน้าปัจจุบัน — ?page=500 ไปถึงในรอบเดียว
 * และคำตอบซ้ำ (StrictMode โหลดสองรอบ) ไม่ถอยเลยไปถึงหน้า 0 ซึ่ง server ตอบ 422
 * ระหว่างรอไปหน้าใหม่ยังนับเป็น loading — รายการว่างกับปุ่มเปลี่ยนหน้าจะไม่กระพริบขึ้นมา
 */
export const usePagedApi = (fetchPage, { page, setPage }, deps) => {
  const result = useApi(fetchPage, deps);
  const { data } = result;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const outOfRange = Boolean(data) && data.items.length === 0 && page > lastPage;

  useEffect(() => {
    if (outOfRange) setPage(lastPage);
  }, [outOfRange, lastPage, setPage]);

  return { ...result, loading: result.loading || outOfRange };
};

export default useApi;
