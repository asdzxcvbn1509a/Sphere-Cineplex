import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  HandCoins,
  Hourglass,
  Minus,
  ScanLine,
  Ticket,
  TicketCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import { getOverview } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import useApi from '../../hooks/useApi.js';
import { formatDateTime, formatMoney, formatPercent, formatTime } from '../../utils/format.js';

/**
 * การ์ดตัวเลขสรุป — trend (ถ้ามี) อยู่ชิดขวาของแถวตัวเลข
 * การ์ดที่แคบจนวางข้างกันไม่พอ (3 ใบต่อแถวบนจอ xl) trend จะขึ้นบรรทัดใหม่แต่ยังชิดขวา ไม่ล้นการ์ด
 */
const StatCard = ({ icon: Icon, label, value, unit, tone = 'text-fg', trend, className }) => (
  <div className={clsx('card flex items-center gap-4 p-5 sm:p-6', className)}>
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
      <Icon size={26} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-body-2 text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap items-end gap-x-3">
        <p className={clsx('text-h1 font-bold', tone)}>
          {value}
          {unit && <span className="ml-1.5 text-body-1 font-normal text-muted">{unit}</span>}
        </p>
        {trend}
      </div>
    </div>
  </div>
);

/** สีและไอคอนตามทิศทาง — key คือ Math.sign ของ % ที่เปลี่ยน */
const TREND_STYLE = {
  [-1]: { icon: TrendingDown, tone: 'text-danger' },
  0: { icon: Minus, tone: 'text-muted' },
  1: { icon: TrendingUp, tone: 'text-success' },
};

/**
 * รายได้วันนี้เทียบกับเมื่อวาน ณ เวลาเดียวกัน (server นับยอดเมื่อวานถึงเวลาเดียวกับ generatedAt)
 * เมื่อวานยังไม่มีรายได้ก็หารไม่ได้ จึงไม่แสดง — รวมถึงตอนที่ server ยังไม่ส่ง revenueYesterday มา
 */
const RevenueTrend = ({ today, yesterday, asOf }) => {
  const { t, lang } = useI18n();
  if (!(yesterday > 0)) return null;

  const change = Math.round(((today - yesterday) / yesterday) * 100);
  const { icon: Icon, tone } = TREND_STYLE[Math.sign(change)];

  return (
    <p
      className="ml-auto shrink-0 text-right"
      title={t('admin.overviewPage.vsYesterdayHint', { time: formatTime(asOf, lang) })}
    >
      <span className={clsx('inline-flex items-center gap-1 text-body-2 font-medium', tone)}>
        <Icon size={14} />
        {formatPercent(change / 100, lang)}
      </span>
      <span className="block text-caption text-muted">{t('admin.overviewPage.vsYesterday')}</span>
    </p>
  );
};

