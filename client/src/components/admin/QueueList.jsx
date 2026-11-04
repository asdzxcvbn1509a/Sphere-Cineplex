import { useEffect, useRef } from 'react';
import { ArrowDownUp } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from '../ui/Button.jsx';
import Pagination from '../ui/Pagination.jsx';
import { formatBaht, formatDateTime } from '../../utils/format.js';

/**
 * ผ่านมานานเท่าไหร่ แบบสั้นพอวางท้ายแถวรายการ (5น. · 2ชม. · 1วัน)
 * ใช้ข้อความจาก i18n ไม่ใช้ Intl.NumberFormat แบบ unit — ภาษาไทยได้ "5นาที" ยาวกว่าที่ออกแบบไว้ และต่างกันไปตามเบราว์เซอร์
 * ไม่ต่ำกว่า 1 นาที — "0น." อ่านแล้วเหมือนยังไม่ได้เกิดขึ้น
 */
const elapsedLabel = (t, since) => {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t('admin.queue.waitedMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('admin.queue.waitedHours', { count: hours });
  return t('admin.queue.waitedDays', { count: Math.floor(hours / 24) });
};

/**
 * แผงรายการของคิวงานผู้ดูแล (ตรวจสลิป · คืนเงิน) — แถบหัวพร้อมปุ่มสลับลำดับ แถวที่เลือกได้ และแบ่งหน้า
 *
 * rowOf(item) → { code, at, name, amount } — at คือเวลาที่ใช้นับ "ผ่านมานานเท่าไหร่" ท้ายแถว
 * ลำดับเป็นหน้าที่ของ server จึงถูกต้องข้ามทุกหน้า แผงนี้แค่บอกลำดับที่ใช้อยู่ (sortLabel) และส่งต่อการกดสลับ
 * ตัวเลขเวลาขยับตามรอบที่หน้าโหลดคิวใหม่ (polling) ไม่ได้มีนาฬิกาของตัวเอง
 */
const QueueList = ({
  label,
  sortLabel,
  onToggleSort,
  items,
  rowOf,
  selectedId,
  onSelect,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
}) => {
  const { t, lang } = useI18n();
  const listRef = useRef(null);

  // ใบที่เลือกต้องมองเห็นในแผงรายการเสมอ รวมถึงตอนที่ระบบเลื่อนไปใบถัดไปเองหลังทำรายการ
  // เลื่อนเฉพาะในแผง — scrollIntoView จะลากทั้งหน้าขึ้นไปด้วยบนจอที่แผงเรียงลงมา (ul เป็น relative จึงเป็น offsetParent)
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[aria-current="true"]');
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [selectedId]);

  return (
    // overflow-hidden ตัดมุมแถบหัวให้โค้งตามการ์ด
    <section
      aria-label={label}
      className="card flex max-h-80 flex-col overflow-hidden md:col-span-2 xl:col-span-1 xl:max-h-none xl:min-h-0"
    >
      {/* แถบหัวแบบเดียวกับหัวตารางของผู้ดูแล */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-2/60 py-1.5 pl-4 pr-2">
        <p className="text-body-2 font-medium">{label}</p>
        {/* ป้ายบอกลำดับที่ใช้อยู่ กดแล้วสลับ */}
        <Button variant="ghost" size="sm" onClick={onToggleSort}>
          <ArrowDownUp size={14} />
          {sortLabel}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-10 text-body-2 text-muted">
          {t('admin.queue.listEmpty')}
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-busy={loading || undefined}
          className={clsx(
            'relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 transition',
            loading && 'opacity-60',
          )}
        >
          {items.map((item) => {
            const active = item.id === selectedId;
            const row = rowOf(item);
            return (
              <li key={item.id}>
                {/*
                  ใบที่เลือก = "รายการที่เลือก" ใน DS (น้ำเงิน) เหมือนเมนูข้าง — ขอบโปร่งในใบอื่นกันแถวกระโดด
                  ข้อความรองในใบที่เลือกไม่ใช้ muted เพราะครีมหม่นบนน้ำเงินคอนทราสต์ไม่พอ
                */}
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(item)}
                  className={clsx(
                    'w-full rounded-lg border px-3 py-2 text-left transition',
                    active
                      ? 'border-selected-line bg-selected text-on-selected'
                      : 'border-transparent hover:bg-surface-2',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-code text-body-2 font-medium">{row.code}</span>
                    {/* ชี้ค้างเห็นเวลาเต็ม ๆ */}
                    {row.at && (
                      <time
                        dateTime={row.at}
                        title={formatDateTime(row.at, lang)}
                        className={clsx('shrink-0 text-caption', !active && 'text-muted')}
                      >
                        {elapsedLabel(t, row.at)}
                      </time>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-2 text-body-2">
                    <span className={clsx('truncate', !active && 'text-muted')}>{row.name}</span>
                    <span className="shrink-0 font-medium">{formatBaht(row.amount, lang)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ซ่อนตัวเองเมื่อมีหน้าเดียว เส้นคั่นจึงไม่โผล่มาเปล่า ๆ */}
      <Pagination
        className="shrink-0 border-t border-line px-4 py-3"
        page={page}
        pageSize={pageSize}
        total={total}
        onChange={onPageChange}
      />
    </section>
  );
};

export default QueueList;
