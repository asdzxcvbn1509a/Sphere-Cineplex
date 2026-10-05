import axios from 'axios';
import { useAuthStore } from '../store/authStore.js';
import { refreshSession } from './refresh.js';

/**
 * access token อยู่ใน authStore ที่เดียว (เก็บใน memory ไม่แตะ localStorage)
 * interceptor อ่านผ่าน getState() ได้โดยตรงเพราะ zustand ไม่ผูกกับ React
 * ถ้ารีเฟรชหน้า เราขอ token ใหม่จาก /auth/refresh ซึ่งใช้ httpOnly cookie
 * และต่ออายุให้ล่วงหน้าก่อน token หมดอายุ ใช้งานปกติจึงไม่เจอ 401 TOKEN_EXPIRED
 */
export const api = axios.create({ baseURL: '/api', withCredentials: true });

/**
 * ถึงเวลาต่ออายุแล้ว (accessTokenRenewAt ใน authStore) ต่อก่อนส่ง — หลายคำขอพร้อมกันได้ refresh จริงครั้งเดียว
 * ต่อไม่สำเร็จก็ส่งใบเดิมไป ให้ response interceptor จัดการ 401 ตามปกติ
 * ไม่ clearSession ตรงนี้ เพราะเน็ตหลุดชั่วคราวไม่ควรทำให้หลุดจากระบบ
 */
const currentAccessToken = async () => {
  const { accessToken, accessTokenRenewAt } = useAuthStore.getState();
  if (!accessToken || !accessTokenRenewAt || Date.now() < accessTokenRenewAt) return accessToken;
  try {
    const { data } = await refreshSession();
    useAuthStore.getState().setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    return accessToken;
  }
};

api.interceptors.request.use(async (config) => {
  const accessToken = await currentAccessToken();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// ถ้ามีหลาย request เจอ 401 พร้อมกัน refreshSession ยิงจริงแค่ครั้งเดียวแล้วแชร์ผล (ดู api/refresh.js)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const url = original?.url ?? '';
    // 401 จากหน้าล็อกอินคือ "รหัสผ่านผิด" ไม่ใช่ "token หมดอายุ" จึงไม่ต้องไป refresh แล้วลองใหม่
    const isAuthEndpoint =
      url.includes('/auth/refresh') || url.includes('/auth/login') || url.includes('/auth/register');

    if (error.response?.status !== 401 || original?._retried || isAuthEndpoint) {
      return Promise.reject(error);
    }

    original._retried = true;
    try {
      const { data } = await refreshSession();
      useAuthStore.getState().setAccessToken(data.accessToken);
      original.headers = { ...original.headers, Authorization: `Bearer ${data.accessToken}` };
      return api(original);
    } catch {
      useAuthStore.getState().clearSession();
      return Promise.reject(error);
    }
  },
);

/** ดึงข้อความ error ที่ backend ส่งมา (backend ส่งเป็นภาษาไทยเสมอ) */
export const apiError = (error) => {
  const payload = error?.response?.data?.error;
  return {
    code: payload?.code ?? 'NETWORK_ERROR',
    message: payload?.message ?? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่',
    details: payload?.details,
    status: error?.response?.status,
  };
};

export default api;
