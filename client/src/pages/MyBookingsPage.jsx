import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  CreditCard,
  FileText,
  Landmark,
  ReceiptText,
  Ticket,
  TicketX,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../api/client.js';
import { cancelBooking, listMyBookings, updateRefundAccount } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EMPTY_REFUND_FORM, readRefundAccountForm, refundFormFromAccount } from '../utils/banks.js';
import RefundAccountFields from '../components/booking/RefundAccountFields.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import SlipImage from '../components/ui/SlipImage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { formatDate, formatDateTime, formatMoney, formatTime } from '../utils/format.js';

const TABS = ['upcoming', 'history'];

/** ใบที่จ่ายเงินไปแล้วเท่านั้นที่ต้องบอกบัญชีรับเงินคืน ใบที่ยังไม่จ่ายไม่ต้องถาม */
const needsRefundAccount = (booking) => booking?.payment?.status === 'APPROVED';

const MyBookingsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [scope, setScope] = useState('upcoming');
  const [bookings, setBookings] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [refundForm, setRefundForm] = useState(EMPTY_REFUND_FORM);
  const [formError, setFormError] = useState({});
  // { bookingId, payment, paymentId } — paymentId ใส่เฉพาะสลิปคืนส่วนต่างเปลี่ยนที่นั่ง (ไม่ใส่ = ใบหลักของการจอง)
  const [slipTarget, setSlipTarget] = useState(null);
  // แจ้ง/แก้บัญชีรับเงินคืนภายหลัง — ใบที่ผู้ดูแลยกเลิกแทนไม่มีบัญชีติดมา
  const [accountTarget, setAccountTarget] = useState(null);
  const [accountForm, setAccountForm] = useState(EMPTY_REFUND_FORM);
  const [accountErrors, setAccountErrors] = useState({});
  const [savingAccount, setSavingAccount] = useState(false);

  const load = useCallback(() => {
    setState({ loading: true, error: null });
    listMyBookings(scope)
      .then(({ data }) => {
        setBookings(data.bookings);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [scope]);

  useEffect(load, [load]);

  /** ข้อความมุมขวาล่างของการ์ด — บอกว่าตอนนี้ยกเลิกได้ไหม และเพราะอะไร */
  const cancelHint = (booking) => {
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
  const seatChangeHint = (booking) => {
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

  const openCancel = (booking) => {
    setRefundForm(EMPTY_REFUND_FORM);
    setFormError({});
    setCancelTarget(booking);
  };

  /** คืนบัญชีที่กรอกไว้ถ้าครบ — ถ้าไม่ครบจะโชว์ error ใต้ช่องแล้วคืน null */
  const readRefundAccount = () => {
    if (!needsRefundAccount(cancelTarget)) return {};
    const { value, errors } = readRefundAccountForm(refundForm, t);
    setFormError(errors);
    return value;
  };

  /**
   * payment = รายการที่ลูกค้ากดแจ้งบัญชี (ใบหลัก หรือส่วนต่างเปลี่ยนที่นั่ง) ใช้เติมค่าเดิมในฟอร์ม
   * บันทึกแล้ว server ใช้บัญชีนี้กับทุกรายการที่รอโอนคืนของการจองนี้
   */
  const openAccount = (booking, payment = booking.payment) => {
    setAccountForm(refundFormFromAccount(payment?.refundBankName, payment?.refundAccountNo));
    setAccountErrors({});
    setAccountTarget(booking);
  };

  const saveAccount = async () => {
    const { value, errors } = readRefundAccountForm(accountForm, t);
    setAccountErrors(errors);
    if (!value) return;

    setSavingAccount(true);
    try {
      await updateRefundAccount(accountTarget.id, value);
      toast.success(t('bookings.refundAccountSaved'));
      setAccountTarget(null);
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setSavingAccount(false);
    }
  };

  const confirmCancel = async () => {
    const refundAccount = readRefundAccount();
    if (!refundAccount) return;

    setCancelling(true);
    try {
      await cancelBooking(cancelTarget.id, refundAccount);
      toast.success(t('bookings.statusCANCELLED'));
      setCancelTarget(null);
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-5 text-2xl font-bold sm:text-3xl">{t('bookings.title')}</h1>

      <div className="mb-5 inline-flex rounded-xl border border-line bg-surface p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setScope(tab)}
            className={clsx(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              scope === tab ? 'bg-accent text-ink' : 'text-muted hover:text-fg',
            )}
          >
            {t(`bookings.${tab}`)}
          </button>
        ))}
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && bookings.length === 0 && (
        <EmptyState
          icon={TicketX}
          title={t('bookings.empty')}
          action={
            <Button as={Link} to="/" size="sm" variant="secondary">
              {t('errors.goHome')}
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-4">
        {bookings.map((booking) => (
          <article key={booking.id} className="card overflow-hidden">
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
                  <StatusBadge
                    status={booking.status}
                    label={t(`bookings.status${booking.status}`)}
                  />
                </div>

                <p className="mt-1 text-sm text-muted sm:text-base">
                  {booking.showtime.theatre.name} · {formatDate(booking.showtime.startsAt, lang)}{' '}
                  {formatTime(booking.showtime.startsAt, lang)}
                </p>
                <p className="mt-1 text-sm sm:text-base">
                  <span className="text-muted">{t('ticket.seats')}: </span>
                  <span className="font-medium">
                    {booking.seats.map((seat) => seat.label).join(', ')}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted sm:text-sm">
                  {t('bookings.bookedAt')} {formatDateTime(booking.createdAt, lang)} ·{' '}
                  <span className="font-mono">{booking.code}</span>
                </p>
              </div>

              <div className="flex items-baseline gap-2 self-end sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:block sm:self-start sm:text-right">
                <p className="text-xs text-muted sm:text-sm">{t('bookings.total')}</p>
                <p className="font-bold text-accent sm:text-xl">
                  {formatMoney(booking.totalAmount, lang)}
                </p>
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
                <span className="rounded-md border border-info/40 bg-info/10 px-2.5 py-1.5 text-xs text-info sm:text-sm">
                  {t('bookings.lateSlipWaiting')}
                </span>
              )}
              {booking.seatChange?.canChange && (
                <Button as={Link} to={`/booking/${booking.id}/change-seats`} size="sm" variant="secondary">
                  <ArrowLeftRight size={14} /> {t('seatChange.action')}
                </Button>
              )}
              {/* คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง — พากลับไปหน้าชำระได้ตรง ๆ ไม่ต้องจำว่าค้างอยู่ตรงไหน */}
              {booking.seatChange?.open?.status === 'PENDING_PAYMENT' && (
                <Button
                  as={Link}
                  to={`/booking/${booking.id}/seat-change/${booking.seatChange.open.id}`}
                  size="sm"
                >
                  <CreditCard size={14} />{' '}
                  {t('seatChange.payDifference', {
                    amount: formatMoney(booking.seatChange.open.diffAmount, lang),
                  })}
                </Button>
              )}
              {booking.seatChange?.open?.status === 'PENDING_VERIFICATION' && (
                <span className="rounded-md border border-info/40 bg-info/10 px-2.5 py-1.5 text-xs text-info sm:text-sm">
                  {t('seatChange.pendingReview')}
                </span>
              )}
              {booking.canCancel && (
                <Button variant="danger" size="sm" onClick={() => openCancel(booking)}>
                  {t('bookings.cancel')}
                </Button>
              )}

              {/* ยกเลิกหลังจ่ายเงินแล้วต้องรอผู้ดูแลโอนคืน จึงต้องบอกสถานะให้ผู้ใช้เห็น */}
              {booking.payment?.status === 'REFUND_PENDING' && (
                <span className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs text-accent sm:text-sm">
                  {t('bookings.refundPending')}
                </span>
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
                <span className="text-xs text-danger sm:text-sm">
                  {t('bookings.refundAccountMissing')}
                </span>
              )}
              {/* แก้บัญชีได้ตลอดที่ยังรอโอนคืน — พิมพ์เลขผิดไว้ตอนยกเลิกก็แก้เองได้ ไม่ต้องโทรหาผู้ดูแล */}
              {booking.payment?.status === 'REFUND_PENDING' && (
                <Button variant="secondary" size="sm" onClick={() => openAccount(booking)}>
                  <Landmark size={14} />{' '}
                  {booking.payment.refundAccountNo
                    ? t('bookings.refundAccountEdit')
                    : t('bookings.refundAccountAdd')}
                </Button>
              )}
              {booking.payment?.status === 'REFUNDED' && (
                <span className="rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs text-success sm:text-sm">
                  {t('bookings.refunded', {
                    at: formatDateTime(booking.payment.refundedAt, lang),
                  })}
                </span>
              )}
              {/* หลักฐานการโอนคืนเป็นเรื่องเงินของลูกค้าเอง จึงให้เปิดดูได้เหมือนที่ผู้ดูแลเห็น */}
              {booking.payment?.hasRefundSlip && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSlipTarget({ bookingId: booking.id, payment: booking.payment })}
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
                    <span
                      className={clsx(
                        'rounded-md border px-2.5 py-1.5 text-xs sm:text-sm',
                        money.status === 'REFUNDED'
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-accent/40 bg-accent/10 text-accent',
                      )}
                    >
                      {t(
                        money.status === 'REFUNDED'
                          ? 'seatChange.refundChipDone'
                          : 'seatChange.refundChipPending',
                        { amount: refundAmount },
                      )}
                    </span>
                    {/* บัญชีใช้ร่วมกันทุกรายการที่รอคืนของการจองนี้ — ถ้าใบหลักก็รอคืนอยู่ ปุ่มของใบหลักด้านบนพอแล้ว */}
                    {money.status === 'REFUND_PENDING' && booking.payment?.status !== 'REFUND_PENDING' && (
                      <Button variant="secondary" size="sm" onClick={() => openAccount(booking, money)}>
                        <Landmark size={14} />{' '}
                        {money.refundAccountNo
                          ? t('bookings.refundAccountEdit')
                          : t('bookings.refundAccountAdd')}
                      </Button>
                    )}
                    {money.hasRefundSlip && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setSlipTarget({ bookingId: booking.id, payment: money, paymentId: money.id })
                        }
                      >
                        <ReceiptText size={14} /> {t('bookings.viewRefundSlip')}
                      </Button>
                    )}
                  </Fragment>
                );
              })}

              {/* มือถือขึ้นบรรทัดใหม่ชิดซ้ายเต็มความกว้าง อ่านต่อจากปุ่มได้ง่ายกว่าตัวหนังสือชิดขวา */}
              <span className="flex w-full flex-col text-xs text-muted sm:ml-auto sm:w-auto sm:items-end sm:text-right sm:text-sm">
                <span>{cancelHint(booking)}</span>
                {seatChangeHint(booking) && <span>{seatChangeHint(booking)}</span>}
              </span>
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={Boolean(slipTarget)}
        onClose={() => setSlipTarget(null)}
        title={t('bookings.refundSlipTitle')}
        size="sm"
      >
        <SlipImage
          bookingId={slipTarget?.bookingId}
          paymentId={slipTarget?.paymentId}
          kind="refund"
          className="h-80 w-full"
        />
        {slipTarget?.payment?.refundNote && (
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
            {slipTarget.payment.refundNote}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          {t('bookings.refundedAt', {
            at: formatDateTime(slipTarget?.payment?.refundedAt, lang),
          })}
        </p>
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('bookings.cancelTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={cancelling} onClick={confirmCancel}>
              {t('bookings.cancel')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('bookings.cancelBody', { code: cancelTarget?.code })}</p>

        {/* จ่ายเงินไปแล้วต้องบอกบัญชีปลายทาง เพราะระบบไม่ได้ตัดเงินเอง จึงคืนอัตโนมัติไม่ได้ */}
        {needsRefundAccount(cancelTarget) && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
            <p className="text-xs text-muted">{t('bookings.refundAccountIntro')}</p>
            <RefundAccountFields form={refundForm} onChange={setRefundForm} errors={formError} />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(accountTarget)}
        onClose={() => setAccountTarget(null)}
        title={t('bookings.refundAccountTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccountTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={savingAccount} onClick={saveAccount}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {t('bookings.refundAccountLater', { code: accountTarget?.code })}
          </p>
          <RefundAccountFields form={accountForm} onChange={setAccountForm} errors={accountErrors} />
        </div>
      </Modal>
    </div>
  );
};

export default MyBookingsPage;
