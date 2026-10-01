import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const tones = {
  success: 'border-success/40 text-success',
  error: 'border-danger/40 text-danger',
  info: 'border-line text-info',
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message, type = 'info', timeout = 4500) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, message, type }]);
      setTimeout(() => dismiss(id), timeout);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      push,
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        z สูงกว่า Modal (z-50) หนึ่งขั้น เพราะ Modal ถูก render ผ่าน portal ไปที่ document.body
        จึงอยู่หลัง toast ใน DOM ถ้า z เท่ากันจะชนะการซ้อน แล้ว backdrop-blur ของมันจะเบลอ toast ทับ
        toast เป็นข้อความแจ้งผลที่ต้องอ่านออกเสมอ จึงต้องลอยอยู่บนสุด
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => {
          const Icon = icons[toast.type] ?? Info;
          return (
            <div
              key={toast.id}
              role="status"
              className={`animate-fade-up pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border bg-surface-2/95 px-4 py-3.5 shadow-xl backdrop-blur ${tones[toast.type] ?? tones.info}`}
            >
              <Icon size={20} className="mt-0.5 shrink-0" />
              <p className="flex-1 text-center text-sm text-fg sm:text-base">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-muted transition hover:text-fg"
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast ต้องอยู่ภายใน <ToastProvider>');
  return context;
};

export default ToastProvider;
