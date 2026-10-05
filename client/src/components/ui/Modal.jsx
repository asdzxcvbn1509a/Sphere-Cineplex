import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';

const Modal = ({ open, onClose, title, children, footer, size = 'md' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="ปิดหน้าต่าง"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          // dvh = ความสูงที่เห็นจริงบนมือถือ (vh รวมส่วนที่แถบ URL บังอยู่ ปุ่มท้ายหน้าต่างจะหลุดจอ)
          'animate-fade-up card relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-b-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface-2/95 px-5 py-4 backdrop-blur">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {/* มือถือ: ปุ่มขยายเต็มแถวให้กดง่าย และตกบรรทัดได้เมื่อมีหลายปุ่ม (เช่นลบภาพยนตร์ที่มีการจอง) — จอใหญ่ชิดขวาตามเดิม */}
        {footer && (
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/95 px-5 py-4 backdrop-blur *:grow sm:*:grow-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
