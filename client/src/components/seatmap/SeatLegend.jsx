import clsx from 'clsx';
import { X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatMoney } from '../../utils/format.js';

/** คำอธิบายสีที่นั่ง + ราคาต่อโซน (ผลสำรวจระบุว่าต้องเห็นราคาแต่ละโซนทันที) */
const SeatLegend = ({ prices }) => {
  const { t, lang } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted sm:text-sm">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-5 w-5 rounded border border-line bg-surface-2" />
        {t('seats.available')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-5 w-5 rounded border border-accent bg-accent" />
        {t('seats.selected')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-danger/25 bg-danger/10 text-danger/60">
          <X size={11} strokeWidth={3} />
        </span>
        {t('seats.occupied')}
      </span>

      {prices && (
        <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(prices).map(([zone, price]) => (
            <span key={zone} className="inline-flex items-center gap-1.5">
              <span
                className={clsx(
                  'h-5 w-5 rounded border bg-surface-2',
                  zone === 'PREMIUM'
                    ? 'border-info/50'
                    : zone === 'SOFA'
                      ? 'border-accent/50'
                      : 'border-line',
                )}
              />
              {t(`seats.zone${zone}`)} {formatMoney(price, lang)} {t('common.baht')}
            </span>
          ))}
        </span>
      )}
    </div>
  );
};

export default SeatLegend;
