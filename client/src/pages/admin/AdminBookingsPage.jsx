import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, FileText, RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { cancelBooking, listAllBookings } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import SelectMenu from '../../components/ui/SelectMenu.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { FIT_BODY, FIT_CARD, FIT_PAGE, FIT_PAGER } from '../../components/admin/fitLayout.js';
import { usePagedApi } from '../../hooks/useApi.js';
import useFitPageSize from '../../hooks/useFitPageSize.js';
import { formatBaht, formatDateTime } from '../../utils/format.js';

/**
 * กลุ่มของตัวกรองสถานะ — ชื่อกลุ่มแบบเดียวกับแท็บในหน้าการจองของฉัน
 * ป้ายในตาราง (displayStatus จาก server) อยู่ได้กลุ่มเดียว รวมกันครบทุกป้ายที่ server มี — เลือกกลุ่มแล้วส่งทั้งกลุ่มไปกรองในคำขอเดียว
 * กติกาว่าใบไหนได้ป้ายไหนอยู่ที่ server (utils/bookingDisplayStatus.js) ที่เดียว ป้ายในตารางกับผลการกรองจึงตรงกันเสมอ
 * tone = สีจุดหน้าชื่อกลุ่ม ความหมายเดียวกับโทนของป้าย: รอลูกค้า · รอผู้ดูแล · สำเร็จ · จบแล้ว
 */
const STATUS_GROUPS = [
  { value: 'unpaid', tone: 'warning', statuses: ['PENDING_PAYMENT', 'TOPUP_PENDING_PAYMENT'] },
  {
    value: 'pending',
    tone: 'info',
    statuses: [
      'PENDING_VERIFICATION',
      'TOPUP_PENDING_VERIFICATION',
      'DIFF_REFUND_PENDING',
      'CANCELLED_REFUND_PENDING',
      'EXPIRED_REFUND_PENDING',
    ],
  },
  { value: 'paid', tone: 'success', statuses: ['PAID', 'REFUNDED'] },
  { value: 'cancelled', tone: 'neutral', statuses: ['CANCELLED', 'EXPIRED'] },
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** สถานะการจองที่ผู้ดูแลยกเลิกแทนลูกค้าได้ */
const CANCELLABLE = ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID'];
/**
 * ระยะต่อแถวบนจอ xl = xl:h-17 (68px) — เปลี่ยนคู่กับ class ของแถว · เส้นคั่นแถวรวมอยู่ในความสูงนี้แล้ว (border-collapse)
 * สูงพอให้ทุกช่องมีสองบรรทัด: ที่นั่งสองบรรทัด หรือป้ายสถานะที่ยาวจนตัดเป็นสองบรรทัด
 */
const ROW_HEIGHT = 68;

/** ?status= → กลุ่ม: รับชื่อกลุ่ม หรือค่าป้าย/สถานะการจองจากลิงก์รุ่นก่อน (เช่น PAID) แล้วพาไปกลุ่มที่ป้ายนั้นอยู่ */
const groupOf = (value) => {
  return STATUS_GROUPS.find((group) => group.value === value || group.statuses.includes(value));
};

/**
 * ตัวกรองเก็บไว้ใน URL ด้วย — เปิดใบเสร็จ/ย้ายที่นั่งในแท็บเดิมแล้วกดย้อนกลับ จะได้ตารางเดิมกลับมาครบ
 * ค่าที่ server ไม่รับ (เช่นแก้ URL เอง) ปัดเป็นค่าเริ่มต้น จะได้ไม่ขึ้น 400 ทั้งหน้า
 */
const readFilters = (params) => {
  const status = params.get('status') ?? '';
  const date = params.get('date') ?? '';
  return {
    status: groupOf(status)?.value ?? '',
    date: DATE_PATTERN.test(date) ? date : '',
    q: (params.get('q') ?? '').trim(),
    page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1),
  };
};

/** ใส่เฉพาะค่าที่ไม่ใช่ค่าเริ่มต้น — /admin/bookings เฉย ๆ = ไม่กรอง */
const toSearchParams = ({ status, date, q, page }) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (date) params.set('date', date);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return params;
};

const AdminBookingsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const location = useLocation();
  // ตัวกรองเริ่มจาก URL — กลับมาจากใบเสร็จ/ย้ายที่นั่ง
  // หรือ ?q= จากลิงก์ในหน้าจัดการผู้ใช้ (กดที่จำนวนการจองแล้วมาดูรายการของคนนั้นเลย)
  const [searchParams, setSearchParams] = useSearchParams();
  // page อยู่ใน filters ด้วย — เปลี่ยนตัวกรองแล้วกลับหน้า 1 ได้ในการ set ครั้งเดียว ไม่โหลดซ้ำสองรอบ
  const [filters, setFilters] = useState(() => readFilters(searchParams));
  const [search, setSearch] = useState(filters.q);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // จอใหญ่: หน้าละเท่าที่วางพอดีจอ ทั้งหน้าไม่ต้องเลื่อน · จอเล็ก: หน้าละ 50 เลื่อนหน้าได้ตามปกติ
  const fit = useFitPageSize(ROW_HEIGHT);

  // หน้าเกินหน้าสุดท้าย (ยกเลิกใบสุดท้ายของหน้า, ?page= ใน URL เก่า, ขยายจอจนหน้าละหลายแถวขึ้น) — usePagedApi พาไปหน้าสุดท้ายที่มีข้อมูลเอง
  const setPage = useCallback((page) => setFilters((current) => ({ ...current, page })), []);
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listAllBookings({
        displayStatuses: groupOf(filters.status)?.statuses,
        date: filters.date,
        q: filters.q,
        page: filters.page,
        pageSize: fit.pageSize,
      });
      return { items: body.bookings, total: body.total, pageSize: body.pageSize };
    },
    // รอวัดพื้นที่ให้เสร็จก่อน คำขอแรกจะได้จำนวนแถวที่พอดีจอเลย ไม่ต้องยิงซ้ำ
    { page: filters.page, setPage, enabled: fit.ready },
    [filters, fit.pageSize],
  );
  // ตัดไว้ที่ขนาดหน้าปัจจุบัน — ย่อจอแล้วระหว่างรอข้อมูลชุดใหม่ รายการชุดเดิมจะได้ไม่ล้นกล่อง
  const bookings = (data?.items ?? []).slice(0, fit.pageSize);
  // ยังไม่เคยได้ข้อมูล = ยังไม่มีอะไรให้ดู · เปลี่ยนหน้า/ตัวกรองคงตารางเดิมไว้แค่หรี่ลง ไม่กระพริบทุกครั้งที่กดเลขหน้า
  const showSpinner = loading && !data;

  /**
   * ค้นหาแบบพิมพ์ไปค้นไป — หน่วง 400ms หลังหยุดพิมพ์ค่อยยิง API
   * ถ้ายิงทุกตัวอักษรจะเปลืองและคำตอบอาจกลับมาสลับลำดับกันจนแสดงผลผิด
   * เช็คว่าค่าเดิมก่อน setFilters เพื่อไม่ให้ object ใหม่ไปกระตุ้นให้โหลดซ้ำโดยไม่จำเป็น
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = search.trim();
      setFilters((current) => (current.q === q ? current : { ...current, q, page: 1 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  /**
   * เขียนตัวกรองกลับลง URL ทุกครั้งที่เปลี่ยน — ย้อนกลับมาหน้านี้ก็ได้ตัวกรองและหน้าเดิม
   * replace ไม่เพิ่มประวัติทุกครั้งที่พิมพ์/เปลี่ยนหน้า · preventScrollReset ไม่ให้ ScrollRestoration ดีดจอขึ้นบนสุด
   * เทียบกับ URL ปัจจุบันก่อน — เขียนแล้วค่าตรงกันจึงไม่วนเขียนซ้ำ
   */
  useEffect(() => {
    const next = toSearchParams(filters);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true, preventScrollReset: true });
    }
  }, [filters, searchParams, setSearchParams]);

  // ลูกค้าส่งสลิปหรือผู้ดูแลอีกคนคืนเงินได้ตลอด — โหลดใหม่โดยคงตารางเดิมไว้ ไม่กระพริบเป็นหน้ากำลังโหลด
  const refresh = async () => {
    setRefreshing(true);
    await reload({ silent: true });
    setRefreshing(false);
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelBooking(cancelTarget.id, reason.trim());
      toast.success(t('bookings.statusCANCELLED'));
      setCancelTarget(null);
      setReason('');
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={FIT_PAGE}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-h1 font-bold">{t('admin.bookings')}</h1>
        <Button variant="secondary" size="sm" className="ml-auto" loading={refreshing} onClick={refresh}>
          {!refreshing && <RefreshCw size={14} />}
          {t('common.refresh')}
        </Button>
      </div>

      {/*
        ทุกช่องกรองทำงานทันทีที่เปลี่ยนค่า จึงไม่มีปุ่มค้นหา — มือถือวางสถานะคู่วันที่ ช่องค้นหาเต็มแถว
        ไม่มี label เหนือช่องตามแบบ จึงใส่ aria-label แทน ช่องวันที่มี title บอกด้วยว่าเป็นวันฉาย
        (ตอนว่างเบราว์เซอร์โชว์แค่ วว/ดด/ปปปป ไม่รู้ว่าเป็นวันจองหรือวันฉาย)
        สถานะเลือกเป็นกลุ่ม แต่ละกลุ่มบอกว่ามีป้ายอะไรบ้าง — สร้างจากป้ายจริง ข้อความจึงตรงกับในตารางเสมอ
      */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <SelectMenu
          aria-label={t('common.status')}
          className="sm:w-44"
          value={filters.status}
          options={[
            { value: '', label: t('common.all') },
            ...STATUS_GROUPS.map((group) => ({
              value: group.value,
              label: t(`admin.bookingPage.group.${group.value}`),
              description: group.statuses.map((status) => t(`admin.bookingPage.status.${status}`)),
              tone: group.tone,
            })),
          ]}
          onChange={(status) => setFilters((current) => ({ ...current, status, page: 1 }))}
        />

        <Input
          type="date"
          aria-label={t('admin.bookingPage.showDate')}
          title={t('admin.bookingPage.showDate')}
          className="sm:w-44"
          value={filters.date}
          onChange={(event) =>
            setFilters((current) => ({ ...current, date: event.target.value, page: 1 }))
          }
        />

        <div className="relative col-span-2 sm:min-w-56 sm:flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-field-muted"
            size={15}
          />
          <Input
            type="search"
            aria-label={t('common.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('admin.bookingPage.searchPlaceholder')}
            className="pl-9"
          />
        </div>
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : (
        // แบ่งหน้าอยู่ท้ายการ์ดเดียวกับตาราง — overflow-hidden ตัดมุมแถบท้ายให้โค้งตามการ์ด
        // การ์ดกับหัวตารางแสดงตั้งแต่ยังโหลด เพราะต้องวัดพื้นที่ก่อนรู้ว่าจะขอหน้าละกี่แถว
        <div className={FIT_CARD}>
          <div ref={fit.ref} className={FIT_BODY}>
            {/*
              จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด
              จอ xl ความกว้างคอลัมน์ตายตัว (table-fixed): ตารางไม่ล้นด้านข้าง และข้อความยาวตัดด้วย … ทุกแถวจึงสูงเท่ากัน
              รอบฉายได้พื้นที่ที่เหลือทั้งหมด — บรรทัด "โรง · วันเวลา" ยาวกว่าชื่อลูกค้าเกือบทุกครั้ง จึงให้ลูกค้าแค่ 15%
              ป้ายสถานะที่ยาวเกินช่องตัดเป็นสองบรรทัดได้ ยังอยู่ในความสูงแถว
            */}
            <table className="stack-table w-full min-w-190 text-body-2 xl:table-fixed">
              <thead className="border-b border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium xl:w-36">{t('payment.bookingCode')}</th>
                  <th className="px-4 py-3 font-medium xl:w-[15%]">{t('admin.queue.customer')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.showtimes')}</th>
                  <th className="px-4 py-3 font-medium xl:w-40">{t('ticket.seats')}</th>
                  <th className="px-4 py-3 font-medium xl:w-40">{t('common.status')}</th>
                  <th className="px-4 py-3 text-right font-medium xl:w-24">{t('bookings.total')}</th>
                  <th className="px-4 py-3 text-right font-medium xl:w-44">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody
                aria-busy={loading || undefined}
                className={clsx('transition', loading && !showSpinner && 'opacity-60')}
              >
                {showSpinner && (
                  <tr>
                    <td colSpan={7}>
                      <LoadingBlock label={t('common.loading')} />
                    </td>
                  </tr>
                )}
                {!showSpinner && bookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted">
                      {t('common.empty')}
                    </td>
                  </tr>
                )}
                {!showSpinner &&
                  bookings.map((booking) => {
                    const showtime = `${booking.showtime.theatre.name} · ${formatDateTime(booking.showtime.startsAt, lang)}`;
                    const seats = booking.seats.map((seat) => seat.label).join(', ');
                    return (
                      // title บนข้อความที่อาจถูกตัด — ชี้ค้างเห็นเต็ม
                      <tr key={booking.id} className="border-b border-line/60 last:border-0 xl:h-17">
                        <td className="px-4 py-3">
                          <span className="font-code font-medium text-accent">{booking.code}</span>
                          <p className="text-caption text-muted xl:truncate">
                            {formatDateTime(booking.createdAt, lang)}
                          </p>
                        </td>
                        <td className="px-4 py-3" data-label={t('admin.queue.customer')}>
                          <p className="xl:truncate" title={booking.user?.name}>
                            {booking.user?.name}
                          </p>
                          <p className="text-caption text-muted xl:truncate">{booking.user?.phone}</p>
                        </td>
                        <td className="px-4 py-3" data-label={t('admin.showtimes')}>
                          <p className="xl:truncate" title={pick(booking.showtime.movie, 'title')}>
                            {pick(booking.showtime.movie, 'title')}
                          </p>
                          <p className="text-caption text-muted xl:truncate" title={showtime}>
                            {showtime}
                          </p>
                        </td>
                        <td className="px-4 py-3" data-label={t('ticket.seats')}>
                          {/* ราว 5 ที่ต่อบรรทัด — จองหลายที่แล้วตัดบรรทัดลงมา แทนที่จะดันคอลัมน์อื่นให้แคบ · จอ xl ไม่เกินสองบรรทัด */}
                          <p className="max-w-36 xl:line-clamp-2" title={seats}>
                            {seats}
                          </p>
                        </td>
                        <td className="px-4 py-3" data-label={t('common.status')}>
                          <StatusBadge
                            status={booking.displayStatus}
                            label={t(`admin.bookingPage.status.${booking.displayStatus}`)}
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium" data-label={t('bookings.total')}>
                          {formatBaht(booking.totalAmount, lang)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/*
                              ใบเสร็จกับย้ายที่นั่งเป็นไอคอน คอลัมน์จัดการจึงแคบพอให้คอลัมน์ข้อมูลได้ที่ — ชี้ค้างเห็นชื่อปุ่ม
                              เปิดในแท็บเดิม: ตัวกรองอยู่ใน URL กดย้อนกลับก็ได้ตารางเดิม
                              state.from ให้ breadcrumb "การจอง" ของหน้าปลายทางพากลับมาหน้าเดิมพร้อมตัวกรองด้วย
                            */}
                            {booking.payment?.receiptNo && (
                              <Button
                                as={Link}
                                to={`/booking/${booking.id}/receipt`}
                                state={{ from: location }}
                                variant="ghost"
                                size="sm"
                                title={t('bookings.viewReceipt')}
                                aria-label={t('bookings.viewReceipt')}
                              >
                                <FileText size={14} />
                              </Button>
                            )}
                            {booking.status === 'PAID' && !booking.seatChange?.open && (
                              <Button
                                as={Link}
                                to={`/admin/bookings/${booking.id}/change-seats`}
                                state={{ from: location }}
                                variant="ghost"
                                size="sm"
                                title={t('seatChange.action')}
                                aria-label={t('seatChange.action')}
                              >
                                <ArrowLeftRight size={14} />
                              </Button>
                            )}
                            {CANCELLABLE.includes(booking.status) && (
                              <Button variant="ghost" size="sm" onClick={() => setCancelTarget(booking)}>
                                <span className="text-danger">{t('common.cancel')}</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/*
            ซ่อนตัวเองเมื่อมีหน้าเดียว เส้นคั่นจึงไม่โผล่มาเปล่า ๆ
            จอ xl กันที่ไว้แม้ตอนซ่อน — กล่องตารางจะได้ไม่ยืดหดจนจำนวนแถวต่อหน้าเปลี่ยนตาม
          */}
          <Pagination
            numbered
            reserveSpace={fit.active}
            className={FIT_PAGER}
            page={filters.page}
            pageSize={data?.pageSize ?? fit.pageSize}
            total={data?.total ?? 0}
            onChange={setPage}
          />
        </div>
      )}

      <ConfirmModal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('bookings.cancelTitle')}
        cancelLabel={t('common.close')}
        confirmLabel={t('bookings.cancel')}
        loading={busy}
        onConfirm={handleCancel}
      >
        <p className="mb-3 text-body-2 text-muted">
          {t('bookings.cancelBody', { code: cancelTarget?.code })}
        </p>
        <Field label={t('admin.paymentQueue.rejectReason')}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
        </Field>
      </ConfirmModal>
    </div>
  );
};

export default AdminBookingsPage;
