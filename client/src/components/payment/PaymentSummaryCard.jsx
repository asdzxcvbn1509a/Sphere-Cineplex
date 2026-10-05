import { useI18n } from '../../context/I18nContext.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

/**
 * การ์ดสรุปการจองด้านบนหน้าชำระเงิน — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * amount = ยอดที่จัดรูปแบบแล้ว · children = บรรทัดที่นั่ง (ค่าตั๋ว: ที่นั่งของการจอง · ส่วนต่าง: ที่นั่งเดิม → ใหม่)
 * มือถือย้ายยอดเงินลงเป็นแถวล่างเต็มความกว้าง รายละเอียดจะไม่ถูกคอลัมน์ยอดเงินบีบจนอ่านยาก
 */
const PaymentSummaryCard = ({ booking, amountLabel, amount, children }) => {
  const { t, lang, pick } = useI18n();
  const { showtime } = booking;

  return (
    <div className="card mb-4 flex flex-wrap gap-3 p-4 sm:flex-nowrap sm:gap-5 sm:p-6">
      <img
        src={showtime.movie.posterUrl}
        alt=""
        className="h-24 w-16 shrink-0 rounded-lg object-cover sm:h-45 sm:w-30"
      />
      <div className="min-w-0 flex-1 text-sm sm:text-base">
        <p className="truncate font-semibold">{pick(showtime.movie, 'title')}</p>
        <p className="mt-0.5 text-muted">
          {showtime.theatre.name} · {formatDate(showtime.startsAt, lang)}{' '}
          {formatTime(showtime.startsAt, lang)}
        </p>
        {children}
      </div>
      <div className="flex basis-full items-center justify-between gap-2 border-t border-line pt-3 sm:block sm:shrink-0 sm:basis-auto sm:border-0 sm:pt-0 sm:text-right">
        <p className="text-xs text-muted">{amountLabel}</p>
        <p className="text-xl font-bold text-accent sm:text-2xl">
          {amount} <span className="text-xs font-normal text-muted sm:block">{t('common.baht')}</span>
        </p>
      </div>
    </div>
  );
};

export default PaymentSummaryCard;
