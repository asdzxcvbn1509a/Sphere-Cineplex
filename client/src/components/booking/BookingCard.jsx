import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Landmark } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from '../ui/Button.jsx';
import Chip from '../ui/Chip.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { formatBaht, formatDate, formatDateTime, formatMoney, formatTime } from '../../utils/format.js';

/**
 * ข้อความมุมขวาล่างของการ์ด — บอกว่าตอนนี้ยกเลิกได้ไหม และเพราะอะไร
 * ใบที่ปิดไปแล้วหรือถึงรอบฉายแล้วไม่ต้องบอก (แท็บยกเลิก/ประวัติจะขึ้น "ยกเลิกฟรีได้…" ทั้งที่ไม่จริง)
 */
const cancelHint = (booking, t) => {
  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') return null;
  if (new Date(booking.showtime.startsAt) <= new Date()) return null;
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
 * (คำขอที่ค้างอยู่มีป้ายสถานะด้านบนและปุ่มของตัวเองในแถบด้านล่างแล้ว)
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
 * ป้ายสถานะของการ์ด — คำขอเปลี่ยนที่นั่งที่ค้างอยู่สำคัญกว่า "ชำระเงินแล้ว" ของใบหลัก
 * การ์ดไปอยู่แท็บที่ต้องชำระ/รอดำเนินการก็เพราะคำขอนั้น ป้ายจึงต้องบอกเรื่องเดียวกัน (โทนสีตามสถานะของคำขอ)
 */
const statusBadge = (booking, t) => {
  const open = booking.seatChange?.open;
  if (open?.status === 'PENDING_PAYMENT') {
    return { status: 'PENDING_PAYMENT', label: t('seatChange.awaitingPayment') };
  }
  if (open?.status === 'PENDING_VERIFICATION') {
    return { status: 'PENDING_VERIFICATION', label: t('seatChange.pendingReview') };
  }
  return { status: booking.status, label: t(`bookings.status${booking.status}`) };
};

/**
 * ป้ายทั้งหมดของการ์ด — ใบที่ยกเลิกแสดงป้ายแดง "ยกเลิกสำเร็จ"
 * และถ้าโอนเงินคืนครบแล้ว มีป้ายเขียว "คืนเงินสำเร็จ" นำหน้า ลูกค้าเห็นทั้งสองเรื่องในแวบเดียว
 */
const statusBadges = (booking, t) => {
  if (booking.status !== 'CANCELLED') return [statusBadge(booking, t)];
  const cancelled = { status: 'CANCELLED', tone: 'danger', label: t('bookings.cancelledDone') };
  if (booking.payment?.status !== 'REFUNDED') return [cancelled];
  return [{ status: 'REFUNDED', label: t('admin.bookingPage.status.REFUNDED') }, cancelled];
};

/** หนึ่งบรรทัดของรายละเอียดการจอง — "หัวข้อ: ค่า" */
const Detail = ({ label, children }) => {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0">{label} :</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
};

/**
 * การ์ดหนึ่งการจองในหน้าการจองของฉัน — รายละเอียดด้านบน แถบปุ่มและสถานะเงินด้านล่าง
 * การกระทำทั้งหมด (ยกเลิก แจ้งบัญชี ดูสลิปคืนเงิน) ส่งกลับไปให้หน้าเปิดหน้าต่างเอง
 * onEditRefundAccount(booking, payment) — payment = รายการที่กดแจ้งบัญชี (ใบหลัก หรือส่วนต่างเปลี่ยนที่นั่ง)
 * onViewRefundSlip({ bookingId, payment, paymentId }) — paymentId ใส่เฉพาะสลิปคืนส่วนต่างเปลี่ยนที่นั่ง
 */
const BookingCard = ({ booking, onCancel, onEditRefundAccount, onViewRefundSlip }) => {
  const { t, lang, pick, theatreName } = useI18n();
  const { startsAt } = booking.showtime;
  const badges = statusBadges(booking, t);
  const cancelNote = cancelHint(booking, t);
  const seatChangeNote = seatChangeHint(booking, t);

  return (
    // การ์ดพื้นเข้มขอบทอง ตัวอักษรอ่อนทั้งใบ — แถบปุ่มด้านล่างแยกด้วยพื้นน้ำตาล
    <article className="overflow-hidden rounded-xl border border-gold-40 bg-cocoa-100">
      {/* มือถือ: ยอดรวมอยู่ใต้รายละเอียดข้างโปสเตอร์ ไม่เป็นคอลัมน์ขวาที่บีบชื่อเรื่องจนเหลือไม่กี่ตัวอักษร */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:p-6">
        <img
          src={booking.showtime.movie.posterUrl}
          alt=""
          className="row-span-2 h-28 w-19 rounded-lg object-cover sm:h-45 sm:w-30"
        />

        <div className="min-w-0">
          <h2 className="truncate text-h2 font-medium">{pick(booking.showtime.movie, 'title')}</h2>

          {/* โรง วัน เวลาของรอบเป็นชิปขอบทองพื้นโปร่ง — เห็นก่อนรายละเอียดการจองด้านล่าง */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[theatreName(booking.showtime.theatre.name), formatDate(startsAt, lang), formatTime(startsAt, lang)].map(
              (text, index) => (
                <span key={index} className="rounded-md border border-accent px-1.5 py-0.5 text-body-1 text-accent">
                  {text}
                </span>
              ),
            )}
          </div>

          <dl className="mt-2 flex flex-col gap-0.5 text-body-1">
            <Detail label={t('ticket.seats')}>
              <span className="font-medium">{booking.seats.map((seat) => seat.label).join(', ')}</span>
            </Detail>
            <Detail label={t('bookings.bookedAt')}>{formatDate(booking.createdAt, lang)}</Detail>
            <Detail label={t('bookings.bookedTime')}>{formatTime(booking.createdAt, lang)}</Detail>
            <Detail label={t('payment.bookingCode')}>
              <span className="font-code">{booking.code}</span>
            </Detail>
          </dl>
        </div>

        {/* ป้ายสถานะวางข้างยอดรวมมุมขวาบน — มองมุมเดียวรู้ทั้งสถานะและยอดเงิน */}
        <div className="flex items-start gap-3 self-end sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:self-start">
          <div className="flex flex-wrap justify-end gap-1.5">
            {badges.map((badge) => (
              <StatusBadge key={badge.status} status={badge.status} tone={badge.tone} label={badge.label} />
            ))}
          </div>
          <div className="sm:text-right">
            <p className="text-body-1">{t('bookings.total')}</p>
            <p className="text-body-1 font-semibold">{formatBaht(booking.totalAmount, lang)}</p>
          </div>
        </div>
      </div>

      {/* ใบที่ปิดไปแล้วและไม่มีอะไรให้กด/บอก (เช่น หมดเวลาโดยยังไม่จ่าย) ซ่อนแถบไปเลย ไม่ปล่อยแถบเทาว่าง */}
      {/* แถบปุ่มพื้นน้ำตาลขอบทอง ตัวอักษรครีม — ข้อความ text-muted ในแถบถูกยกเป็นครีมให้อ่านออกบนพื้นนี้ */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gold-40 bg-cream-80 px-4 py-3 text-cream-20 empty:hidden sm:px-6 [&_.text-muted]:text-cream-20">
        {booking.status === 'PAID' && (
          <Button as={Link} to={`/booking/${booking.id}/ticket`} variant="cream" size="sm">
            {t('bookings.viewTicket')}
          </Button>
        )}
        {/* ใบเสร็จยังเปิดได้หลังยกเลิก/คืนเงิน เพราะเป็นหลักฐานว่าเคยจ่ายเงินจริง */}
        {booking.payment?.receiptNo && (
          <Button as={Link} to={`/booking/${booking.id}/receipt`} size="sm" variant="cream">
            {t('bookings.viewReceipt')}
          </Button>
        )}
        {/* ส่งสลิปแล้ว ไม่ต้องกดชำระซ้ำ — บอกแค่ว่ากำลังดำเนินการ */}
        {booking.status === 'PENDING_VERIFICATION' && (
          <span className="text-caption sm:text-body-2">{t('bookings.inProgress')}</span>
        )}
        {booking.status === 'PENDING_PAYMENT' && (
          <Button as={Link} to={`/booking/${booking.id}/payment`} size="sm">
            <CreditCard size={14} /> {t('bookings.payNow')}
          </Button>
        )}
        {booking.seatChange?.canChange && (
          <Button as={Link} to={`/booking/${booking.id}/change-seats`} size="sm" variant="cream">
            {t('seatChange.action')}
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
        {booking.canCancel && (
          <Button variant="dangerSolid" size="sm" onClick={() => onCancel(booking)}>
            {t('common.cancel')}
          </Button>
        )}

        {/* ยกเลิกหลังจ่ายเงินแล้วต้องรอผู้ดูแลโอนคืน จึงต้องบอกสถานะให้ผู้ใช้เห็น */}
        {booking.payment?.status === 'REFUND_PENDING' && (
          <Chip tone="warning">{t('bookings.refundPending')}</Chip>
        )}
        {booking.payment?.refundAccountNo && (
          <span className="text-caption text-muted sm:text-body-2">
            {/* บัญชีที่แจ้งไว้ก่อนมีช่องชื่อบัญชีไม่มีชื่อติดมา — ใช้ข้อความแบบเดิม ไม่โชว์วงเล็บว่าง */}
            {t(booking.payment.refundAccountName ? 'bookings.refundToNamed' : 'bookings.refundTo', {
              bank: booking.payment.refundBankName,
              account: booking.payment.refundAccountNo,
              name: booking.payment.refundAccountName,
            })}
          </span>
        )}
        {booking.payment?.status === 'REFUND_PENDING' && !booking.payment.refundAccountNo && (
          <span className="text-caption text-danger sm:text-body-2">{t('bookings.refundAccountMissing')}</span>
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
            variant="cream"
            size="sm"
            onClick={() => onViewRefundSlip({ bookingId: booking.id, payment: booking.payment })}
          >
            {t('bookings.viewRefundSlip')}
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
                variant="cream"
              >
                {t('seatChange.viewReceipt')}
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
                  variant="cream"
                  size="sm"
                  onClick={() => onViewRefundSlip({ bookingId: booking.id, payment: money, paymentId: money.id })}
                >
                  {t('bookings.viewRefundSlip')}
                </Button>
              )}
            </Fragment>
          );
        })}

        {/* มือถือขึ้นบรรทัดใหม่ชิดซ้ายเต็มความกว้าง อ่านต่อจากปุ่มได้ง่ายกว่าตัวหนังสือชิดขวา */}
        {(cancelNote || seatChangeNote) && (
          <span className="flex w-full flex-col text-caption text-muted sm:ml-auto sm:w-auto sm:items-end sm:text-right sm:text-body-2">
            {cancelNote && <span>{cancelNote}</span>}
            {seatChangeNote && <span>{seatChangeNote}</span>}
          </span>
        )}
      </div>
    </article>
  );
};

export default BookingCard;
