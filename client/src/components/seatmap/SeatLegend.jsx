import clsx from 'clsx';
import { X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatBaht } from '../../utils/format.js';
import { zoneFill } from './zoneRing.js';

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
        <span className="h-5 w-5 rounded border-2 border-success" />
        {t('seats.selected')}
      </span>
      {showOwn && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-5 w-5 rounded border border-dashed border-success bg-success/15" />
          {t('seatChange.original')}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-danger bg-danger/70 text-cream-10">
          <X size={11} strokeWidth={3} />
        </span>
        {t('seats.occupied')}
      </span>

      {prices && (
        <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(prices).map(([zone, price]) => (
            <span key={zone} className="inline-flex items-center gap-1.5">
              {/* สีโซนคือสีของที่นั่งว่างในผัง จึงไม่ต้องมีตัวอย่าง "ว่าง" แยกอีกช่อง */}
              <span className={clsx('h-5 w-5 rounded border', zoneFill[zone])} />
              {t(`seats.zone${zone}`)} {formatBaht(price, lang)}
            </span>
          ))}
        </span>
      )}
    </div>
  );
};

export default SeatLegend;
