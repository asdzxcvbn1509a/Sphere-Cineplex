import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CreditCard, FileText, Landmark, ReceiptText, Ticket, Upload } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from '../ui/Button.jsx';
import Chip from '../ui/Chip.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { formatDate, formatDateTime, formatMoney, formatTime } from '../../utils/format.js';

/** ข้อความมุมขวาล่างของการ์ด — บอกว่าตอนนี้ยกเลิกได้ไหม และเพราะอะไร */
const cancelHint = (booking, t) => {
  if (booking.status === 'PENDING_VERIFICATION') return t('bookings.cancelAwaitingReview');
  if (booking.seatChange?.open?.status === 'PENDING_VERIFICATION') {
    return t('bookings.cancelAwaitingTopUp');
  }
  if (booking.status === 'PAID' && !booking.canCancel) {
    return t('bookings.cancelBlocked', { hours: booking.cancelCutoffHours });
  }
  return t('bookings.cancelPolicy', { hours: booking.cancelCutoffHours });
};

/**
 * บอกว่ายังเปลี่ยนที่นั่งได้อีกกี่ครั้ง หรือทำไมเปลี่ยนไม่ได้แล้ว — เฉพาะใบที่จ่ายแล้ว ยังไม่ถึงรอบ และไม่มีคำขอค้าง
 * (คำขอที่ค้างอยู่มีป้าย/ปุ่มของตัวเองในแถบด้านล่างแล้ว)
 */
const seatChangeHint = (booking, t) => {
  const info = booking.seatChange;
  if (!info || booking.status !== 'PAID' || info.open) return null;
  if (new Date(booking.showtime.startsAt) <= new Date()) return null;
  if (info.canChange) {
    return t('seatChange.policy', { left: info.changesLeft, minutes: info.cutoffMinutes });
  }
  if (info.blockedReason === 'LIMIT') return t('seatChange.blockedLIMIT', { max: info.maxChanges });
  if (info.blockedReason === 'WINDOW_CLOSED') {
    return t('seatChange.blockedWINDOW_CLOSED', { minutes: info.cutoffMinutes });
  }
  return null;
};

/**
 * การ์ดหนึ่งการจองในหน้าการจองของฉัน — รายละเอียดด้านบน แถบปุ่มและสถานะเงินด้านล่าง
 * การกระทำทั้งหมด (ยกเลิก แจ้งบัญชี ดูสลิปคืนเงิน) ส่งกลับไปให้หน้าเปิดหน้าต่างเอง
 * onEditRefundAccount(booking, payment) — payment = รายการที่กดแจ้งบัญชี (ใบหลัก หรือส่วนต่างเปลี่ยนที่นั่ง)
 * onViewRefundSlip({ bookingId, payment, paymentId }) — paymentId ใส่เฉพาะสลิปคืนส่วนต่างเปลี่ยนที่นั่ง
 */
