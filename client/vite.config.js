import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // ยิงผ่าน proxy เพื่อให้เป็น same-origin — refresh token cookie (httpOnly) จึงทำงานได้ใน dev
      // รูปสลิปไม่ได้เสิร์ฟเป็น static file แต่ดึงผ่าน /api/payments/:id/slip ที่ตรวจสิทธิ์แล้ว
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
