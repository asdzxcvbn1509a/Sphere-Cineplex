import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import clsx from 'clsx';
import { getTicket } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';
import { saveElementAsPng } from '../utils/saveImage.js';

const LABEL = 'text-caption uppercase tracking-wide text-muted';

/**
 * ปุ่มเลื่อนไปตั๋วของที่นั่งก่อนหน้า/ถัดไป — วางบนพื้นหน้า (นอก .theme-paper) จึงหน้าตาเหมือนปุ่มรองของธีมมืด
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
        'size-11 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-fg transition',
        'hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong',
        className,
      )}
      {...props}
    >
      <Icon size={20} />
    </button>
  );
};

/**
 * ตั๋วใบละที่นั่ง เลื่อนดูด้วยลูกศร — ทุกใบใช้ QR (รหัสการจอง) เดียวกัน สแกนใบไหนก็เข้าได้ทั้งการจอง
 * แยกใบก็เพื่อให้บันทึกรูปส่งให้เพื่อนในกลุ่มได้คนละใบ แต่ละคนเห็นที่นั่งของตัวเองชัด ๆ
 */
const TicketViewer = ({ ticket }) => {
  const { t, lang, pick } = useI18n();
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
      <div className="mx-auto mb-4 mt-8 flex max-w-120 flex-wrap justify-end gap-2">
        {ticket.payment?.receiptNo && (
          <Button as={Link} to={`/booking/${ticket.id}/receipt`} variant="secondary" size="sm">
            <FileText size={14} /> {t('ticket.viewReceipt')}
          </Button>
        )}
        <Button size="sm" loading={saving} onClick={handleSave}>
          {!saving && <Download size={14} />} {t('ticket.save')}
        </Button>
      </div>

      {/*
        การ์ดตั๋วพื้นสว่างบนธีมมืด (theme-paper) — หน้าจอต้องสว่างพอให้เครื่องสแกนหน้าโรงอ่าน QR ได้
        ลำดับความสำคัญตามผลสำรวจ: QR → โรง/ที่นั่ง → เรื่อง/วันเวลา → ยอดเงิน
        การ์ดแบ่ง 3 แถว (QR · ต้นขั้ว · หนัง) ลงในกริดแม่ด้วย subgrid ลูกศรสองข้างอยู่แถวต้นขั้ว
        จึงตรงกับรอยเว้าเสมอแม้ชื่อโรงยาวจนขึ้นบรรทัดใหม่ และอยู่นอก theme-paper จึงใช้ token ธีมมืดได้ตรง ๆ
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] justify-center gap-x-6 sm:grid-cols-[auto_minmax(0,30rem)_auto]">
        <article
          ref={ticketRef}
          aria-label={t('ticket.title')}
          className="theme-paper row-span-3 grid grid-rows-subgrid overflow-hidden rounded-3xl sm:col-start-2"
        >
          {/* SVG คมทุกขนาด — รูปที่บันทึกวาดใหญ่ 3 เท่า QR ยังสแกนได้ · pt-8 เป็นพื้นว่างรอบ QR ที่เครื่องสแกนต้องการ */}
          <div className="flex flex-col items-center px-6 pb-4 pt-8">
            <QRCodeSVG value={ticket.ticketQr} size={200} level="H" marginSize={0} />
            <p className="mt-2 font-code text-body-2 font-medium tracking-widest">{ticket.code}</p>
          </div>

          {/* ต้นขั้ว — วงสีพื้นหน้าสองวงที่ขอบถูก overflow-hidden ของการ์ดตัดเหลือครึ่งวง จึงเห็นเป็นรอยเว้า */}
          <div className="relative px-10 py-2 sm:px-16">
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-page sm:size-12"
            />
            <span
              aria-hidden="true"
              className="absolute right-0 top-1/2 size-8 translate-x-1/2 -translate-y-1/2 rounded-full bg-page sm:size-12"
            />
            {/*
              คอลัมน์ที่นั่งกว้างเท่าป้ายที่นั่ง ชื่อโรง ("โรงที่ 3 (IMAX)") ได้ที่ที่เหลือทั้งหมด จะได้ไม่ขึ้นบรรทัดใหม่
              ชื่อโรงยาวได้จึงลดขนาดบนมือถือ ส่วนที่นั่งสั้นเสมอและสำคัญที่สุดตอนเข้าโรง จึงตัวใหญ่ทุกจอ
            */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-2xl border border-line-strong bg-surface-2 px-5 py-3">
              <div>
                <p className={LABEL}>{t('ticket.theatre')}</p>
                <p className="text-h2 font-bold sm:text-h1">{showtime.theatre.name}</p>
              </div>
              <div>
                <p className={LABEL}>{t('ticket.seat')}</p>
                <p className="text-h1 font-bold">{seat.label}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-4 px-6 pb-6 pt-4">
            {/* พื้นครีมรองไว้ — โหลดรูปไม่ได้ (หรือเว็บโปสเตอร์ไม่ให้ฝังลงรูปที่บันทึก) ยังเห็นเป็นกรอบโปสเตอร์ */}
            <img
              src={showtime.movie.posterUrl}
              alt=""
              className="h-36 w-24 shrink-0 rounded-lg bg-surface-2 object-cover sm:h-48 sm:w-32"
            />
            <div className="min-w-0 flex-1">
              <p className={LABEL}>{t('ticket.movie')}</p>
              <p title={movieTitle} className="line-clamp-2 text-body-1 font-bold sm:text-h2">
                {movieTitle}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-body-2">
                <div>
                  <dt className={LABEL}>{t('ticket.showDate')}</dt>
                  <dd className="font-semibold">{formatDate(showtime.startsAt, lang)}</dd>
                </div>
                <div>
                  <dt className={LABEL}>{t('ticket.showTime')}</dt>
                  <dd className="font-semibold">
                    {formatTime(showtime.startsAt, lang)}
                    {/* "น." ใช้กับเวลาภาษาไทยเท่านั้น */}
                    {lang === 'th' && ' น.'}
                  </dd>
                </div>
                {/* ยอดของทั้งการจอง ไม่ใช่ราคาที่นั่งใบนี้ — ตรงกับใบเสร็จและสลิปที่โอนมา */}
                <div>
                  <dt className={LABEL}>{t('ticket.amountPaid')}</dt>
                  <dd className="font-semibold">
                    {formatMoney(ticket.totalAmount, lang)} {t('common.baht')}
                  </dd>
                </div>
                <div>
                  <dt className={LABEL}>{t('payment.reference')}</dt>
                  <dd className="font-code font-semibold">{ticket.payment?.reference}</dd>
                </div>
              </dl>
            </div>
          </div>
        </article>

        {many && (
          <>
            <SeatArrow
              {...arrow('prev')}
              className="col-start-1 row-start-2 hidden self-center justify-self-end sm:flex"
            />
            <SeatArrow
              {...arrow('next')}
              className="col-start-3 row-start-2 hidden self-center justify-self-start sm:flex"
            />
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
