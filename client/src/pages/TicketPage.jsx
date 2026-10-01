import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Clapperboard } from 'lucide-react';
import { apiError } from '../api/client.js';
import { getTicket } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';

const TicketPage = () => {
  const { bookingId } = useParams();
  const { t, lang, pick } = useI18n();
  const [ticket, setTicket] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    setState({ loading: true, error: null });
    getTicket(bookingId)
      .then(({ data }) => {
        setTicket(data.ticket);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [bookingId]);

  if (state.loading) return <LoadingBlock label={t('common.loading')} />;
  if (state.error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <ErrorBlock message={state.error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link
        to="/my-bookings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft size={16} /> {t('ticket.backToBookings')}
      </Link>

      {/*
        การ์ดตั๋วใช้พื้นสว่างบนธีมมืด ตามข้อสรุปของผลสำรวจ:
        หน้าจอต้องสว่างพอให้เครื่องสแกนที่หน้าโรงอ่าน QR ได้
        ลำดับความสำคัญ: QR → โรง/ที่นั่ง → เรื่อง/วันเวลา → ยอดเงิน
      */}
      <div className="overflow-hidden rounded-3xl bg-white text-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between bg-neutral-900 px-5 py-3 text-white">
          <span className="inline-flex items-center gap-2 font-bold">
            <Clapperboard size={18} className="text-accent" /> {t('common.appName')}
          </span>
          <span className="text-xs uppercase tracking-widest text-neutral-400">
            {t('ticket.title')}
          </span>
        </div>

        <div className="flex flex-col items-center px-6 pb-2 pt-6">
          <div className="rounded-2xl border-4 border-neutral-900 p-3">
            <QRCodeCanvas value={ticket.ticketQr} size={200} level="H" marginSize={0} />
          </div>
          <p className="mt-3 font-mono text-lg font-bold tracking-widest">{ticket.code}</p>
          <p className="text-xs text-neutral-500">{t('ticket.scanAtEntrance')}</p>
        </div>

        <div className="mx-6 my-4 grid grid-cols-2 gap-3 rounded-2xl bg-neutral-100 p-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              {t('ticket.theatre')}
            </p>
            <p className="text-2xl font-black leading-tight">{ticket.showtime.theatre.name}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              {t('ticket.seats')}
            </p>
            <p className="text-2xl font-black leading-tight">
              {ticket.seats.map((seat) => seat.label).join(' · ')}
            </p>
          </div>
        </div>

        <div className="px-6 pb-6">
          <p className="text-lg font-bold leading-snug">{pick(ticket.showtime.movie, 'title')}</p>

          <div className="mt-3 grid grid-cols-2 gap-y-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                {t('ticket.showDate')}
              </p>
              <p className="font-semibold">{formatDate(ticket.showtime.startsAt, lang)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                {t('ticket.showTime')}
              </p>
              <p className="font-semibold">{formatTime(ticket.showtime.startsAt, lang)} น.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                {t('ticket.amountPaid')}
              </p>
              <p className="font-semibold">
                {formatMoney(ticket.totalAmount, lang)} {t('common.baht')}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                {t('payment.reference')}
              </p>
              <p className="font-mono text-xs font-semibold">{ticket.payment?.reference}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TicketPage;
