import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, ClockFading, TicketX } from 'lucide-react';
import { apiError } from '../api/client.js';
import { getBooking } from '../api/bookings.js';
import { getPayment, uploadSlip } from '../api/payments.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PaymentSummaryCard from '../components/payment/PaymentSummaryCard.jsx';
import PromptPayPanel from '../components/payment/PromptPayPanel.jsx';
import SlipUploadForm from '../components/payment/SlipUploadForm.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import useCountdown from '../hooks/useCountdown.js';
import usePolling from '../hooks/usePolling.js';
import { bookingTab } from '../utils/bookingTabs.js';
import { formatDateTime, formatMoney } from '../utils/format.js';

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

  // ระหว่างรอ admin ตรวจสลิป หน้าจะอัปเดตเองโดยไม่ต้องให้ผู้ใช้กดรีเฟรช
  usePolling(() => reload({ silent: true }), 5000, status === 'PENDING_VERIFICATION');

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
  const refundStatus = booking.payment?.status;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[{ label: t('nav.home'), to: '/' }, { label: t('payment.title') }]}
      />
      <h1 className="mb-1 text-h1 font-bold">{t('payment.title')}</h1>
      <p className="mb-6 text-body-2 text-muted">
        {t('payment.bookingCode')}: <span className="font-code text-accent">{booking.code}</span>
      </p>

      <PaymentSummaryCard
        booking={booking}
        amountLabel={t('payment.amount')}
        amount={formatMoney(booking.totalAmount, lang)}
      >
        <p className="mt-2 text-muted">
          {t('ticket.seats')}:{' '}
          <span className="font-semibold text-fg">
            {booking.seats.map((seat) => seat.label).join(', ')}
          </span>
        </p>
      </PaymentSummaryCard>

      {status === 'PAID' && (
        <div className="card border-success/40 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-h2 font-bold">{t('payment.approvedTitle')}</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button as={Link} to={`/booking/${booking.id}/ticket`} variant="cream">
              {t('payment.viewTicket')}
            </Button>
            <Button as={Link} to={`/booking/${booking.id}/receipt`} variant="cream">
              {t('payment.viewReceipt')}
            </Button>
          </div>
        </div>
      )}

      {status === 'PENDING_VERIFICATION' && (
        <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-6 text-center sm:p-8">
          <ClockFading className="mx-auto mb-3 text-accent" size={40} />
          <h2 className="text-h2 font-bold">{t('payment.waitingTitle')}</h2>
          {/* จอตั้งแต่ lg กว้างพอให้ทั้งประโยคอยู่บรรทัดเดียว — มือถือยังตัดบรรทัดตามปกติ */}
          <p className="mx-auto mt-2 text-body-2 text-muted sm:text-body-1 lg:whitespace-nowrap">
            {t('payment.waitingBody')}{' '}
            {/* "กรุณารอสักครู่..." ห้ามตัดกลางวลี — ถ้าไม่พอที่ให้ขึ้นบรรทัดใหม่ทั้งก้อน */}
            <span className="whitespace-nowrap">{t('payment.waitingWait')}</span>
          </p>
          <p className="mt-3 text-caption text-muted">{t('payment.waitingHint')}</p>
        </div>
      )}

      {/* หมดเวลาแล้วจบ ไม่มีการรับสลิปหลังหมดเวลา */}
      {expired && (
        <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-6 text-center sm:p-8">
          <CircleAlert className="mx-auto mb-3 text-danger-solid" size={40} />
          <h2 className="text-h1 font-bold">{t('payment.expired')}</h2>
          <Button variant="navy" size="sm" className="mt-4" onClick={() => navigate('/')}>
            {t('errors.goHome')}
          </Button>
        </div>
      )}

      {status === 'CANCELLED' && (
        <div className="card p-6 text-center sm:p-8">
          <TicketX className="mx-auto mb-3 text-muted" size={40} />
          <h2 className="text-h2 font-bold">{t('payment.cancelledTitle')}</h2>
          {refundStatus === 'REFUND_PENDING' && (
            <p className="mt-2 text-body-2 text-accent sm:text-body-1">{t('bookings.refundPending')}</p>
          )}
          {refundStatus === 'REFUNDED' && (
            <p className="mt-2 text-body-2 text-success sm:text-body-1">
              {t('bookings.refunded', { at: formatDateTime(booking.payment.refundedAt, lang) })}
            </p>
          )}
          {/* บัญชีรับเงินคืนและสลิปคืนเงินอยู่ที่การ์ดของการจองนี้ — รอคืนเงินอยู่แท็บรอดำเนินการ นอกนั้นแท็บยกเลิก */}
          <Button as={Link} to={`/my-bookings?tab=${bookingTab(booking)}`} variant="secondary" className="mt-4">
            {t('payment.goMyBookings')}
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

          {/* เรียงตามขั้นตอน สแกนจ่าย → แจ้งชำระ จากบนลงล่างทุกขนาดจอ */}
          <div className="flex flex-col gap-4">
            <PromptPayPanel
              qrPayload={payment.qrPayload}
              reference={payment.reference}
              promptPayId={payment.promptPayId}
              secondsLeft={secondsLeft}
              downloadName={`promptpay-${booking.code}`}
              notice={t('payment.payNotice')}
            />

            <SlipUploadForm onUpload={handleUpload} />
          </div>
        </>
      )}
    </div>
  );
};

export default PaymentPage;
