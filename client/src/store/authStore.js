import axios from 'axios';
import { create } from 'zustand';
import { refreshSession } from '../api/refresh.js';

/**
 * สถานะการล็อกอินของทั้งแอป
 *
 * ใช้ zustand แทน React context เพราะ axios interceptor ใน api/client.js อยู่นอก React
 * จึงเรียก hook ไม่ได้ — zustand อ่าน/เขียน store จากที่ไหนก็ได้ผ่าน useAuthStore.getState()
 * ทำให้ไม่ต้องเก็บ access token ซ้ำสองที่และไม่ต้องมีฟังก์ชัน setter คอย sync กัน
 *
 * refresh/logout เรียกด้วย axios ตรง ๆ ไม่ผ่าน instance `api`
 * เพราะยืนยันตัวตนด้วย refresh cookie ไม่ได้ใช้ access token
 * และช่วยตัดวงจร import ระหว่าง store กับ api/client.js
 */
const authApi = axios.create({ baseURL: '/api/auth', withCredentials: true });

// ต่ออายุก่อนหมดจริงเล็กน้อย เผื่อเวลาเดินทางของ request
const RENEW_MARGIN_MS = 30 * 1000;

/**
 * เวลาที่ควรต่ออายุ access token ตามนาฬิกาของเครื่องนี้
 * ใช้อายุของ token (exp - iat เป็นเวลาของ server ทั้งคู่) นับจากตอนที่ได้รับ นาฬิกาเครื่องผู้ใช้เพี้ยนก็ไม่กระทบ
 * แค่อ่าน payload ไม่ได้ตรวจลายเซ็น (server ตรวจเอง) — อ่านไม่ได้คืน null แล้วพึ่ง 401 → refresh แบบเดิม
 */
const renewAtOf = (accessToken) => {
  try {
    const payload = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { iat, exp } = JSON.parse(atob(payload));
    const lifetimeMs = (exp - iat) * 1000;
    if (!(lifetimeMs > 0)) return null;
    // ตั้งอายุไว้สั้นมาก (เช่นตอนทดสอบ) ก็ต่อที่ครึ่งอายุ ไม่ใช่ต่อทุก request
    return Date.now() + lifetimeMs - Math.min(RENEW_MARGIN_MS, lifetimeMs / 2);
  } catch {
    return null;
  }
};

/** token กับเวลาต่ออายุต้องเปลี่ยนคู่กันเสมอ */
const withToken = (accessToken) => ({
  accessToken,
  accessTokenRenewAt: accessToken ? renewAtOf(accessToken) : null,
});

export const useAuthStore = create((set, get) => ({
  user: null,
  // เก็บ access token ไว้ใน memory เท่านั้น (ไม่แตะ localStorage) — XSS จึงขโมยไปใช้ต่อไม่ได้
  accessToken: null,
  // ถึงเวลานี้แล้ว request interceptor ต่ออายุก่อนส่ง ไม่รอให้โดน 401 TOKEN_EXPIRED (ดู api/client.js)
  accessTokenRenewAt: null,
  // loading = ยังไม่รู้ว่ามีเซสชันเดิมไหม, authed = ล็อกอินอยู่, guest = ยังไม่ล็อกอิน
  status: 'loading',

  /** เรียกหลังเข้าสู่ระบบหรือสมัครสมาชิกสำเร็จ */
  setSession: ({ user, accessToken }) => set({ user, ...withToken(accessToken), status: 'authed' }),

  setAccessToken: (accessToken) => set(withToken(accessToken)),

  setUser: (user) => set({ user }),

  clearSession: () => set({ user: null, ...withToken(null), status: 'guest' }),

  /**
   * เปิดเว็บใหม่ = ยังไม่มี access token ใน memory ลองขอจาก refresh cookie ก่อน
   * ผ่าน refreshSession ตัวเดียวกับ interceptor — เปิดหลายแท็บพร้อมกันจะต่อคิวกัน ไม่ชนจนโดนเตะออก
   */
  bootstrap: async () => {
    try {
      const { data } = await refreshSession();
      set({ user: data.user, ...withToken(data.accessToken), status: 'authed' });
    } catch {
      set({ user: null, ...withToken(null), status: 'guest' });
    }
  },

  logout: async () => {
    try {
      await authApi.post('/logout');
    } finally {
      get().clearSession();
    }
  },
}));

// selector สำเร็จรูป — component จะ re-render เฉพาะตอนค่าที่ตัวเองใช้เปลี่ยนจริง ๆ
export const useAuthUser = () => useAuthStore((state) => state.user);
export const useAuthStatus = () => useAuthStore((state) => state.status);
export const useIsAuthLoading = () => useAuthStore((state) => state.status === 'loading');
export const useIsAuthenticated = () => useAuthStore((state) => state.status === 'authed');
export const useIsAdmin = () => useAuthStore((state) => state.user?.role === 'ADMIN');

export default useAuthStore;
