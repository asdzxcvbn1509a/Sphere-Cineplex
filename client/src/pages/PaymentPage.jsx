import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Hourglass,
  Info,
  QrCode,
  Ticket,
  Upload,
} from 'lucide-react';
import { apiError } from '../api/client.js';
import { getBooking } from '../api/bookings.js';
import { getPayment, uploadSlip } from '../api/payments.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useCountdown from '../hooks/useCountdown.js';
import usePolling from '../hooks/usePolling.js';
import { formatCountdown, formatDate, formatMoney, formatTime } from '../utils/format.js';

const PaymentPage = () => {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { t, lang, pick } = useI18n();
  const toast = useToast();

  const [booking, setBooking] = useState(null);
  const [payment, setPayment] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const qrWrapperRef = useRef(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ loading: true, error: null });
      try {
        const [bookingRes, paymentRes] = await Promise.all([
          getBooking(bookingId),
          getPayment(bookingId),
        ]);
        setBooking(bookingRes.data.booking);
        setPayment(paymentRes.data.payment);
        setState({ loading: false, error: null });
      } catch (error) {
        setState({ loading: false, error: apiError(error).message });
      }
    },
    [bookingId],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const status = booking?.status;

  // ระหว่างรอ admin ตรวจสลิป หน้าจะอัปเดตเองโดยไม่ต้องให้ผู้ใช้กดรีเฟรช
  usePolling(() => load(true), 5000, status === 'PENDING_VERIFICATION');

  const secondsLeft = useCountdown(
    status === 'PENDING_PAYMENT' ? booking?.holdExpiresAt : null,
    () => load(true),
  );

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      await uploadSlip(bookingId, file);
      setFile(null);
      toast.success(t('payment.waitingTitle'));
      await load(true);
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setUploading(false);
    }
  };

  const downloadQr = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `promptpay-${booking.code}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (state.loading) return <LoadingBlock label={t('common.loading')} />;
  if (state.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />
      </div>
    );
  }

  const expired = status === 'EXPIRED' || (status === 'PENDING_PAYMENT' && secondsLeft === 0);
  const wasRejected = payment?.status === 'REJECTED' && status === 'PENDING_PAYMENT';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">{t('payment.title')}</h1>
      <p className="mb-6 text-sm text-muted">
        {t('payment.bookingCode')}: <span className="font-mono text-accent">{booking.code}</span>
      </p>

      <div className="card mb-4 p-4 sm:p-6">
        <div className="flex gap-3 sm:gap-5">
          <img
            src={booking.showtime.movie.posterUrl}
            alt=""
            className="h-24 w-16 shrink-0 rounded-lg object-cover sm:h-45 sm:w-30"
          />
          <div className="min-w-0 flex-1 text-sm sm:text-base">
            <p className="truncate font-semibold">{pick(booking.showtime.movie, 'title')}</p>
            <p className="mt-0.5 text-muted">
              {booking.showtime.theatre.name} · {formatDate(booking.showtime.startsAt, lang)}{' '}
              {formatTime(booking.showtime.startsAt, lang)}
            </p>
            <p className="mt-1.5 text-muted">
              {t('ticket.seats')}:{' '}
              <span className="font-semibold text-fg">
                {booking.seats.map((seat) => seat.label).join(', ')}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted">{t('payment.amount')}</p>
            <p className="text-xl font-bold text-accent sm:text-2xl">
              {formatMoney(booking.totalAmount, lang)}
            </p>
            <p className="text-xs text-muted">{t('common.baht')}</p>
          </div>
        </div>
      </div>

      {status === 'PAID' && (
        <div className="card border-success/40 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-xl font-bold sm:text-2xl">{t('payment.approvedTitle')}</h2>
          <Button as={Link} to={`/booking/${booking.id}/ticket`} className="mt-4">
            <Ticket size={16} /> {t('payment.viewTicket')}
          </Button>
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

      {(status === 'CANCELLED' || expired) && status !== 'PAID' && (
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

          <div className="card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <QrCode size={18} className="text-accent" /> {t('payment.scanTitle')}
              </h2>
              <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted">
                  {t('payment.timeLeft')}
                </p>
                <p className="font-mono text-lg font-bold leading-none text-accent">
                  {formatCountdown(secondsLeft)}
                </p>
              </div>
            </div>

            <p className="mb-6 text-sm text-muted">{t('payment.scanHint')}</p>

            {/* style ทับขนาดที่ได้จาก size ทำให้ QR ย่อตามจอมือถือได้ ส่วนรูปที่บันทึกยังคมเท่าเดิม */}
            <div ref={qrWrapperRef} className="mx-auto w-full max-w-80 rounded-2xl bg-white p-4">
              <QRCodeCanvas
                value={payment.qrPayload}
                size={288}
                level="M"
                marginSize={1}
                style={{ width: '100%', height: 'auto' }}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center text-sm">
              <span className="text-muted">
                {t('payment.reference')}:{' '}
                <span className="font-mono text-fg">{payment.reference}</span>
              </span>
              <span className="text-muted">
                PromptPay: <span className="font-mono text-fg">{payment.promptPayId}</span>
              </span>
            </div>

            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={downloadQr}>
                <Download size={16} /> {t('payment.saveQr')}
              </Button>
            </div>

            <p className="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">
              <Info size={16} className="mt-0.5 shrink-0" />
              {t('payment.verifyNotice')}
            </p>
          </div>

          <form onSubmit={handleUpload} className="card mt-4 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <Upload size={18} className="text-accent" /> {t('payment.uploadTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('payment.uploadHint')}</p>

            <label className="mt-4 flex min-h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 text-center transition hover:border-accent/60 sm:min-h-72">
              {preview ? (
                <img src={preview} alt="" className="max-h-64 rounded-lg object-contain" />
              ) : (
                <Upload size={22} className="text-muted" />
              )}
              <span className="text-sm text-muted">
                {file ? file.name : t('payment.chooseFile')}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <Button type="submit" size="lg" className="mt-4 w-full" loading={uploading} disabled={!file}>
              {t('payment.submitSlip')}
            </Button>
          </form>
        </>
      )}
    </div>
  );
};

export default PaymentPage;
