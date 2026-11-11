import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../../context/I18nContext.jsx';

const Modal = ({ open, onClose, title, children, footer, size = 'md' }) => {
  const { t } = useI18n();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        aria-label={t('common.closeWindow')}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          // dvh = ความสูงที่เห็นจริงบนมือถือ (vh รวมส่วนที่แถบ URL บังอยู่ ปุ่มท้ายหน้าต่างจะหลุดจอ)
          // theme-blue = หน้าต่างเป็นพื้นน้ำเงินตาม DS — การ์ด ปุ่ม เส้นคั่นข้างในเปลี่ยนสีตามเอง (ดู index.css)
          'theme-blue animate-fade-up card relative max-h-[92dvh] border-gold-40 w-full overflow-y-auto overscroll-contain rounded-b-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        {/* หัวหน้าต่างน้ำเงินเข้มกว่าเนื้อหา คั่นด้วยเส้นทอง — กรอบนอกก็ขอบทอง เข้าชุดกับการ์ดทั้งเว็บ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gold-50 bg-blue-100/95 px-5 py-4 backdrop-blur">
          <h2 className="text-h2 font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition hover:bg-fg/8 hover:text-fg"
            aria-label={t('common.close')}
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {/* มือถือ: ปุ่มขยายเต็มแถวให้กดง่าย และตกบรรทัดได้เมื่อมีหลายปุ่ม (เช่นลบภาพยนตร์ที่มีการจอง) — จอใหญ่ชิดขวาตามเดิม */}
        {footer && (
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-surface/95 px-5 pb-4 pt-2 backdrop-blur *:grow sm:*:grow-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
