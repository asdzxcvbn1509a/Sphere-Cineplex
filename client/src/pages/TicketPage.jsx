import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import clsx from 'clsx';
import { getTicket } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { formatBaht, formatDate, formatTime } from '../utils/format.js';
import { saveElementAsPng } from '../utils/saveImage.js';

const LABEL = 'text-body-2 text-muted';

/**
 * ปุ่มเลื่อนไปตั๋วของที่นั่งก่อนหน้า/ถัดไป — ลูกศรทองไม่มีกรอบ วางบนพื้นหน้าข้างตั๋ว
 * ไม่ใส่ display ไว้ในตัว ให้ที่เรียกใช้กำหนดเองว่าจอไหนแสดง (hidden sm:flex / flex sm:hidden) คลาสจะได้ไม่ชนกัน
 */
const SeatArrow = ({ direction, label, className, ...props }) => {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'size-11 shrink-0 items-center justify-center text-gold-50 transition',
        'hover:text-gold-30 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-gold-50',
        className,
      )}
      {...props}
    >
      <Icon size={40} strokeWidth={1.5} />
    </button>
  );
};

/**
 * ตั๋วใบละที่นั่ง เลื่อนดูด้วยลูกศร — ทุกใบใช้ QR (รหัสการจอง) เดียวกัน สแกนใบไหนก็เข้าได้ทั้งการจอง
 * แยกใบก็เพื่อให้บันทึกรูปส่งให้เพื่อนในกลุ่มได้คนละใบ แต่ละคนเห็นที่นั่งของตัวเองชัด ๆ
 */
