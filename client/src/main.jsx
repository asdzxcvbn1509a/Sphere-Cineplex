import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './context/I18nContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { useAuthStore } from './store/authStore.js';
import './index.css';

// สถานะล็อกอินอยู่ใน zustand จึงไม่ต้องมี Provider ครอบ
// เรียกทันทีตอนเปิดแอปเพื่อกู้เซสชันเดิมจาก refresh cookie (ยิงครั้งเดียว ไม่โดน StrictMode เรียกซ้ำ)
useAuthStore.getState().bootstrap();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
