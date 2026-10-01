import axios from 'axios';

/**
 * ต่ออายุเซสชันด้วย refresh cookie — ทั้งแอปต้องเรียกผ่านฟังก์ชันนี้ที่เดียว
 *
 * refresh token เป็นแบบ rotate: ใช้แล้วใบเดิมถูกเพิกถอนทันที ถ้ามีสองคำขอส่งใบเดียวกันไปพร้อมกัน
 * (เปิดหลายแท็บพร้อมกัน, เบราว์เซอร์กู้แท็บเดิมคืนหลังเปิดใหม่) server จะเห็นใบที่เพิ่งถูกเพิกถอนถูกใช้ซ้ำ
 * เดิมตีความว่า token ถูกขโมยแล้วเตะออกจากระบบทุกอุปกรณ์ จึงกันไว้สามชั้น
 *   1. single-flight — ในแท็บเดียวกัน (bootstrap ชนกับ interceptor) ยิงจริงครั้งเดียวแล้วแชร์ผล
 *   2. navigator.locks — ข้ามแท็บ ให้ต่อคิวกัน แท็บถัดไปจะส่ง cookie ใบใหม่ที่แท็บก่อนหน้าเพิ่งได้มา
 *   3. REFRESH_RACE — เบราว์เซอร์เก่าที่ไม่มี locks ถ้ายังชนกัน server ตอบ 409 แทนการเตะออก แล้วเราลองใหม่
 *
 * ใช้ axios ตรง ๆ ไม่ผ่าน instance `api` — ไม่ให้ interceptor เรียกตัวเองซ้ำ และไม่ต้อง import store
 * (authStore กับ api/client.js import ไฟล์นี้ได้ทั้งคู่โดยไม่เกิดวง import)
 */
const RETRY_DELAY_MS = 400;
const MAX_RETRIES = 3;
// คำขอที่ค้าง (เน็ตหลุด) ต้องไม่ถือ lock ไว้จนแท็บอื่นต่ออายุไม่ได้ไปด้วย
const REQUEST_TIMEOUT_MS = 15000;

let inflight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postRefresh = async () => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await axios.post('/api/auth/refresh', null, {
        withCredentials: true,
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      const raced = error.response?.data?.error?.code === 'REFRESH_RACE';
      if (!raced || attempt >= MAX_RETRIES) throw error;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
};

const withCrossTabLock = (task) => {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('trs-auth-refresh', task);
  }
  return task();
};

/** คืน axios response ของ /auth/refresh — { user, accessToken } อยู่ใน data */
export const refreshSession = () => {
  if (!inflight) {
    inflight = withCrossTabLock(postRefresh).finally(() => {
      inflight = null;
    });
  }
  return inflight;
};

export default refreshSession;
