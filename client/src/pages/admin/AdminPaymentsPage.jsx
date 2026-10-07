import { useState } from 'react';
import { CheckCircle2, Inbox } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { approvePayment, listPayments, rejectPayment } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import SlipImage from '../../components/ui/SlipImage.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { usePagedApi } from '../../hooks/useApi.js';
import usePolling from '../../hooks/usePolling.js';
import { formatDateTime, formatMoney, formatTime } from '../../utils/format.js';

/** สลิปส่วนต่างเปลี่ยนที่นั่ง — อนุมัติแล้วย้ายที่นั่งจริงและออกใบเสร็จส่วนต่าง */
const isTopUp = (payment) => payment.kind === 'SEAT_CHANGE_TOPUP';

/**
 * สลิปที่ส่งหลังหมดเวลาแล้วและเอาที่นั่งคืนไม่ได้ — อนุมัติ = เข้าคิวคืนเงิน
 * ค่าตั๋ว: การจองยังเป็น EXPIRED · ส่วนต่างเปลี่ยนที่นั่ง: คำขอยังเป็น EXPIRED (การจองเป็น PAID ตามเดิม)
 */
const isLateSlip = (payment) => {
  return isTopUp(payment)
    ? payment.seatChange?.status === 'EXPIRED'
    : payment.booking.status === 'EXPIRED';
};

const AdminPaymentsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reason, setReason] = useState('');

  const refreshCounts = useAdminQueueStore((state) => state.refresh);

  // ตรวจใบสุดท้ายของหน้าหมดแล้ว usePagedApi พาไปหน้าสุดท้ายที่ยังมีคิวเหลืออยู่เอง
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listPayments('PENDING_VERIFICATION', { page });
      // ป้ายบนเมนูต้องลดลงทันทีที่อนุมัติ/ปฏิเสธ ไม่ต้องรอผู้ดูแลรีเฟรชหน้าเอง
      refreshCounts();
      return { items: body.payments, total: body.total, pageSize: body.pageSize };
    },
    { page, setPage },
    [page, refreshCounts],
  );
  const payments = data?.items ?? [];

  // คิวตรวจสลิปควรอัปเดตเองเมื่อมีลูกค้าส่งสลิปเข้ามาใหม่
  usePolling(() => reload({ silent: true }), 15000, true);

  const approve = async (payment) => {
    setBusyId(payment.id);
    try {
      await approvePayment(payment.id);
      // สลิปที่ส่งหลังหมดเวลาและที่นั่งไม่ว่างแล้ว อนุมัติ = เข้าคิวคืนเงิน ไม่ได้ออกตั๋ว
      toast.success(
        isLateSlip(payment)
          ? t('admin.paymentQueue.lateApproved', { code: payment.booking.code })
          : isTopUp(payment)
            ? t('admin.paymentQueue.topUpApproved', { code: payment.booking.code })
            : `${payment.booking.code} → ${t('bookings.statusPAID')}`,
      );
      await reload({ silent: true });
    } catch (error) {
      toast.error(apiError(error).message);
      await reload({ silent: true });
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
      await reload({ silent: true });
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

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && payments.length === 0 && (
        <EmptyState compact icon={Inbox} title={t('admin.paymentQueue.empty')} />
      )}

      <div className="flex max-w-200 flex-col gap-6">
        {payments.map((payment) => (
          <article key={payment.id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:p-6">
            <SlipImage
              bookingId={payment.booking.id}
              paymentId={isTopUp(payment) ? payment.id : undefined}
              className="h-60 w-full shrink-0 rounded-lg border border-line bg-surface-2 sm:w-38"
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-base text-accent sm:text-lg">{payment.booking.code}</span>
                <StatusBadge status={payment.status} label={t('bookings.statusPENDING_VERIFICATION')} />
              </div>

              <p className="mt-2 text-base font-bold">{pick(payment.booking.showtime.movie, 'title')}</p>
              <p className="text-xs text-muted sm:text-sm">
                {payment.booking.showtime.theatre.name} ·{' '}
                {formatDateTime(payment.booking.showtime.startsAt, lang)}
              </p>

              {isTopUp(payment) && (
                <p className="mt-3 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info sm:text-sm">
                  {t('admin.paymentQueue.topUp')}
                </p>
              )}
              {isLateSlip(payment) && (
                <p className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent sm:text-sm">
                  {isTopUp(payment) ? t('admin.paymentQueue.lateTopUp') : t('admin.paymentQueue.lateSlip')}
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
                  {isTopUp(payment)
                    ? `${payment.seatChange.fromSeats.join(', ')} → ${payment.seatChange.toSeats.join(', ')}`
                    : payment.booking.seats.map((seat) => seat.label).join(', ')}
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

        {!loading && !error && (
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        )}
      </div>

      <ConfirmModal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('admin.paymentQueue.rejectTitle')}
        confirmLabel={t('admin.paymentQueue.reject')}
        loading={busyId === rejectTarget?.id}
        disabled={!reason.trim()}
        onConfirm={reject}
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
      </ConfirmModal>
    </div>
  );
};

export default AdminPaymentsPage;