const BookingCard = ({ booking, onCancel, onEditRefundAccount, onViewRefundSlip }) => {
  const { t, lang, pick } = useI18n();
  const seatChangeNote = seatChangeHint(booking, t);

  return (
    <article className="card overflow-hidden">
      {/* มือถือ: ยอดรวมอยู่ใต้รายละเอียดข้างโปสเตอร์ ไม่เป็นคอลัมน์ขวาที่บีบชื่อเรื่องจนเหลือไม่กี่ตัวอักษร */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:p-6">
        <img
          src={booking.showtime.movie.posterUrl}
          alt=""
          className="row-span-2 h-28 w-19 rounded-lg object-cover sm:h-45 sm:w-30"
        />

        <div className="min-w-0">
          {/* มือถือป้ายสถานะขึ้นบรรทัดของตัวเองเหนือชื่อเรื่อง */}
          <div className="flex flex-col-reverse items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
            <h2 className="min-w-0 max-w-full truncate font-semibold sm:text-lg">
              {pick(booking.showtime.movie, 'title')}
            </h2>
            <StatusBadge status={booking.status} label={t(`bookings.status${booking.status}`)} />
          </div>

          <p className="mt-1 text-sm text-muted sm:text-base">
            {booking.showtime.theatre.name} · {formatDate(booking.showtime.startsAt, lang)}{' '}
            {formatTime(booking.showtime.startsAt, lang)}
          </p>
          <p className="mt-1 text-sm sm:text-base">
            <span className="text-muted">{t('ticket.seats')}: </span>
            <span className="font-medium">{booking.seats.map((seat) => seat.label).join(', ')}</span>
          </p>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            {t('bookings.bookedAt')} {formatDateTime(booking.createdAt, lang)} ·{' '}
            <span className="font-mono">{booking.code}</span>
          </p>
        </div>

        <div className="flex items-baseline gap-2 self-end sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:block sm:self-start sm:text-right">
          <p className="text-xs text-muted sm:text-sm">{t('bookings.total')}</p>
          <p className="font-bold text-accent sm:text-xl">{formatMoney(booking.totalAmount, lang)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-4 py-3 sm:px-6">
        {booking.status === 'PAID' && (
          <Button as={Link} to={`/booking/${booking.id}/ticket`} size="sm">
            <Ticket size={14} /> {t('bookings.viewTicket')}
          </Button>
        )}
        {/* ใบเสร็จยังเปิดได้หลังยกเลิก/คืนเงิน เพราะเป็นหลักฐานว่าเคยจ่ายเงินจริง */}
        {booking.payment?.receiptNo && (
          <Button as={Link} to={`/booking/${booking.id}/receipt`} size="sm" variant="secondary">
            <FileText size={14} /> {t('bookings.viewReceipt')}
          </Button>
        )}
        {(booking.status === 'PENDING_PAYMENT' || booking.status === 'PENDING_VERIFICATION') && (
          <Button as={Link} to={`/booking/${booking.id}/payment`} size="sm">
            <CreditCard size={14} /> {t('bookings.payNow')}
          </Button>
        )}
        {/* หมดเวลาไปไม่นาน — คนที่โอนแล้วแต่ส่งสลิปไม่ทันยังส่งได้ ไม่ต้องรู้เองว่าต้องกลับไปหน้าไหน */}
        {booking.status === 'EXPIRED' && booking.canUploadSlip && (
          <Button as={Link} to={`/booking/${booking.id}/payment`} size="sm" variant="secondary">
            <Upload size={14} /> {t('bookings.lateSlipAction')}
          </Button>
        )}
        {booking.status === 'EXPIRED' && booking.payment?.status === 'PENDING_VERIFICATION' && (
          <Chip tone="info">{t('bookings.lateSlipWaiting')}</Chip>
        )}
        {booking.seatChange?.canChange && (
          <Button as={Link} to={`/booking/${booking.id}/change-seats`} size="sm" variant="secondary">
            <ArrowLeftRight size={14} /> {t('seatChange.action')}
          </Button>
        )}
        {/* คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง — พากลับไปหน้าชำระได้ตรง ๆ ไม่ต้องจำว่าค้างอยู่ตรงไหน */}
        {booking.seatChange?.open?.status === 'PENDING_PAYMENT' && (
          <Button as={Link} to={`/booking/${booking.id}/seat-change/${booking.seatChange.open.id}`} size="sm">
            <CreditCard size={14} />{' '}
            {t('seatChange.payDifference', {
              amount: formatMoney(booking.seatChange.open.diffAmount, lang),
            })}
          </Button>
        )}
        {booking.seatChange?.open?.status === 'PENDING_VERIFICATION' && (
          <Chip tone="info">{t('seatChange.pendingReview')}</Chip>
        )}
        {booking.canCancel && (
          <Button variant="danger" size="sm" onClick={() => onCancel(booking)}>
            {t('bookings.cancel')}
          </Button>
        )}

        {/* ยกเลิกหลังจ่ายเงินแล้วต้องรอผู้ดูแลโอนคืน จึงต้องบอกสถานะให้ผู้ใช้เห็น */}
        {booking.payment?.status === 'REFUND_PENDING' && (
          <Chip tone="accent">{t('bookings.refundPending')}</Chip>
        )}
        {booking.payment?.refundAccountNo && (
          <span className="text-xs text-muted sm:text-sm">
            {t('bookings.refundTo', {
              bank: booking.payment.refundBankName,
              account: booking.payment.refundAccountNo,
            })}
          </span>
        )}
        {booking.payment?.status === 'REFUND_PENDING' && !booking.payment.refundAccountNo && (
          <span className="text-xs text-danger sm:text-sm">{t('bookings.refundAccountMissing')}</span>
        )}
        {/* แก้บัญชีได้ตลอดที่ยังรอโอนคืน — พิมพ์เลขผิดไว้ตอนยกเลิกก็แก้เองได้ ไม่ต้องโทรหาผู้ดูแล */}
        {booking.payment?.status === 'REFUND_PENDING' && (
          <Button variant="secondary" size="sm" onClick={() => onEditRefundAccount(booking, booking.payment)}>
            <Landmark size={14} />{' '}
            {booking.payment.refundAccountNo
              ? t('bookings.refundAccountEdit')
              : t('bookings.refundAccountAdd')}
          </Button>
        )}
        {booking.payment?.status === 'REFUNDED' && (
          <Chip tone="success">
            {t('bookings.refunded', { at: formatDateTime(booking.payment.refundedAt, lang) })}
          </Chip>
        )}
        {/* หลักฐานการโอนคืนเป็นเรื่องเงินของลูกค้าเอง จึงให้เปิดดูได้เหมือนที่ผู้ดูแลเห็น */}
        {booking.payment?.hasRefundSlip && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onViewRefundSlip({ bookingId: booking.id, payment: booking.payment })}
          >
            <ReceiptText size={14} /> {t('bookings.viewRefundSlip')}
          </Button>
        )}

        {/* เงินจากการเปลี่ยนที่นั่ง — ใบเสร็จส่วนต่างที่โอนเพิ่ม หรือส่วนต่างที่รอ/โอนคืนแล้ว */}
        {(booking.seatChange?.history ?? []).map((change) => {
          const money = change.payment;
          if (!money) return null;
          if (money.receiptNo) {
            return (
              <Button
                key={change.id}
                as={Link}
                to={`/booking/${booking.id}/receipt?payment=${money.id}`}
                size="sm"
                variant="secondary"
              >
                <FileText size={14} /> {t('seatChange.viewReceipt')}
              </Button>
            );
          }
          if (money.status !== 'REFUND_PENDING' && money.status !== 'REFUNDED') return null;
          const refundAmount = formatMoney(money.refundAmount ?? money.amount, lang);
          return (
            <Fragment key={change.id}>
              <Chip tone={money.status === 'REFUNDED' ? 'success' : 'accent'}>
                {t(money.status === 'REFUNDED' ? 'seatChange.refundChipDone' : 'seatChange.refundChipPending', {
                  amount: refundAmount,
                })}
              </Chip>
              {/* บัญชีใช้ร่วมกันทุกรายการที่รอคืนของการจองนี้ — ถ้าใบหลักก็รอคืนอยู่ ปุ่มของใบหลักด้านบนพอแล้ว */}
              {money.status === 'REFUND_PENDING' && booking.payment?.status !== 'REFUND_PENDING' && (
                <Button variant="secondary" size="sm" onClick={() => onEditRefundAccount(booking, money)}>
                  <Landmark size={14} />{' '}
                  {money.refundAccountNo ? t('bookings.refundAccountEdit') : t('bookings.refundAccountAdd')}
                </Button>
              )}
              {money.hasRefundSlip && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onViewRefundSlip({ bookingId: booking.id, payment: money, paymentId: money.id })}
                >
                  <ReceiptText size={14} /> {t('bookings.viewRefundSlip')}
                </Button>
              )}
            </Fragment>
          );
        })}

        {/* มือถือขึ้นบรรทัดใหม่ชิดซ้ายเต็มความกว้าง อ่านต่อจากปุ่มได้ง่ายกว่าตัวหนังสือชิดขวา */}
        <span className="flex w-full flex-col text-xs text-muted sm:ml-auto sm:w-auto sm:items-end sm:text-right sm:text-sm">
          <span>{cancelHint(booking, t)}</span>
          {seatChangeNote && <span>{seatChangeNote}</span>}
        </span>
      </div>
    </article>
  );
};

export default BookingCard;
