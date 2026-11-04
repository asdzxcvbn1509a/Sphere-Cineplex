import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from './Button.jsx';

/**
 * เลขหน้าของแบบ numbered — ไม่เกิน 7 ช่องเสมอ ปุ่มจึงไม่ล้นแถวแม้มีหลายสิบหน้า
 * 7 หน้าลงไปแสดงครบ · มากกว่านั้น: หน้าแรก … ก่อนหน้า ปัจจุบัน ถัดไป … หน้าสุดท้าย
 * ใกล้หัวหรือท้ายแสดง 5 หน้าติดกันฝั่งนั้น จำนวนช่องคงที่ ปุ่มลูกศรจึงไม่ขยับตอนกดเปลี่ยนหน้า
 */
const pageItems = (page, pages) => {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap', pages];
  if (page >= pages - 3) return [1, 'gap', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, 'gap', page - 1, page, page + 1, 'gap', pages];
};

/**
 * มือถือปุ่มเล็กลง (size-8) — เจ็ดช่อง + ลูกศรสองปุ่มขนาด size-9 กว้างราว 356px เกินการ์ดบนจอ 390px ปุ่มก่อนหน้าโดนตัด
 * แถบสูงจึงต่างกันตามจอ: ตัวกันที่ของ reserveSpace ต้องใช้ความสูงชุดเดียวกัน (NUMBERED_HEIGHT)
 */
const PAGE_BUTTON =
  'flex size-8 shrink-0 items-center justify-center rounded-lg border text-body-2 font-medium tabular-nums transition disabled:cursor-not-allowed disabled:opacity-50 sm:size-9';
const NUMBERED_HEIGHT = 'h-8 sm:h-9';
// หน้าอื่นหน้าตาแบบปุ่ม secondary · หน้าปัจจุบัน = "รายการที่เลือก" ของ DS (น้ำเงิน) แบบเมนูข้าง
const PAGE_IDLE = 'border-line-strong bg-surface-2 text-fg hover:border-accent/60';
const PAGE_CURRENT = 'border-selected-line bg-selected text-on-selected';

/**
 * ปุ่มเปลี่ยนหน้าของรายการฝั่งผู้ดูแล — ซ่อนตัวเองเมื่อมีหน้าเดียว
 * total/pageSize มาจากคำตอบของ server หรือจากรายการที่แบ่งหน้าฝั่งเว็บ (utils/pagination.js)
 * numbered: ปุ่มเลขหน้า ‹ 1 2 3 › ล้วน ๆ ชิดขวา ตามแบบของตารางเต็มความกว้าง (หน้ารายการของผู้ดูแล)
 *   ไม่มีข้อความ "1–50 จาก N รายการ" — ตำแหน่งปัจจุบันยังบอก screen reader ผ่าน aria-label "หน้า x/y" ของปุ่ม
 * ไม่ใส่: ข้อความช่วงรายการ + ก่อนหน้า / หน้า x/y / ถัดไป ที่กินที่น้อยกว่า
 *   (แผงรายการของคิวสลิปและคิวคืนเงินกว้างแค่ 17rem วางปุ่มเลขเจ็ดช่องไม่พอ)
 * reserveSpace: ตอนซ่อนยังกันที่ไว้สูงเท่าแถบจริง (className เดียวกัน + ตัวกันที่สูงเท่าปุ่ม)
 *   หน้าพอดีจอ (useFitPageSize) นับแถวจากความสูงกล่องรายการ ถ้าแถบโผล่/หายแล้วกล่องยืดหด จำนวนแถวจะเปลี่ยนตามและต้องโหลดใหม่อีกรอบ
 */
const Pagination = ({
  page,
  pageSize,
  total,
  onChange,
  numbered = false,
  reserveSpace = false,
  className,
}) => {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total || pages <= 1) {
    if (!reserveSpace) return null;
    return (
      <div aria-hidden="true" className={clsx('invisible', className)}>
        {/* สูงเท่าปุ่มเลขหน้า (PAGE_BUTTON) หรือปุ่ม Button size sm (h-8) ของแบบไม่มีเลข */}
        <span className={clsx('block', numbered ? NUMBERED_HEIGHT : 'h-8')} />
      </div>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={t('common.pagination')}
      className={clsx(
        'flex flex-wrap items-center gap-3 text-body-2',
        numbered ? 'justify-end' : 'justify-between',
        className,
      )}
    >
      {!numbered && <span className="text-muted">{t('common.pageRange', { from, to, total })}</span>}
      {numbered ? (
        // จอแคบกว่า 360px ปุ่มเล็กแล้วก็ยังไม่พอ — ขึ้นบรรทัดใหม่ดีกว่าล้นจนปุ่มหัวแถวถูกตัดหาย
        <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
          <button
            type="button"
            className={clsx(PAGE_BUTTON, PAGE_IDLE)}
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
            aria-label={t('common.prevPage')}
            title={t('common.prevPage')}
          >
            <ChevronLeft size={16} />
          </button>
          {pageItems(page, pages).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} aria-hidden="true" className="w-5 text-center text-muted">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={clsx(PAGE_BUTTON, item === page ? PAGE_CURRENT : PAGE_IDLE)}
                aria-current={item === page ? 'page' : undefined}
                aria-label={t('common.pageOf', { page: item, pages })}
                // กดหน้าที่เปิดอยู่ไม่ต้องโหลดใหม่
                onClick={() => item !== page && onChange(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className={clsx(PAGE_BUTTON, PAGE_IDLE)}
            disabled={page >= pages}
            onClick={() => onChange(page + 1)}
            aria-label={t('common.nextPage')}
            title={t('common.nextPage')}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : (
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
      )}
    </nav>
  );
};

export default Pagination;
