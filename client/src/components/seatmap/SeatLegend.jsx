import clsx from 'clsx';
import { X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { zoneRing } from './zoneRing.js';

/**
 * คำอธิบายสีที่นั่ง + ราคาต่อโซน (ผลสำรวจระบุว่าต้องเห็นราคาแต่ละโซนทันที)
 * showOwn = หน้าเปลี่ยนที่นั่ง มีที่นั่งเดิมของการจองแสดงแยกไว้
 * ตัวอย่างสีต้องตรงกับ SeatMap ทุกสถานะ
 */
const SeatLegend = ({ prices, showOwn = false }) => {
  const { t, lang } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-muted sm:text-body-2">
      <span className="inline-flex items-center gap-1.5">
        <span className={clsx('h-5 w-5 rounded border bg-surface-2', zoneRing.NORMAL)} />
        {t('seats.available')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-5 w-5 rounded border border-selected-line bg-selected" />
        {t('seats.selected')}
      </span>
      {showOwn && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-5 w-5 rounded border border-dashed border-selected-line bg-selected/30" />
          {t('seatChange.original')}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-danger/30 bg-danger-bg text-danger/70">
          <X size={11} strokeWidth={3} />
        </span>
        {t('seats.occupied')}
      </span>

      {prices && (
        <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(prices).map(([zone, price]) => (
            <span key={zone} className="inline-flex items-center gap-1.5">
              <span className={clsx('h-5 w-5 rounded border bg-surface-2', zoneRing[zone])} />
              {t(`seats.zone${zone}`)} {formatMoney(price, lang)} {t('common.baht')}
            </span>
          ))}
        </span>
      )}
    </div>
  );
};

export default SeatLegend;
