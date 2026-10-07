import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Hourglass, Ticket, TicketX } from 'lucide-react';
import { apiError } from '../api/client.js';
import { getBooking } from '../api/bookings.js';
import { getPayment, uploadSlip } from '../api/payments.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PaymentSummaryCard from '../components/payment/PaymentSummaryCard.jsx';
import PromptPayPanel from '../components/payment/PromptPayPanel.jsx';
import SlipUploadForm from '../components/payment/SlipUploadForm.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import useCountdown from '../hooks/useCountdown.js';
import usePolling from '../hooks/usePolling.js';
import { formatDateTime, formatMoney, formatTime } from '../utils/format.js';

const PaymentPage = () => {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();

  const { data, loading, error, reload } = useApi(async () => {
    const [bookingRes, paymentRes] = await Promise.all([getBooking(bookingId), getPayment(bookingId)]);
    const nextPayment = paymentRes.data.payment;
    return {
      booking: bookingRes.data.booking,
      payment: nextPayment,
      // เส้นตายตามนาฬิกาเครื่องนี้ คำนวณจากจำนวนวินาทีที่ server บอก (null = หมดเวลาแล้ว/ไม่ได้นับ)
      // นับถอยหลังจากวินาทีที่เหลือที่ server คำนวณ ไม่ใช่เทียบ holdExpiresAt กับนาฬิกาเครื่องลูกค้า
      // เครื่องที่ตั้งเวลาช้าจะเห็นเวลาเหลือมากกว่าจริง แล้วโอนเงินไปทั้งที่ระบบปิดรับไปแล้ว
      holdDeadline:
        nextPayment.holdSecondsLeft > 0
          ? new Date(Date.now() + nextPayment.holdSecondsLeft * 1000).toISOString()
          : null,
    };
  }, [bookingId]);
  const booking = data?.booking;
  const payment = data?.payment;
  const holdDeadline = data?.holdDeadline ?? null;

  const status = booking?.status;
  // ส่งสลิปหลังหมดเวลาแล้วที่นั่งไม่ว่าง — การจองคงหมดเวลา แต่สลิปรอผู้ดูแลตรวจเพื่อคืนเงิน
  const lateWaiting = status === 'EXPIRED' && payment?.status === 'PENDING_VERIFICATION';

  // ระหว่างรอ admin ตรวจสลิป หน้าจะอัปเดตเองโดยไม่ต้องให้ผู้ใช้กดรีเฟรช
  usePolling(() => reload({ silent: true }), 5000, status === 'PENDING_VERIFICATION' || lateWaiting);

  const secondsLeft = useCountdown(status === 'PENDING_PAYMENT' ? holdDeadline : null, () =>
    reload({ silent: true }),
  );

  /** คืน true เมื่อส่งสำเร็จ — SlipUploadForm จะล้างไฟล์ที่เลือกไว้ */
  const handleUpload = async (file) => {
    try {
      await uploadSlip(bookingId, file);
      toast.success(t('payment.waitingTitle'));
      await reload({ silent: true });
      return true;
    } catch (error) {
      toast.error(apiError(error).message);
      return false;
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

  // หมดเวลา = job ปิดการจองแล้ว หรือนับถอยหลังครบแล้วแต่ job ยังไม่ทันทำงาน
  const holdOver = status === 'PENDING_PAYMENT' && (!holdDeadline || secondsLeft === 0);
  const expired = status === 'EXPIRED' || holdOver;
  const wasRejected = payment?.status === 'REJECTED' && status === 'PENDING_PAYMENT';
  // server บอกว่ายังรับสลิปส่งช้าได้ — สำหรับคนที่โอนแล้วแต่ส่งหลักฐานไม่ทัน
  const lateUpload = expired && !lateWaiting && payment?.canUploadSlip;
  const lateRefund =
    status === 'EXPIRED' && ['REFUND_PENDING', 'REFUNDED'].includes(payment?.status);
  // การจองที่ยกเลิกมีการ์ดของตัวเองด้านล่าง — เดิมรวมอยู่ในนี้แล้วขึ้น "หมดเวลาชำระเงินแล้ว"
  // ทั้งที่อาจจ่ายไปแล้วและรอเงินคืน (แจ้งเตือนยกเลิก/รอบฉายถูกยกเลิก/คืนเงินแล้ว พามาที่หน้านี้)
  const closed = expired && !lateUpload && !lateWaiting && !lateRefund;
  const refundStatus = booking.payment?.status;

  const uploadForm = <SlipUploadForm onUpload={handleUpload} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">{t('payment.title')}</h1>
      <p className="mb-6 text-sm text-muted">
        {t('payment.bookingCode')}: <span className="font-mono text-accent">{booking.code}</span>
      </p>

      <PaymentSummaryCard
        booking={booking}
        amountLabel={t('payment.amount')}
        amount={formatMoney(booking.totalAmount, lang)}
      >
        <p className="mt-1.5 text-muted">
          {t('ticket.seats')}:{' '}
          <span className="font-semibold text-fg">
            {booking.seats.map((seat) => seat.label).join(', ')}
          </span>
        </p>
      </PaymentSummaryCard>

      {status === 'PAID' && (
        <div className="card border-success/40 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.approvedTitle')}</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button as={Link} to={`/booking/${booking.id}/ticket`}>
              <Ticket size={16} /> {t('payment.viewTicket')}
            </Button>
            <Button as={Link} to={`/booking/${booking.id}/receipt`} variant="secondary">
              <FileText size={16} /> {t('payment.viewReceipt')}
            </Button>
          </div>
        </div>
      )}

      {status === 'PENDING_VERIFICATION' && (
        <div className="card border-info/40 p-6 text-center sm:p-8">
          <Hourglass className="mx-auto mb-3 animate-pulse text-info" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.waitingTitle')}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted sm:text-base">
            {t('payment.waitingBody')}
          </p>
          <p className="mt-3 text-xs text-muted">{t('payment.waitingHint')}</p>
        </div>
      )}

      {lateWaiting && (
        <div className="card border-info/40 p-6 text-center sm:p-8">
          <Hourglass className="mx-auto mb-3 animate-pulse text-info" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.lateWaitingTitle')}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted sm:text-base">
            {t('payment.lateWaitingBody')}
          </p>
        </div>
      )}

      {lateRefund && (
        <div className="card border-accent/40 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto mb-3 text-accent" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.lateRefundTitle')}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted sm:text-base">
            {t('payment.lateRefundBody')}
          </p>
          <Button as={Link} to="/my-bookings" variant="secondary" className="mt-4">
            {t('payment.goMyBookings')}
          </Button>
        </div>
      )}

      {lateUpload && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="card border-accent/40 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <AlertTriangle size={18} className="shrink-0 text-accent" /> {t('payment.lateTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted sm:text-base">
              {t('payment.lateBody', {
                time: payment.lateSlipUntil ? formatTime(payment.lateSlipUntil, lang) : '—',
              })}
            </p>
            <p className="mt-3 text-sm text-muted">
              {t('payment.reference')}:{' '}
              <span className="font-mono text-fg">{payment.reference}</span>
            </p>
          </div>
          {uploadForm}
        </div>
      )}

      {status === 'CANCELLED' && (
        <div className="card p-6 text-center sm:p-8">
          <TicketX className="mx-auto mb-3 text-muted" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.cancelledTitle')}</h2>
          {refundStatus === 'REFUND_PENDING' && (
            <p className="mt-2 text-sm text-accent sm:text-base">{t('bookings.refundPending')}</p>
          )}
          {refundStatus === 'REFUNDED' && (
            <p className="mt-2 text-sm text-success sm:text-base">
              {t('bookings.refunded', { at: formatDateTime(booking.payment.refundedAt, lang) })}
            </p>
          )}
          {/* บัญชีรับเงินคืนและสลิปคืนเงินอยู่ที่การ์ดของการจองนี้ในแท็บประวัติ */}
          <Button as={Link} to="/my-bookings?tab=history" variant="secondary" className="mt-4">
            {t('payment.goMyBookings')}
          </Button>
        </div>
      )}

      {closed && (
        <div className="card border-danger/40 p-6 text-center sm:p-8">
          <AlertTriangle className="mx-auto mb-3 text-danger" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.expired')}</h2>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/')}>
            {t('errors.goHome')}
          </Button>
        </div>
      )}

      {status === 'PENDING_PAYMENT' && !expired && (
        <>
          {wasRejected && (
            <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4">
              <p className="flex items-center gap-2 font-semibold text-danger">
                <AlertTriangle size={16} /> {t('payment.rejectedTitle')}
              </p>
              <p className="mt-1 text-sm text-fg/90">
                {t('payment.rejectedReason')}: {payment.rejectReason}
              </p>
              <p className="mt-1 text-xs text-muted">{t('payment.rejectedRetry')}</p>
            </div>
          )}

          {/* จอใหญ่วาง QR คู่กับช่องส่งสลิป เห็นทั้งสองขั้นตอนในจอเดียว */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <PromptPayPanel
              qrPayload={payment.qrPayload}
              reference={payment.reference}
              promptPayId={payment.promptPayId}
              secondsLeft={secondsLeft}
              downloadName={`promptpay-${booking.code}`}
            />

            {uploadForm}
          </div>
        </>
      )}
    </div>
  );
};

export default PaymentPage;