/** แผงรายการล่าสุดของคิวสลิป/คืนเงิน — ใบที่ยังรอผู้ดูแลอยู่ server เรียงขึ้นมาก่อนแล้ว */
const QueuePanel = ({ icon: Icon, title, to, rows, statusLabel }) => {
  const { t, lang } = useI18n();

  return (
    <section className="card pb-2">
      <div className="flex items-center gap-3 p-5 sm:p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
          <Icon size={22} />
        </span>
        <h2 className="flex-1 text-h2 font-bold">{title}</h2>
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-body-2 text-muted transition hover:text-accent"
        >
          {t('admin.viewAll')} <ArrowRight size={14} />
        </Link>
      </div>

      {/*
        ตารางเต็มความกว้างการ์ด หัวตารางเป็นแถบแบบเดียวกับตารางอื่นของผู้ดูแล
        ช่องแรกกับช่องสุดท้ายเว้นเท่าหัวแผง ตัวอักษรจึงตรงแนวกับหัวข้อ
        มือถือซ่อนชื่อลูกค้า เหลือรหัส ยอด และสถานะ พอดีจอโดยไม่ต้องเลื่อนตาราง
      */}
      <div className="overflow-x-auto">
        <table className="w-full text-body-2 sm:min-w-md">
          <thead className="border-y border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2.5 pl-5 pr-3 font-medium sm:pl-6">{t('payment.bookingCode')}</th>
              <th className="hidden px-3 py-2.5 font-medium sm:table-cell">{t('admin.overviewPage.customer')}</th>
              <th className="px-3 py-2.5 font-medium">{t('admin.overviewPage.amount')}</th>
              <th className="py-2.5 pl-3 pr-5 font-medium sm:pr-6">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted">
                  {t('common.empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line/60 last:border-0">
                <td className="py-3 pl-5 pr-3 font-code text-caption text-accent sm:pl-6">{row.code}</td>
                <td className="hidden px-3 py-3 sm:table-cell">
                  {/* ตัดชื่อยาวด้วย … ที่ span — truncate ที่ td ตรง ๆ ใช้ไม่ได้ทุกเบราว์เซอร์ · ชี้ค้างดูชื่อเต็มได้ */}
                  <span className="block max-w-40 truncate" title={row.customer}>
                    {row.customer}
                  </span>
                </td>
                <td className="px-3 py-3">{formatMoney(row.amount, lang)}</td>
                <td className="py-3 pl-3 pr-5 sm:pr-6">
                  <StatusBadge status={row.status} label={statusLabel(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const AdminOverviewPage = () => {
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useApi(async () => {
    const res = await getOverview();
    // หน้านี้มีตัวเลขอยู่แล้ว ป้อนให้ป้ายบนเมนูเลย จะได้ไม่ต้องยิงซ้ำ
    useAdminQueueStore.getState().setCounts({
      pendingSlips: res.data.pendingSlips,
      pendingRefunds: res.data.pendingRefunds,
    });
    return res.data;
  }, []);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="p-6">
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      </div>
    );
  }

  // บอกด้วยว่าคืนเพราะอะไร — คืนส่วนต่างเปลี่ยนที่นั่งไม่ได้แปลว่าลูกค้ายกเลิกการจอง (เงื่อนไขเดียวกับหน้าคืนเงิน)
  const refundLabel = (row) => {
    const group = row.kind && row.kind !== 'BOOKING' ? 'refundDifference' : 'refundCancelled';
    return t(`admin.overviewPage.${group}.${row.status}`);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('admin.overview')}</h1>
        {/* ตัวเลขทั้งหน้าเป็นของ ณ ตอนที่โหลด — เปิดค้างไว้นานจะได้รู้ว่าข้อมูลเก่าแค่ไหน */}
        {data.generatedAt && (
          <p className="text-body-2 text-muted">
            {t('admin.overviewPage.asOf', { at: formatDateTime(data.generatedAt, lang) })}
          </p>
        )}
      </div>

      {/* จอ xl: แถวบน 3 ใบ (6 คอลัมน์ ใบละ 2) แถวล่าง 2 ใบ (ใบละ 3) · จอกลาง: รายได้เต็มแถว ที่เหลือแถวละ 2 ใบ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-6">
        <StatCard
          className="sm:col-span-2"
          icon={Banknote}
          label={t('admin.revenueToday')}
          // ฿ นำหน้าแทนหน่วย "บาท" ต่อท้าย — ตัวเลขใหญ่สั้นลง เหลือที่วาง % เทียบเมื่อวานข้าง ๆ
          value={`฿${formatMoney(data.revenueToday, lang)}`}
          tone="text-accent"
          trend={
            <RevenueTrend
              today={data.revenueToday}
              yesterday={data.revenueYesterday}
              asOf={data.generatedAt}
            />
          }
        />
        <StatCard
          className="xl:col-span-2"
          icon={TicketCheck}
          label={t('admin.bookingsToday')}
          value={data.bookingsToday}
        />
        <StatCard
          className="xl:col-span-2"
          icon={Ticket}
          label={t('admin.ticketsToday')}
          value={data.ticketsToday}
        />
        <StatCard
          className="xl:col-span-3"
          icon={CalendarClock}
          label={t('admin.showtimesToday')}
          value={data.showtimesToday}
          unit={t('admin.unitShowtimes')}
        />
        <StatCard
          className="xl:col-span-3"
          icon={Hourglass}
          label={t('admin.activeHolds')}
          value={data.activeHolds}
          unit={t('admin.unitItems')}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:mt-8 lg:grid-cols-2 lg:gap-6">
        <QueuePanel
          icon={ScanLine}
          title={t('admin.pendingSlips')}
          to="/admin/payments"
          rows={data.recentSlips}
          statusLabel={(row) => t(`admin.paymentStatus.${row.status}`)}
        />
        <QueuePanel
          icon={HandCoins}
          title={t('admin.refunds')}
          to="/admin/refunds"
          rows={data.recentRefunds}
          statusLabel={refundLabel}
        />
      </div>
    </div>
  );
};

export default AdminOverviewPage;
