import { Link, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { Clapperboard, FileText } from 'lucide-react';
import { getTicket } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';

const TicketPage = () => {
  const { bookingId } = useParams();
  const { t, lang, pick } = useI18n();
  const { data: ticket, loading, error } = useApi(
    () => getTicket(bookingId).then(({ data }) => data.ticket),
    [bookingId],
  );

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <ErrorBlock message={error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.myBookings'), to: '/my-bookings' },
          { label: t('ticket.title') },
        ]}
      />

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
              <p className="font-semibold">
                {formatTime(ticket.showtime.startsAt, lang)}
                {/* "น." ใช้กับเวลาภาษาไทยเท่านั้น */}
                {lang === 'th' && ' น.'}
              </p>
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

      {ticket.payment?.receiptNo && (
        <div className="mt-4 text-center">
          <Button as={Link} to={`/booking/${ticket.id}/receipt`} variant="secondary" size="sm">
            <FileText size={14} /> {t('ticket.viewReceipt')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default TicketPage;
