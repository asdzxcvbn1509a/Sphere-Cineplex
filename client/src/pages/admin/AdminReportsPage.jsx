import { useState } from 'react';
import { Download } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { downloadSalesCsv, getOccupancyReport, getSalesReport } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import useApi from '../../hooks/useApi.js';
import { bangkokDateKey, formatDateTime, formatMoney } from '../../utils/format.js';

const GROUPS = [
  { key: 'day', labelKey: 'byDay' },
  { key: 'movie', labelKey: 'byMovie' },
  { key: 'theatre', labelKey: 'byTheatre' },
];

const sevenDaysAgo = () => bangkokDateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

const AdminReportsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [groupBy, setGroupBy] = useState('day');
  const [range, setRange] = useState({ from: sevenDaysAgo(), to: bangkokDateKey() });

  const { data, loading, error, reload } = useApi(async () => {
    const [salesRes, occupancyRes] = await Promise.all([
      getSalesReport({ groupBy, ...range }),
      getOccupancyReport(range),
    ]);
    return { report: salesRes.data, occupancy: occupancyRes.data.showtimes.slice(0, 20) };
  }, [groupBy, range]);
  const report = data?.report;
  const occupancy = data?.occupancy ?? [];

  /** ต้องดึงผ่าน axios เพราะ endpoint ต้องใช้ access token — เปิด URL ตรง ๆ ไม่ได้ */
  const downloadCsv = async () => {
    try {
      const { data } = await downloadSalesCsv({ groupBy, ...range });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sales-${groupBy}-${range.from}-${range.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(apiError(error).message);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-5 text-2xl font-bold sm:text-3xl">{t('admin.reports')}</h1>

      {/* มือถือ: ตัวเลือกการจัดกลุ่มกับปุ่ม CSV เต็มแถว ช่องวันที่สองช่องวางคู่กัน */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-muted">
            {t('admin.reportsPage.groupBy')}
          </span>
          <div className="flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto">
            {GROUPS.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() => setGroupBy(group.key)}
                className={clsx(
                  'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition sm:flex-none',
                  groupBy === group.key ? 'bg-accent text-ink' : 'text-muted hover:text-fg',
                )}
              >
                {t(`admin.reportsPage.${group.labelKey}`)}
              </button>
            ))}
          </div>
        </div>

        <Field label={t('admin.reportsPage.from')} className="sm:w-40">
          <Input
            type="date"
            value={range.from}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
          />
        </Field>
        <Field label={t('admin.reportsPage.to')} className="sm:w-40">
          <Input
            type="date"
            value={range.to}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
          />
        </Field>

        <Button variant="secondary" className="col-span-2" onClick={downloadCsv}>
          <Download size={15} /> {t('admin.reportsPage.exportCsv')}
        </Button>
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && report && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-xs text-muted">{t('admin.reportsPage.revenueCol')}</p>
              <p className="mt-1 text-2xl font-bold text-accent">
                {formatMoney(report.totals.revenue, lang)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted">{t('admin.reportsPage.bookingsCol')}</p>
              <p className="mt-1 text-2xl font-bold">{report.totals.bookings}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted">{t('admin.reportsPage.ticketsCol')}</p>
              <p className="mt-1 text-2xl font-bold">{report.totals.tickets}</p>
            </div>
          </div>

          {report.refunds?.count > 0 && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
              <p className="font-semibold text-danger">{t('admin.reportsPage.refundTitle')}</p>
              <p className="mt-1 text-muted">
                {t('admin.reportsPage.refundBody', {
                  count: report.refunds.count,
                  amount: formatMoney(report.refunds.amount, lang),
                  pending: report.refunds.pendingCount,
                  pendingAmount: formatMoney(report.refunds.pendingAmount, lang),
                })}
              </p>
            </div>
          )}

          {/* มี 4 คอลัมน์ ลดระยะในเซลล์บนมือถือก็พอดีจอ ไม่ต้องเลื่อนตารางไปด้านข้าง */}
          <div className="card mb-6 overflow-x-auto">
            <table className="w-full text-sm sm:min-w-140 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    {t(`admin.reportsPage.${GROUPS.find((g) => g.key === groupBy).labelKey}`)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('admin.reportsPage.bookingsCol')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('admin.reportsPage.ticketsCol')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('admin.reportsPage.revenueCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted">
                      {t('common.empty')}
                    </td>
                  </tr>
                )}
                {report.rows.map((row) => (
                  <tr key={row.key} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {lang === 'en' && row.labelEn ? row.labelEn : row.label}
                    </td>
                    <td className="px-4 py-3 text-right text-muted">{row.bookings}</td>
                    <td className="px-4 py-3 text-right text-muted">{row.tickets}</td>
                    <td className="px-4 py-3 text-right font-semibold text-accent">
                      {formatMoney(row.revenue, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {report.rows.length > 0 && (
                <tfoot className="border-t border-line">
                  <tr className="font-semibold">
                    <td className="px-4 py-3">{t('admin.reportsPage.totals')}</td>
                    <td className="px-4 py-3 text-right">{report.totals.bookings}</td>
                    <td className="px-4 py-3 text-right">{report.totals.tickets}</td>
                    <td className="px-4 py-3 text-right text-accent">
                      {formatMoney(report.totals.revenue, lang)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <h2 className="mb-1.5 text-sm font-medium text-muted">{t('admin.reportsPage.occupancy')}</h2>
          <div className="card divide-y divide-line/60">
            {/* มือถือแถบสัดส่วนลงไปเป็นเส้นบางเต็มแถวด้านล่าง แทนการซ่อนทิ้ง */}
            {occupancy.map((item) => (
              <div key={item.showtimeId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium sm:text-base">
                    {pick(item.movie, 'title')}
                  </p>
                  <p className="text-xs text-muted">
                    {item.theatre} · {formatDateTime(item.startsAt, lang)}
                  </p>
                </div>

                <div className="order-last h-1.5 basis-full overflow-hidden rounded-full bg-surface-2 sm:order-0 sm:h-3 sm:w-48 sm:basis-auto">
                  <div
                    className={clsx(
                      'h-full rounded-full',
                      item.occupancy >= 80 ? 'bg-danger' : item.occupancy >= 40 ? 'bg-accent' : 'bg-success',
                    )}
                    style={{ width: `${item.occupancy}%` }}
                  />
                </div>

                <div className="w-24 shrink-0 text-right text-sm">
                  <span className="font-semibold">{item.occupancy}%</span>
                  <p className="text-xs text-muted">
                    {item.soldSeats}/{item.totalSeats}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminReportsPage;
