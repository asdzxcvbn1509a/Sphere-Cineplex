import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, FileText, Search } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { cancelBooking, listAllBookings } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { usePagedApi } from '../../hooks/useApi.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';

const STATUSES = ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED', 'EXPIRED'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ตัวกรองเก็บไว้ใน URL ด้วย — เปิดใบเสร็จ/ย้ายที่นั่งในแท็บเดิมแล้วกดย้อนกลับ จะได้ตารางเดิมกลับมาครบ
 * ค่าที่ server ไม่รับ (เช่นแก้ URL เอง) ปัดเป็นค่าเริ่มต้น จะได้ไม่ขึ้น 400 ทั้งหน้า
 */
const readFilters = (params) => {
  const status = params.get('status') ?? '';
  const date = params.get('date') ?? '';
  return {
    status: STATUSES.includes(status) ? status : '',
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

/** จำนวนครั้งที่ย้ายที่นั่งสำเร็จ (ทั้งลูกค้าย้ายเองและผู้ดูแลย้ายให้) */
const movedCount = (booking) => {
  return (booking.seatChange?.history ?? []).filter((change) => change.status === 'COMPLETED').length;
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

  // หน้าเกินหน้าสุดท้าย (ยกเลิกใบสุดท้ายของหน้า หรือ ?page= ใน URL เก่า) — usePagedApi พาไปหน้าสุดท้ายที่มีข้อมูลเอง
  const setPage = useCallback((page) => setFilters((current) => ({ ...current, page })), []);
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listAllBookings(filters);
      return { items: body.bookings, total: body.total, pageSize: body.pageSize };
    },
    { page: filters.page, setPage },
    [filters],
  );
  const bookings = data?.items ?? [];

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
    <div className="p-4 sm:p-6">
      <h1 className="mb-5 text-2xl font-bold sm:text-3xl">{t('admin.bookings')}</h1>

      {/* ทุกช่องกรองทำงานทันทีที่เปลี่ยนค่า จึงไม่ต้องมีปุ่มค้นหาแล้ว — มือถือวางสถานะคู่วันที่ ช่องค้นหาเต็มแถว */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Field label={t('common.status')} className="sm:w-44">
          <Select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value, page: 1 }))
            }
          >
            <option value="">{t('common.all')}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`bookings.status${status}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('movie.selectDate')} className="sm:w-44">
          <Input
            type="date"
            value={filters.date}
            onChange={(event) =>
              setFilters((current) => ({ ...current, date: event.target.value, page: 1 }))
            }
          />
        </Field>

        <Field label={t('common.search')} className="col-span-2 sm:min-w-56 sm:flex-1">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={15}
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="TRS-XXXXXX / RC-… / 08X-XXX-XXXX"
              className="pl-9"
            />
          </div>
        </Field>
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          {/* จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด */}
          <table className="stack-table w-full min-w-190 text-sm">
            <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t('payment.bookingCode')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.paymentQueue.customer')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.showtimes')}</th>
                <th className="px-4 py-3 font-medium">{t('ticket.seats')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('bookings.total')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
              {bookings.map((booking) => (
                <tr key={booking.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-accent">{booking.code}</span>
                    {booking.payment?.receiptNo && (
                      <p className="font-mono text-[11px] text-fg/80">{booking.payment.receiptNo}</p>
                    )}
                    <p className="text-[11px] text-muted">{formatDateTime(booking.createdAt, lang)}</p>
                  </td>
                  <td className="px-4 py-3" data-label={t('admin.paymentQueue.customer')}>
                    {booking.user?.name}
                    <p className="text-[11px] text-muted">{booking.user?.phone}</p>
                  </td>
                  <td className="px-4 py-3" data-label={t('admin.showtimes')}>
                    {pick(booking.showtime.movie, 'title')}
                    <p className="text-[11px] text-muted">
                      {booking.showtime.theatre.name} · {formatDateTime(booking.showtime.startsAt, lang)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted" data-label={t('ticket.seats')}>
                    {booking.seats.map((seat) => seat.label).join(', ')}
                    {/* เคยย้ายที่นั่ง / มีคำขอรอโอนส่วนต่าง — ลูกค้าโทรมาถามจะได้เห็นทันทีว่าที่นั่งเปลี่ยนมาแล้ว */}
                    {booking.seatChange?.open && (
                      <p className="text-[11px] text-accent">{t('seatChange.awaitingPayment')}</p>
                    )}
                    {movedCount(booking) > 0 && (
                      <p className="text-[11px]">{t('seatChange.movedCount', { count: movedCount(booking) })}</p>
                    )}
                  </td>
                  <td className="px-4 py-3" data-label={t('common.status')}>
                    <StatusBadge status={booking.status} label={t(`bookings.status${booking.status}`)} />
                  </td>
                  <td className="px-4 py-3 text-right text-base font-bold" data-label={t('bookings.total')}>
                    {formatMoney(booking.totalAmount, lang)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {/*
                        เปิดในแท็บเดิม — ตัวกรองอยู่ใน URL กดย้อนกลับก็ได้ตารางเดิม
                        state.from ให้ breadcrumb "การจอง" ของหน้าปลายทางพากลับมาหน้าเดิมพร้อมตัวกรองด้วย
                      */}
                      {booking.payment?.receiptNo && (
                        <Button
                          as={Link}
                          to={`/booking/${booking.id}/receipt`}
                          state={{ from: location }}
                          variant="ghost"
                          size="sm"
                        >
                          <FileText size={14} /> {t('bookings.viewReceipt')}
                        </Button>
                      )}
                      {booking.status === 'PAID' && !booking.seatChange?.open && (
                        <Button
                          as={Link}
                          to={`/admin/bookings/${booking.id}/change-seats`}
                          state={{ from: location }}
                          variant="ghost"
                          size="sm"
                        >
                          <ArrowLeftRight size={14} /> {t('seatChange.action')}
                        </Button>
                      )}
                      {['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID'].includes(booking.status) && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelTarget(booking)}>
                          <span className="text-danger">{t('common.cancel')}</span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <Pagination
          className="mt-4"
          page={filters.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={setPage}
        />
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
        <p className="mb-3 text-sm text-muted">
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
