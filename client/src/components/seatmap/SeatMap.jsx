import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { MoveHorizontal, X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatMoney } from '../../utils/format.js';

/** ขอบสีบอกโซนของที่นั่งที่ยังว่าง */
const zoneRing = {
  NORMAL: 'border-line',
  PREMIUM: 'border-info/50',
  SOFA: 'border-accent/50',
};

/**
 * ผังที่นั่ง
 * ผลสำรวจ (13/30 คน) ให้ "การแยกสีที่นั่งว่าง/จองแล้วให้ชัดเจน" เป็นเรื่องสำคัญที่สุด
 * จึงใช้สามสถานะที่ต่างกันทั้งสี รูปร่าง และไอคอน ไม่พึ่งสีอย่างเดียว (เผื่อผู้ใช้ตาบอดสี)
 *
 * ownIds = ที่นั่งเดิมของการจองที่กำลังเปลี่ยนที่นั่ง — ในผังเป็น "จองแล้ว" (ของลูกค้าเอง) แต่ต้องกดเอาออก/เลือกคืนได้
 * ตอนไม่ได้เลือกไว้จึงแสดงขอบเส้นประ ให้รู้ว่าเป็นที่นั่งเดิมที่จะถูกปล่อย
 *
 * โรง 12–16 ที่ต่อแถวกว้างเกินจอมือถือ ถ้าย่อที่นั่งให้พอดีจอจะเล็กจนกดพลาด จึงให้เลื่อนแนวนอนแทน
 * โดยเปิดมาที่ช่วงที่นั่งที่เลือกค้างไว้หรือกลางโรง อักษรแถวติดขอบซ้าย และบอกผู้ใช้ว่าเลื่อนดูได้
 */
const SeatMap = ({ rows, selectedIds, onToggle, disabled = false, ownIds = [] }) => {
  const { t } = useI18n();
  const scrollerRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  // เลื่อนไปกลางกลุ่มที่นั่งที่เลือกไว้ (กลับมาจากหน้าล็อกอิน / ที่นั่งเดิมตอนเปลี่ยนที่นั่ง) ถ้าไม่มีก็กลางโรง
  // ทำครั้งเดียวตอนแสดงผัง แตะเลือกที่นั่งหรือรีเฟรชผังแล้วผังจะไม่กระโดด
  // ไม่ใช้ scrollIntoView เพราะจะเลื่อนทั้งหน้าในแนวตั้งไปด้วย
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    const picked = [...scroller.querySelectorAll('[aria-pressed="true"]')].map((seat) =>
      seat.getBoundingClientRect(),
    );
    const center = picked.length
      ? (Math.min(...picked.map((rect) => rect.left)) + Math.max(...picked.map((rect) => rect.right))) / 2 -
        box.left +
        scroller.scrollLeft
      : scroller.scrollWidth / 2;
    scroller.scrollLeft = center - scroller.clientWidth / 2;
  }, []);

  // บอกว่าเลื่อนดูได้เฉพาะตอนที่ผังล้นกล่องจริง — จอใหญ่ไม่ต้องเห็นข้อความนี้
  useEffect(() => {
    const scroller = scrollerRef.current;
    const observer = new ResizeObserver(() => {
      setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    });
    observer.observe(scroller);
    observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="card overflow-hidden p-3 sm:p-6 lg:p-8">
      <div ref={scrollerRef} className="overflow-x-auto pb-2">
        {/* จออยู่ใน wrapper เดียวกับแถวที่นั่ง จึงกว้างเท่าผังพอดี และเลื่อนไปพร้อมกันบนมือถือ */}
        <div className="mx-auto w-fit">
          <div className="mb-6 sm:mb-8">
            <div className="screen-curve" />
            <p className="mt-1 text-center text-xs font-semibold uppercase tracking-[0.3em] text-muted sm:text-sm">
              {t('seats.screen')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 sm:gap-2 lg:gap-3">
            {rows.map((row) => (
              <div key={row.rowLabel} className="flex items-center">
                {/*
                  ติดขอบซ้ายตอนเลื่อนผัง ยังรู้ว่าอยู่แถวไหน — พื้นทึบสูงเต็มแถว (self-stretch) และเว้นด้วย pr แทน gap
                  ที่นั่งที่เลื่อนผ่านใต้ตัวอักษรจะถูกบังทั้งหมด ไม่โผล่ขอบบน-ล่างออกมา
                */}
                <span className="sticky left-0 z-10 flex w-6 shrink-0 items-center justify-center self-stretch bg-surface pr-2 text-[11px] font-semibold text-muted sm:text-xs">
                  {row.rowLabel}
                </span>

                <div className="flex gap-1 sm:gap-1.5 lg:gap-2.5">
                  {row.seats.map((seat) => {
                    const isSelected = selectedIds.includes(seat.id);
                    const isOwn = ownIds.includes(seat.id);
                    const isTaken = seat.status !== 'AVAILABLE' && !isOwn;
                    const label = `${row.rowLabel}${seat.seatNumber}`;

                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={isTaken || disabled}
                        onClick={() => onToggle(seat)}
                        aria-label={`${label} · ${t(`seats.zone${seat.zone}`)} · ${
                          isTaken ? t('seats.occupied') : formatMoney(seat.price)
                        }${isOwn ? ` · ${t('seatChange.original')}` : ''}`}
                        aria-pressed={isSelected}
                        title={`${label} · ${formatMoney(seat.price)} ${t('common.baht')}`}
                        className={clsx(
                          'flex h-7 items-center justify-center rounded-md border text-[10px] font-semibold transition sm:h-8 sm:text-xs',
                          seat.zone === 'SOFA' ? 'w-11 sm:w-12' : 'w-7 sm:w-8',
                          isSelected &&
                            'scale-105 border-accent bg-accent text-ink shadow-lg shadow-accent/20',
                          !isSelected &&
                            isTaken &&
                            'cursor-not-allowed border-danger/25 bg-danger/10 text-danger/60',
                          !isSelected &&
                            isOwn &&
                            'border-dashed border-accent bg-accent/10 text-accent hover:bg-accent/20',
                          !isSelected &&
                            !isTaken &&
                            !isOwn &&
                            `bg-surface-2 text-muted hover:border-accent hover:text-accent ${zoneRing[seat.zone]}`,
                        )}
                      >
                        {isTaken && !isSelected ? <X size={11} strokeWidth={3} /> : seat.seatNumber}
                      </button>
                    );
                  })}
                </div>

                {/* มือถือซ่อนอักษรแถวฝั่งขวา (ฝั่งซ้ายติดจออยู่แล้ว) ให้ผังกินที่น้อยลง */}
                <span className="hidden w-6 shrink-0 pl-2 text-center text-xs font-semibold text-muted sm:block">
                  {row.rowLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {overflowing && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
          <MoveHorizontal size={14} className="shrink-0" /> {t('seats.scrollHint')}
        </p>
      )}
    </div>
  );
};

export default SeatMap;