const TicketViewer = ({ ticket }) => {
  const { t, lang, pick, theatreName } = useI18n();
  const toast = useToast();
  const ticketRef = useRef(null);
  const [seatIndex, setSeatIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const { seats, showtime } = ticket;
  const seat = seats[seatIndex];
  const many = seats.length > 1;
  const movieTitle = pick(showtime.movie, 'title');

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveElementAsPng(ticketRef.current, `${ticket.code}-${seat.label}.png`);
    } catch {
      toast.error(t('ticket.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ระหว่างบันทึกห้ามเปลี่ยนใบ — ชื่อไฟล์ผูกกับที่นั่งตอนกด รูปต้องเป็นใบเดียวกัน
  const arrow = (direction) => {
    const step = direction === 'prev' ? -1 : 1;
    const target = seatIndex + step;
    return {
      direction,
      label: t(direction === 'prev' ? 'ticket.prevSeat' : 'ticket.nextSeat'),
      disabled: saving || target < 0 || target >= seats.length,
      onClick: () => setSeatIndex(target),
    };
  };

  return (
    <>
      {/* แถบปุ่มชิดขอบขวาของตั๋ว — คอลัมน์กว้างเท่าการ์ด */}
      <div className="mx-auto mb-4 mt-8 flex max-w-104 flex-wrap justify-end gap-2">
        {ticket.payment?.receiptNo && (
          <Button as={Link} to={`/booking/${ticket.id}/receipt`} size="sm" variant="cream">
            {t('ticket.viewReceipt')}
          </Button>
        )}
        <Button size="sm" loading={saving} onClick={handleSave}>
          {!saving && <Download size={14} />} {t('ticket.save')}
        </Button>
      </div>

      {/*
        ตั๋วกรอบน้ำเงินเข้ม แถบทองบน-ล่าง โลโก้ในวงกลมคร่อมขอบบนของการ์ดขาว
        การ์ดในเป็นพื้นสว่าง (theme-paper) — หน้าจอต้องสว่างพอให้เครื่องสแกนหน้าโรงอ่าน QR ได้
        ลำดับความสำคัญตามผลสำรวจ: QR → โรง/ที่นั่ง → เรื่อง → วันเวลา/ยอดเงิน
        ref อยู่ที่กรอบนอก รูปที่บันทึกจึงได้ทั้งใบรวมกรอบน้ำเงิน
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-center justify-center gap-x-4 sm:grid-cols-[auto_minmax(0,26rem)_auto]">
        <article
          ref={ticketRef}
          aria-label={t('ticket.title')}
          className="overflow-hidden rounded-3xl border-y-8 border-gold-50 bg-blue-80 px-4 pb-6 sm:col-start-2 sm:px-5"
        >
          <p className="pt-2 text-center text-body-1 font-semibold uppercase tracking-wide text-gold-50">
            Ticket
          </p>

          {/* -mb ดึงการ์ดขาวขึ้นมาใต้ครึ่งล่างของวงโลโก้ */}
          <div className="relative z-10 mx-auto -mb-8 mt-1 flex size-20 items-center justify-center rounded-full border-4 border-blue-80 bg-paper">
            <img src="/logo.png" alt="" width={264} height={243} className="h-14 w-auto" />
          </div>

          <div className="theme-paper rounded-2xl px-6 pb-6 pt-10">
            {/* SVG คมทุกขนาด — รูปที่บันทึกวาดใหญ่ 3 เท่า QR ยังสแกนได้ */}
            <div className="flex flex-col items-center">
              <QRCodeSVG value={ticket.ticketQr} size={140} level="H" marginSize={0} />
              <p className="mt-2 font-code text-body-1 font-medium">{ticket.code}</p>
            </div>

            {/*
              คอลัมน์ที่นั่งกว้างเท่าป้ายที่นั่ง ชื่อโรงได้ที่ที่เหลือทั้งหมด จะได้ไม่ขึ้นบรรทัดใหม่
              กล่องฟ้าอ่อนขอบน้ำเงิน — สองอย่างที่ต้องดูตอนเดินเข้าโรงจึงเด่นที่สุดรองจาก QR
            */}
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-6 rounded-lg border border-blue-70 bg-blue-20 px-5 py-2 text-cocoa-100">
              <div>
                <p className="text-body-1 text-cocoa-70">{t('ticket.theatre')}</p>
                <p className="text-h2 sm:text-h1">{theatreName(showtime.theatre.name)}</p>
              </div>
              <div>
                <p className="text-body-1 text-cocoa-70">{t('ticket.seat')}</p>
                <p className="text-h1">{seat.label}</p>
              </div>
            </div>

            <div className="mt-4 border-b border-blue-70 pb-5">
              <p className={LABEL}>{t('ticket.movie')}</p>
              <p title={movieTitle} className="line-clamp-2 text-h2">
                {movieTitle}
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 px-4 text-body-1">
              <div>
                <dt className={LABEL}>{t('ticket.showDate')}</dt>
                <dd>{formatDate(showtime.startsAt, lang)}</dd>
              </div>
              <div>
                <dt className={LABEL}>{t('ticket.showTime')}</dt>
                <dd>
                  {formatTime(showtime.startsAt, lang)}
                  {/* "น." ใช้กับเวลาภาษาไทยเท่านั้น */}
                  {lang === 'th' && ' น.'}
                </dd>
              </div>
              {/* ยอดของทั้งการจอง ไม่ใช่ราคาที่นั่งใบนี้ — ตรงกับใบเสร็จและสลิปที่โอนมา */}
              <div>
                <dt className={LABEL}>{t('ticket.amountPaid')}</dt>
                <dd>{formatBaht(ticket.totalAmount, lang)}</dd>
              </div>
              <div>
                <dt className={LABEL}>{t('payment.reference')}</dt>
                <dd className="font-code">{ticket.payment?.reference}</dd>
              </div>
            </dl>
          </div>
        </article>

        {many && (
          <>
            <SeatArrow {...arrow('prev')} className="col-start-1 row-start-1 hidden justify-self-end sm:flex" />
            <SeatArrow {...arrow('next')} className="col-start-3 row-start-1 hidden justify-self-start sm:flex" />
          </>
        )}
      </div>

      {/* มือถือไม่มีที่ข้างการ์ด ลูกศรจึงลงมาอยู่ข้างตัวนับใต้การ์ด */}
      {many && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <SeatArrow {...arrow('prev')} className="flex sm:hidden" />
          <p aria-live="polite" className="text-body-2 text-muted tabular-nums">
            {t('ticket.position', { current: seatIndex + 1, total: seats.length })}
          </p>
          <SeatArrow {...arrow('next')} className="flex sm:hidden" />
        </div>
      )}
    </>
  );
};

const TicketPage = () => {
  const { bookingId } = useParams();
  const { t } = useI18n();
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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        items={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.myBookings'), to: '/my-bookings' },
          { label: t('ticket.title') },
        ]}
      />
      {/* key: เปิดตั๋วของการจองอื่นในหน้าเดิม (เช่นกดจากแจ้งเตือน) แล้วเริ่มที่ใบแรกเสมอ */}
      <TicketViewer key={ticket.id} ticket={ticket} />
    </div>
  );
};

export default TicketPage;
