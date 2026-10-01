import axios from 'axios';
import { useAuthStore } from '../store/authStore.js';

/**
 * access token อยู่ใน authStore ที่เดียว (เก็บใน memory ไม่แตะ localStorage)
 * interceptor อ่านผ่าน getState() ได้โดยตรงเพราะ zustand ไม่ผูกกับ React
 * ถ้ารีเฟรชหน้า เราขอ token ใหม่จาก /auth/refresh ซึ่งใช้ httpOnly cookie
 */
export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/** ถ้ามีหลาย request เจอ 401 พร้อมกัน ให้ยิง refresh แค่ครั้งเดียวแล้วใช้ผลร่วมกัน */
let refreshPromise = null;

const refreshSession = () => {
  if (!refreshPromise) {
    // ใช้ axios ตรง ๆ ไม่ผ่าน instance นี้ เพื่อไม่ให้ interceptor เรียกตัวเองซ้ำ
    refreshPromise = axios
      .post('/api/auth/refresh', null, { withCredentials: true })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

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
