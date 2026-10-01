import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Inbox } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { approvePayment, listPayments, rejectPayment } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import SlipImage from '../../components/ui/SlipImage.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import usePolling from '../../hooks/usePolling.js';
import { formatDateTime, formatMoney, formatTime } from '../../utils/format.js';

/** สลิปที่ลูกค้าส่งหลังการจองหมดเวลาแล้ว และเอาที่นั่งเดิมคืนไม่ได้ — การจองยังเป็น EXPIRED */
const isLateSlip = (payment) => payment.booking.status === 'EXPIRED';

const AdminPaymentsPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [payments, setPayments] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pageSize: 50 });
  const [state, setState] = useState({ loading: true, error: null });
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reason, setReason] = useState('');

  const refreshCounts = useAdminQueueStore((state) => state.refresh);

  const load = useCallback((silent = false) => {
    if (!silent) setState({ loading: true, error: null });
    return listPayments('PENDING_VERIFICATION', { page })
      .then(({ data }) => {
        // ตรวจใบสุดท้ายของหน้าหมดแล้ว — ถอยไปหน้าก่อนหน้า (คิวที่เหลือยังอยู่ตรงนั้น)
        if (data.payments.length === 0 && page > 1) {
          setPage((current) => current - 1);
          return;
        }
        setPayments(data.payments);
        setMeta({ total: data.total, pageSize: data.pageSize });
        setState({ loading: false, error: null });
        // ป้ายบนเมนูต้องลดลงทันทีที่อนุมัติ/ปฏิเสธ ไม่ต้องรอผู้ดูแลรีเฟรชหน้าเอง
        refreshCounts();
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [page, refreshCounts]);

  useEffect(() => {
    load();
  }, [load]);

  // คิวตรวจสลิปควรอัปเดตเองเมื่อมีลูกค้าส่งสลิปเข้ามาใหม่
  usePolling(() => load(true), 15000, true);

  const approve = async (payment) => {
    setBusyId(payment.id);
    try {
      await approvePayment(payment.id);
      // สลิปที่ส่งหลังหมดเวลาและที่นั่งไม่ว่างแล้ว อนุมัติ = เข้าคิวคืนเงิน ไม่ได้ออกตั๋ว
      toast.success(
        isLateSlip(payment)
          ? t('admin.paymentQueue.lateApproved', { code: payment.booking.code })
          : `${payment.booking.code} → ${t('bookings.statusPAID')}`,
      );
      await load(true);
    } catch (error) {
      toast.error(apiError(error).message);
      await load(true);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    setBusyId(rejectTarget.id);
    try {
      await rejectPayment(rejectTarget.id, reason.trim());
      toast.success(`${rejectTarget.booking.code} → ${t('admin.paymentQueue.reject')}`);
      setRejectTarget(null);
      setReason('');
      await load(true);
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:py-8">
      {/* จำนวนสลิปค้างอยู่บนป้ายเมนูแล้ว และคิวรีเฟรชเองทุก 15 วินาที หัวหน้าจึงเหลือไว้ให้ screen reader */}
      <h1 className="sr-only">{t('admin.payments')}</h1>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && payments.length === 0 && (
        <EmptyState compact icon={Inbox} title={t('admin.paymentQueue.empty')} />
      )}

      <div className="flex max-w-200 flex-col gap-6">
        {payments.map((payment) => (
          <article key={payment.id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:p-6">
            <SlipImage
              bookingId={payment.booking.id}
              className="h-60 w-full shrink-0 rounded-lg border border-line bg-surface-2 sm:w-38"
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-base text-accent sm:text-lg">{payment.booking.code}</span>
                <StatusBadge status={payment.status} label={t('bookings.statusPENDING_VERIFICATION')} />
              </div>

              <p className="mt-2 text-base font-bold">
                {lang === 'en'
                  ? payment.booking.showtime.movie.titleEn
                  : payment.booking.showtime.movie.titleTh}
              </p>
              <p className="text-xs text-muted sm:text-sm">
                {payment.booking.showtime.theatre.name} ·{' '}
                {formatDateTime(payment.booking.showtime.startsAt, lang)}
              </p>

              {isLateSlip(payment) && (
                <p className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent sm:text-sm">
                  {t('admin.paymentQueue.lateSlip')}
                </p>
              )}

              <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted">{t('admin.paymentQueue.customer')}</dt>
                <dd className="text-right">
                  {payment.booking.user.name}
                  <span className="block text-muted">{payment.booking.user.phone}</span>
                </dd>

                <dt className="text-muted">{t('ticket.seats')}</dt>
                <dd className="text-right font-medium">
                  {payment.booking.seats.map((seat) => seat.label).join(', ')}
                </dd>

                <dt className="text-muted">{t('payment.reference')}</dt>
                <dd className="text-right font-mono">{payment.reference}</dd>

                <dt className="text-muted">{t('admin.paymentQueue.waitingSince')}</dt>
                <dd className="text-right">
                  {formatTime(payment.slipUploadedAt, lang)} · {formatDateTime(payment.slipUploadedAt, lang).split(' · ')[0]}
                </dd>
              </dl>

              {/* ยอดโอนกับปุ่มชิดล่างเสมอขอบล่างรูปสลิป ตาเลื่อนจากรูปมาหาตัวเลขได้ทันที */}
              <div className="mt-auto pt-4">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-4 py-3">
                  <span className="text-sm text-muted">{t('admin.paymentQueue.amount')}</span>
                  <span className="text-xl font-bold text-accent sm:text-2xl">
                    {formatMoney(payment.amount, lang)} {t('common.baht')}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="success"
                    size="sm"
                    className="flex-1"
                    loading={busyId === payment.id}
                    onClick={() => approve(payment)}
                  >
                    <CheckCircle2 size={15} /> {t('admin.paymentQueue.approve')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="flex-1"
                    disabled={busyId === payment.id}
                    onClick={() => {
                      setRejectTarget(payment);
                      setReason('');
                    }}
                  >
                    {t('admin.paymentQueue.reject')}
                  </Button>
                </div>
              </div>
            </div>
          </article>
        ))}

        {!state.loading && !state.error && (
          <Pagination page={page} pageSize={meta.pageSize} total={meta.total} onChange={setPage} />
        )}
      </div>

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('admin.paymentQueue.rejectTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busyId === rejectTarget?.id}
              disabled={!reason.trim()}
              onClick={reject}
            >
              {t('admin.paymentQueue.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.paymentQueue.rejectReason')} required>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('admin.paymentQueue.rejectPlaceholder')}
            rows={5}
            maxLength={200}
            autoFocus
          />
        </Field>
      </Modal>
    </div>
  );
};

export default AdminPaymentsPage;
