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
import Pagination from '../../components/ui/Pagination.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { FIT_PAGER } from '../../components/admin/fitLayout.js';
import useApi from '../../hooks/useApi.js';
import { bangkokDateKey, formatDateTime, formatMoney } from '../../utils/format.js';
import { slicePage } from '../../utils/pagination.js';

const GROUPS = [
  { key: 'day', labelKey: 'byDay' },
  { key: 'movie', labelKey: 'byMovie' },
  { key: 'theatre', labelKey: 'byTheatre' },
];

/**
 * รอบฉายต่อหน้าในส่วนอัตราที่นั่งเต็ม — ส่วนนี้อยู่ท้ายหน้าที่เลื่อนได้ จึงใช้ขนาดหน้าตายตัว ไม่นับแถวให้พอดีจอ
 * เดิมตัดแค่ 20 รอบแรก รอบที่เหลือในช่วงวันที่เลือกเปิดดูไม่ได้เลย
 */
const OCCUPANCY_PAGE_SIZE = 10;

const sevenDaysAgo = () => bangkokDateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

const AdminReportsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [groupBy, setGroupBy] = useState('day');
  const [range, setRange] = useState({ from: sevenDaysAgo(), to: bangkokDateKey() });
  const [occupancyPage, setOccupancyPage] = useState(1);

  const { data, loading, error, reload } = useApi(async () => {
    const [salesRes, occupancyRes] = await Promise.all([
      getSalesReport({ groupBy, ...range }),
      getOccupancyReport(range),
    ]);
    return { report: salesRes.data, occupancy: occupancyRes.data.showtimes };
  }, [groupBy, range]);
  const report = data?.report;
  const occupancy = data?.occupancy ?? [];
  // ได้รอบทั้งช่วงวันที่มาครบแล้ว (server ส่งไม่เกิน 200 รอบ) จึงแบ่งหน้าฝั่งเว็บแบบหน้ารอบฉาย
  const occupancyPaged = slicePage(occupancy, occupancyPage, OCCUPANCY_PAGE_SIZE);

  /** เปลี่ยนช่วงวันที่ = รายการรอบชุดใหม่ เริ่มดูจากหน้าแรก */
  const changeRange = (key, value) => {
    setRange((current) => ({ ...current, [key]: value }));
    setOccupancyPage(1);
  };

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
      <h1 className="mb-5 text-h1 font-bold">{t('admin.reports')}</h1>

      {/* มือถือ: ตัวเลือกการจัดกลุ่มกับปุ่ม CSV เต็มแถว ช่องวันที่สองช่องวางคู่กัน */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="col-span-2">
          <span className="mb-1.5 block text-body-2 font-medium text-muted">
            {t('admin.reportsPage.groupBy')}
          </span>
          <Tabs
            stretch
            items={GROUPS.map((group) => ({
              value: group.key,
              label: t(`admin.reportsPage.${group.labelKey}`),
            }))}
            value={groupBy}
            onChange={setGroupBy}
            // แถบครีมทองขอบทอง แท็บที่เลือกพื้นดำตัวขาว — ชุดเดียวกับแท็บหน้าคืนเงิน
            className="border border-gold-50 bg-gold-20"
            activeClassName="bg-cocoa-100 text-cream-10"
          />
        </div>

        <Field label={t('admin.reportsPage.from')} className="sm:w-40">
          <Input
            type="date"
            value={range.from}
            onChange={(event) => changeRange('from', event.target.value)}
          />
        </Field>
        <Field label={t('admin.reportsPage.to')} className="sm:w-40">
          <Input
            type="date"
            value={range.to}
            onChange={(event) => changeRange('to', event.target.value)}
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
              <p className="text-caption text-muted">{t('admin.reportsPage.revenueCol')}</p>
              <p className="mt-1 text-h1 font-bold text-accent">
                {formatMoney(report.totals.revenue, lang)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-caption text-muted">{t('admin.reportsPage.bookingsCol')}</p>
              <p className="mt-1 text-h1 font-bold">{report.totals.bookings}</p>
            </div>
            <div className="card p-4">
              <p className="text-caption text-muted">{t('admin.reportsPage.ticketsCol')}</p>
              <p className="mt-1 text-h1 font-bold">{report.totals.tickets}</p>
            </div>
          </div>

          {report.refunds?.count > 0 && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-body-2">
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
            <table className="w-full text-body-2 sm:min-w-140 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead className="border-b border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
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

          <h2 className="mb-1.5 text-body-2 font-medium text-muted">{t('admin.reportsPage.occupancy')}</h2>
          {/* แถบเลขหน้าอยู่ท้ายการ์ดเดียวกับรายการ เส้นคั่นเหนือแถบแบบหน้ารายการอื่นของผู้ดูแล */}
          <div className="card">
            <div className="divide-y divide-line/60">
              {occupancy.length === 0 && (
                <p className="px-4 py-10 text-center text-body-2 text-muted">{t('common.empty')}</p>
              )}
              {/*
                จอ sm ขึ้นไปแถวสูง 56px (ชื่อเรื่องบรรทัดเดียว + บรรทัดโรง·วัน·เวลา) เท่าแถวของหน้ารายการผู้ดูแล
                มือถือแถบสัดส่วนลงไปเป็นเส้นบางเต็มแถวด้านล่าง แทนการซ่อนทิ้ง
              */}
              {occupancyPaged.items.map((item) => (
                <div
                  key={item.showtimeId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:min-h-14 sm:py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-2 font-medium" title={pick(item.movie, 'title')}>
                      {pick(item.movie, 'title')}
                    </p>
                    <p className="text-caption text-muted">
                      {item.theatre} · {formatDateTime(item.startsAt, lang)}
                    </p>
                  </div>

                  <div className="order-last h-1.5 basis-full overflow-hidden rounded-full bg-surface-2 sm:order-0 sm:h-2.5 sm:w-37.5 sm:basis-auto">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        item.occupancy >= 80 ? 'bg-danger' : item.occupancy >= 40 ? 'bg-warning' : 'bg-success',
                      )}
                      style={{ width: `${item.occupancy}%` }}
                    />
                  </div>

                  {/* min-w ไม่ใช่ w — โรงใหญ่ที่จำนวนที่นั่งหลายหลักขยายช่องได้ ไม่ล้นทับแถบ */}
                  <div className="min-w-16 shrink-0 text-right text-body-2">
                    <span className="font-semibold">{item.occupancy}%</span>
                    <p className="text-caption text-muted tabular-nums">
                      {item.soldSeats}/{item.totalSeats}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              numbered
              className={FIT_PAGER}
              page={occupancyPaged.page}
              pageSize={OCCUPANCY_PAGE_SIZE}
              total={occupancy.length}
              onChange={setOccupancyPage}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default AdminReportsPage;
