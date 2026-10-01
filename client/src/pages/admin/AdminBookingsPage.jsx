import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { cancelBooking, listAllBookings } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { formatDateTime, formatMoney } from '../../utils/format.js';

const STATUSES = ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED', 'EXPIRED'];

const AdminBookingsPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [bookings, setBookings] = useState([]);
  // ?q= มาจากลิงก์ในหน้าจัดการผู้ใช้ (กดที่จำนวนการจองแล้วมาดูรายการของคนนั้นเลย)
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  // page อยู่ใน filters ด้วย — เปลี่ยนตัวกรองแล้วกลับหน้า 1 ได้ในการ set ครั้งเดียว ไม่โหลดซ้ำสองรอบ
  const [filters, setFilters] = useState({ status: '', date: '', q: initialQuery, page: 1 });
  const [meta, setMeta] = useState({ total: 0, pageSize: 50 });
  const [search, setSearch] = useState(initialQuery);
  const [state, setState] = useState({ loading: true, error: null });
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState({ loading: true, error: null });
    listAllBookings(filters)
      .then(({ data }) => {
        // หน้าสุดท้ายว่างลงหลังทำรายการ (เช่นยกเลิกใบสุดท้ายของหน้า) — ถอยไปหน้าก่อนหน้าแทนโชว์ตารางว่าง
        if (data.bookings.length === 0 && filters.page > 1) {
          setFilters((current) => ({ ...current, page: current.page - 1 }));
          return;
        }
        setBookings(data.bookings);
        setMeta({ total: data.total, pageSize: data.pageSize });
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [filters]);

  useEffect(load, [load]);

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

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelBooking(cancelTarget.id, reason.trim());
      toast.success(t('bookings.statusCANCELLED'));
      setCancelTarget(null);
      setReason('');
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-5 text-2xl font-bold sm:text-3xl">{t('admin.bookings')}</h1>

      {/* ทุกช่องกรองทำงานทันทีที่เปลี่ยนค่า จึงไม่ต้องมีปุ่มค้นหาแล้ว */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('common.status')} className="w-44">
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

        <Field label={t('movie.selectDate')} className="w-44">
          <Input
            type="date"
            value={filters.date}
            onChange={(event) =>
              setFilters((current) => ({ ...current, date: event.target.value, page: 1 }))
            }
          />
        </Field>

        <Field label={t('common.search')} className="min-w-56 flex-1">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={15}
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="TRS-XXXXXX / 08X-XXX-XXXX"
              className="pl-9"
            />
          </div>
        </Field>
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
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
                    <p className="text-[11px] text-muted">{formatDateTime(booking.createdAt, lang)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {booking.user?.name}
                    <p className="text-[11px] text-muted">{booking.user?.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    {lang === 'en' ? booking.showtime.movie.titleEn : booking.showtime.movie.titleTh}
                    <p className="text-[11px] text-muted">
                      {booking.showtime.theatre.name} · {formatDateTime(booking.showtime.startsAt, lang)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {booking.seats.map((seat) => seat.label).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={booking.status} label={t(`bookings.status${booking.status}`)} />
                  </td>
                  <td className="px-4 py-3 text-right text-base font-bold">
                    {formatMoney(booking.totalAmount, lang)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'PAID'].includes(booking.status) && (
                      <Button variant="ghost" size="sm" onClick={() => setCancelTarget(booking)}>
                        <span className="text-danger">{t('common.cancel')}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!state.loading && !state.error && (
        <Pagination
          className="mt-4"
          page={filters.page}
          pageSize={meta.pageSize}
          total={meta.total}
          onChange={(page) => setFilters((current) => ({ ...current, page }))}
        />
      )}

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('bookings.cancelTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {t('common.close')}
            </Button>
            <Button variant="danger" loading={busy} onClick={handleCancel}>
              {t('bookings.cancel')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {t('bookings.cancelBody', { code: cancelTarget?.code })}
        </p>
        <Field label={t('admin.paymentQueue.rejectReason')}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
        </Field>
      </Modal>
    </div>
  );
};

export default AdminBookingsPage;
