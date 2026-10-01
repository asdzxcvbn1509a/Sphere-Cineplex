import clsx from 'clsx';
import { X } from 'lucide-react';
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
 */
const SeatMap = ({ rows, selectedIds, onToggle, disabled = false }) => {
  const { t } = useI18n();

  return (
    <div className="card overflow-hidden p-4 sm:p-8">
      <div className="overflow-x-auto pb-2">
        {/* จออยู่ใน wrapper เดียวกับแถวที่นั่ง จึงกว้างเท่าผังพอดี และเลื่อนไปพร้อมกันบนมือถือ */}
        <div className="mx-auto w-fit">
          <div className="mb-6 sm:mb-8">
            <div className="screen-curve" />
            <p className="mt-1 text-center text-xs font-semibold uppercase tracking-[0.3em] text-muted sm:text-sm">
              {t('seats.screen')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 sm:gap-3">
            {rows.map((row) => (
              <div key={row.rowLabel} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-muted sm:text-xs">
                  {row.rowLabel}
                </span>
  
                <div className="flex gap-1.5 sm:gap-2.5">
                  {row.seats.map((seat) => {
                    const isSelected = selectedIds.includes(seat.id);
                    const isTaken = seat.status !== 'AVAILABLE';
                    const label = `${row.rowLabel}${seat.seatNumber}`;
  
                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={isTaken || disabled}
                        onClick={() => onToggle(seat)}
                        aria-label={`${label} · ${t(`seats.zone${seat.zone}`)} · ${
                          isTaken ? t('seats.occupied') : formatMoney(seat.price)
                        }`}
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
                            !isTaken &&
                            `bg-surface-2 text-muted hover:border-accent hover:text-accent ${zoneRing[seat.zone]}`,
                        )}
                      >
                        {isTaken && !isSelected ? <X size={11} strokeWidth={3} /> : seat.seatNumber}
                      </button>
                    );
                  })}
                </div>
  
                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-muted sm:text-xs">
                  {row.rowLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SeatMap;
