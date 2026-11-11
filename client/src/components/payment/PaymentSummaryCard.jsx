import { useI18n } from '../../context/I18nContext.jsx';
import { formatDate, formatTime } from '../../utils/format.js';
import Chip from '../ui/Chip.jsx';

/**
 * การ์ดสรุปการจองด้านบนหน้าชำระเงิน — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * amount = ยอดที่จัดรูปแบบแล้ว · children = บรรทัดที่นั่ง (ค่าตั๋ว: ที่นั่งของการจอง · ส่วนต่าง: ที่นั่งเดิม → ใหม่)
 * มือถือย้ายยอดเงินลงเป็นแถวล่างเต็มความกว้าง รายละเอียดจะไม่ถูกคอลัมน์ยอดเงินบีบจนอ่านยาก
 */
const PaymentSummaryCard = ({ booking, amountLabel, amount, children }) => {
  const { t, lang, pick, theatreName } = useI18n();
  const { showtime } = booking;

  return (
    <div className="card mb-4 flex flex-wrap gap-3 p-4 sm:flex-nowrap sm:gap-5 sm:p-6">
      <img
        src={showtime.movie.posterUrl}
        alt=""
        className="h-24 w-16 shrink-0 rounded-lg object-cover sm:h-45 sm:w-30"
      />
      <div className="min-w-0 flex-1 text-body-2 sm:text-body-1">
        <p className="truncate font-semibold">{pick(showtime.movie, 'title')}</p>
        {/* โรง วัน เวลาเป็นชิปทองแบบเดียวกับการ์ดในหน้าการจองของฉัน — ลูกค้าเห็นรอบที่จ่ายเป็นชุดเดียวกันทุกหน้า */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone="accent">{theatreName(showtime.theatre.name)}</Chip>
          <Chip tone="accent">{formatDate(showtime.startsAt, lang)}</Chip>
          <Chip tone="accent">{formatTime(showtime.startsAt, lang)}</Chip>
        </div>
        {children}
      </div>
      <div className="flex basis-full items-center justify-between gap-2 border-t border-line pt-3 sm:block sm:shrink-0 sm:basis-auto sm:border-0 sm:pt-0 sm:text-right">
        <p className="text-caption text-muted">{amountLabel}</p>
        <p className="text-h2 font-bold text-accent sm:text-h1">
          ฿ {amount}
        </p>
      </div>
    </div>
  );
};

export default PaymentSummaryCard;
