import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, ClockFading } from 'lucide-react';
import { apiError } from '../api/client.js';
import { cancelSeatChange, getSeatChange, uploadSeatChangeSlip } from '../api/seatChanges.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PaymentSummaryCard from '../components/payment/PaymentSummaryCard.jsx';
import PromptPayPanel from '../components/payment/PromptPayPanel.jsx';
import SlipUploadForm from '../components/payment/SlipUploadForm.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ConfirmModal from '../components/ui/ConfirmModal.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import useCountdown from '../hooks/useCountdown.js';
import usePolling from '../hooks/usePolling.js';
import { formatMoney } from '../utils/format.js';

/**
 * ชำระส่วนต่างของคำขอเปลี่ยนที่นั่ง (ย้ายไปที่นั่งที่แพงกว่า) — โครงเดียวกับหน้าชำระค่าตั๋ว
 * ต่างกันตรงที่ระหว่างนี้ลูกค้ายังมีที่นั่งเดิมอยู่เสมอ: หมดเวลา/ถูกปฏิเสธ/ยกเลิกคำขอ ก็แค่ไม่ได้ย้าย
 */
const SeatChangePaymentPage = () => {
  // :bookingId อยู่ใน URL ให้อ่านแล้วรู้ว่าเป็นของการจองไหน แต่ข้อมูลทั้งหมดมากับคำขอ (change.booking)
  const { changeId } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data, loading, error, reload } = useApi(async () => {
    const { data: body } = await getSeatChange(changeId);
    return {
      change: body.seatChange,
      // เส้นตายตามนาฬิกาเครื่องนี้ คำนวณจากจำนวนวินาทีที่ server บอก (null = ไม่ได้นับ)
      // นับถอยหลังจากวินาทีที่เหลือที่ server คำนวณ ไม่ใช่เทียบ holdExpiresAt กับนาฬิกาเครื่องลูกค้า
      holdDeadline:
        body.seatChange.holdSecondsLeft > 0
          ? new Date(Date.now() + body.seatChange.holdSecondsLeft * 1000).toISOString()
          : null,
    };
  }, [changeId]);
  const change = data?.change;
  const holdDeadline = data?.holdDeadline ?? null;

  const status = change?.status;
  const paymentStatus = change?.payment?.status;

  // ระหว่างรอผู้ดูแลตรวจสลิป หน้าจะอัปเดตเองโดยไม่ต้องกดรีเฟรช
  usePolling(() => reload({ silent: true }), 5000, status === 'PENDING_VERIFICATION');

  const secondsLeft = useCountdown(status === 'PENDING_PAYMENT' ? holdDeadline : null, () =>
    reload({ silent: true }),
  );

  /** คืน true เมื่อส่งสำเร็จ — SlipUploadForm จะล้างไฟล์ที่เลือกไว้ */
  const handleUpload = async (file) => {
    try {
      await uploadSeatChangeSlip(changeId, file);
      toast.success(t('seatChange.waitingTitle'));
      await reload({ silent: true });
      return true;
    } catch (error) {
      toast.error(apiError(error).message);
      return false;
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelSeatChange(changeId);
      toast.success(t('seatChange.requestCancelled'));
      setConfirmCancel(false);
      await reload({ silent: true });
    } catch (error) {
      toast.error(apiError(error).message);
      await reload({ silent: true });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      </div>
    );
  }

  const { booking, payment } = change;
  const amount = formatMoney(change.diffAmount, lang);
  // หมดเวลา = job ปิดคำขอแล้ว หรือนับถอยหลังครบแล้วแต่ job ยังไม่ทันทำงาน
  const holdOver = status === 'PENDING_PAYMENT' && (!holdDeadline || secondsLeft === 0);
  const expired = status === 'EXPIRED' || holdOver;
  const wasRejected = paymentStatus === 'REJECTED' && status === 'PENDING_PAYMENT';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.myBookings'), to: '/my-bookings' },
          { label: t('seatChange.payTitle') },
        ]}
      />
      <h1 className="mb-1 text-h1 font-bold">{t('seatChange.payTitle')}</h1>
      <p className="mb-6 text-body-2 text-muted">
        {t('payment.bookingCode')}: <span className="font-code text-accent">{booking.code}</span>
      </p>

      <PaymentSummaryCard booking={booking} amountLabel={t('seatChange.amount')} amount={amount}>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-muted">
          {t('ticket.seats')}:
          <span className="font-semibold text-fg">{change.fromSeats.join(', ')}</span>
          <ArrowRight size={14} />
          <span className="font-semibold text-accent">{change.toSeats.join(', ')}</span>
        </p>
      </PaymentSummaryCard>

      {status === 'COMPLETED' && (
        <div className="card border-success/40 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-h2 font-bold">{t('seatChange.completedTitle')}</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button as={Link} to={`/booking/${booking.id}/ticket`} variant="cream">
              {t('payment.viewTicket')}
            </Button>
            {payment?.receiptNo && (
              <Button as={Link} to={`/booking/${booking.id}/receipt?payment=${payment.id}`} variant="cream">
                {t('seatChange.viewReceipt')}
              </Button>
            )}
          </div>
        </div>
      )}

      {status === 'PENDING_VERIFICATION' && (
        <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-6 text-center sm:p-8">
          <ClockFading className="mx-auto mb-3 text-accent" size={40} />
          <h2 className="text-h2 font-bold">{t('payment.waitingTitle')}</h2>
          {/* ใช้ข้อความเดียวกับหน้าชำระค่าตั๋ว — จอตั้งแต่ lg ให้ทั้งประโยคอยู่บรรทัดเดียว */}
          <p className="mx-auto mt-2 text-body-2 text-muted sm:text-body-1 lg:whitespace-nowrap">
            {t('payment.waitingBody')} <span className="whitespace-nowrap">{t('payment.waitingWait')}</span>
          </p>
          <p className="mt-3 text-caption text-muted">{t('payment.waitingHint')}</p>
        </div>
      )}

      {(expired || status === 'CANCELLED') && (
        <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-6 text-center sm:p-8">
          <CircleAlert className="mx-auto mb-3 text-danger-solid" size={40} />
          <h2 className="text-h1 font-bold">
            {status === 'CANCELLED' ? t('seatChange.cancelledTitle') : t('payment.expired')}
          </h2>
          <Button as={Link} to="/" variant="navy" size="sm" className="mt-4">
            {t('errors.goHome')}
          </Button>
        </div>
      )}

      {status === 'PENDING_PAYMENT' && !expired && (
        <>
          {wasRejected && (
            <div className="mb-4 rounded-xl border border-danger/40 bg-danger-bg p-4">
              <p className="flex items-center gap-2 font-semibold text-danger">
                <AlertTriangle size={16} /> {t('payment.rejectedTitle')}
              </p>
              <p className="mt-1 text-body-2 text-fg/90">
                {t('payment.rejectedReason')}: {payment.rejectReason}
              </p>
              <p className="mt-1 text-caption text-muted">{t('payment.rejectedRetry')}</p>
            </div>
          )}

          {/* เรียงตามขั้นตอน สแกนจ่าย → แจ้งชำระ จากบนลงล่างทุกขนาดจอ — โครงเดียวกับหน้าชำระค่าตั๋ว */}
          <div className="flex flex-col gap-4">
            <PromptPayPanel
              qrPayload={payment.qrPayload}
              reference={payment.reference}
              promptPayId={payment.promptPayId}
              secondsLeft={secondsLeft}
              downloadName={`promptpay-${booking.code}-seats`}
              notice={t('seatChange.payNotice')}
              noteLabel={t('seatChange.payNoticeLabel')}
            />

            <SlipUploadForm onUpload={handleUpload} />
          </div>

          <div className="mt-4 text-center">
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              {t('seatChange.cancelRequest')}
            </Button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('seatChange.cancelRequestTitle')}
        cancelLabel={t('seatChange.keepRequest')}
        confirmLabel={t('seatChange.cancelRequest')}
        loading={cancelling}
        onConfirm={handleCancel}
      >
        <p className="text-body-2 text-muted">
          {t('seatChange.cancelRequestBody', { seats: change.fromSeats.join(', ') })}
        </p>
      </ConfirmModal>
    </div>
  );
};

export default SeatChangePaymentPage;
