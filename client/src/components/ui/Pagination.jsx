import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from './Button.jsx';

/**
 * ปุ่มเปลี่ยนหน้าของรายการฝั่งผู้ดูแล — ซ่อนตัวเองเมื่อมีหน้าเดียว
 * total/pageSize มาจาก server เสมอ หน้าเว็บไม่ได้นับเอง
 */
const Pagination = ({ page, pageSize, total, onChange, className }) => {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total || pages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={t('common.pagination')}
      className={clsx('flex flex-wrap items-center justify-between gap-3 text-sm', className)}
    >
      <span className="text-muted">{t('common.pageRange', { from, to, total })}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={14} /> {t('common.prevPage')}
        </Button>
        <span className="tabular-nums text-muted">{t('common.pageOf', { page, pages })}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          {t('common.nextPage')} <ChevronRight size={14} />
        </Button>
      </div>
    </nav>
  );
};

export default Pagination;
