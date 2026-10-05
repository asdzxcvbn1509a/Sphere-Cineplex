import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarClock, HandCoins, Hourglass, ScanLine, Ticket, TicketCheck } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { getOverview } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { formatMoney } from '../../utils/format.js';

const StatCard = ({ icon: Icon, label, value, unit, tone = 'text-fg' }) => (
  <div className="card flex items-center gap-4 p-5 sm:p-6">
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
      <Icon size={26} />
    </span>
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold sm:text-3xl ${tone}`}>
        {value}
        {unit && <span className="ml-1.5 text-base font-normal text-muted">{unit}</span>}
      </p>
    </div>
  </div>
);

/** แผงรายการล่าสุดของคิวสลิป/คืนเงิน — ใบที่ยังรอผู้ดูแลอยู่ server เรียงขึ้นมาก่อนแล้ว */
const QueuePanel = ({ icon: Icon, title, to, rows }) => {
  const { t, lang } = useI18n();

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
          <Icon size={22} />
        </span>
        <h2 className="flex-1 text-xl font-bold sm:text-2xl">{title}</h2>
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-muted transition hover:text-accent"
        >
          {t('admin.viewAll')} <ArrowRight size={14} />
        </Link>
      </div>

      {/* มือถือซ่อนชื่อลูกค้า เหลือรหัส ยอด และสถานะ พอดีจอโดยไม่ต้องเลื่อนตาราง */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm sm:min-w-md">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">{t('payment.bookingCode')}</th>
              <th className="hidden py-2 pr-3 font-medium sm:table-cell">{t('admin.paymentQueue.customer')}</th>
              <th className="py-2 pr-3 font-medium">{t('bookings.total')}</th>
              <th className="py-2 font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  {t('common.empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/60">
                <td className="py-2.5 pr-3 font-mono text-xs text-accent">{row.code}</td>
                <td className="hidden max-w-40 truncate py-2.5 pr-3 sm:table-cell">{row.customer}</td>
                <td className="py-2.5 pr-3">{formatMoney(row.amount, lang)}</td>
                <td className="py-2.5">
                  <StatusBadge status={row.status} label={t(`admin.paymentStatus.${row.status}`)} />
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
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });

  const load = () => {
    setState({ loading: true, error: null });
    getOverview()
      .then((res) => {
        setData(res.data);
        setState({ loading: false, error: null });
        // หน้านี้มีตัวเลขอยู่แล้ว ป้อนให้ป้ายบนเมนูเลย จะได้ไม่ต้องยิงซ้ำ
        useAdminQueueStore.getState().setCounts({
          pendingSlips: res.data.pendingSlips,
          pendingRefunds: res.data.pendingRefunds,
        });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  };

  useEffect(load, []);

  if (state.loading) return <LoadingBlock label={t('common.loading')} />;
  if (state.error) {
    return (
      <div className="p-6">
        <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:py-8">
      {/* เมนูด้านข้างบอกอยู่แล้วว่าอยู่หน้าไหน จึงซ่อนหัวข้อไว้ให้ screen reader อย่างเดียว */}
      <h1 className="sr-only">{t('admin.overview')}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
        <StatCard
          icon={Banknote}
          label={t('admin.revenueToday')}
          value={formatMoney(data.revenueToday, lang)}
          unit={t('common.baht')}
          tone="text-accent"
        />
        <StatCard icon={TicketCheck} label={t('admin.bookingsToday')} value={data.bookingsToday} />
        <StatCard icon={Ticket} label={t('admin.ticketsToday')} value={data.ticketsToday} />
        <StatCard
          icon={CalendarClock}
          label={t('admin.showtimesToday')}
          value={data.showtimesToday}
          unit={t('admin.unitShowtimes')}
        />
        <StatCard
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
        />
        <QueuePanel
          icon={HandCoins}
          title={t('admin.refunds')}
          to="/admin/refunds"
          rows={data.recentRefunds}
        />
      </div>
    </div>
  );
};

export default AdminOverviewPage;
