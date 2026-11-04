import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TicketX } from 'lucide-react';
import { apiError } from '../api/client.js';
import { cancelBooking, listMyBookings, updateRefundAccount } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EMPTY_REFUND_FORM, readRefundAccountForm, refundFormFromAccount } from '../utils/banks.js';
import { BOOKING_TABS, defaultBookingTab, groupBookingsByTab } from '../utils/bookingTabs.js';
import BookingCard from '../components/booking/BookingCard.jsx';
import RefundAccountFields from '../components/booking/RefundAccountFields.jsx';
import RefundSlipModal from '../components/booking/RefundSlipModal.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ConfirmModal from '../components/ui/ConfirmModal.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import Tabs from '../components/ui/Tabs.jsx';
import useApi from '../hooks/useApi.js';

/** ใบที่จ่ายเงินไปแล้วเท่านั้นที่ต้องบอกบัญชีรับเงินคืน ใบที่ยังไม่จ่ายไม่ต้องถาม */
const needsRefundAccount = (booking) => booking?.payment?.status === 'APPROVED';

const MyBookingsPage = () => {
  const { t } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
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

  // โหลดทุกใบครั้งเดียวแล้วแบ่งแท็บในเว็บ — bookings เป็น undefined จนกว่ารอบแรกจะเสร็จ
  const { data: bookings, loading, error, reload } = useApi(
    () => listMyBookings('all').then(({ data }) => data.bookings),
    [],
  );
  const groups = useMemo(() => groupBookingsByTab(bookings ?? []), [bookings]);

  // แท็บอยู่ใน URL (?tab=cancelled) — หน้าอื่นพามาที่แท็บของใบนั้นได้ตรง ๆ และรีเฟรชแล้วไม่เด้งกลับ
  // ไม่ได้ระบุ (กดเมนูด้านบน) → เลือกจากรายการที่โหลดมาแล้วจดลง URL
  // แท็บจะได้ไม่กระโดดเองตอนยกเลิกใบสุดท้ายของแท็บแล้วโหลดใหม่
  const tabParam = BOOKING_TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : null;
  const tab = tabParam ?? (bookings ? defaultBookingTab(groups) : null);
  const visible = tab ? groups[tab] : [];

  useEffect(() => {
    if (tab && !tabParam) setSearchParams({ tab }, { replace: true });
  }, [tab, tabParam, setSearchParams]);

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
    setAccountForm(
      refundFormFromAccount(payment?.refundBankName, payment?.refundAccountNo, payment?.refundAccountName),
    );
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
      reload();
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
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.myBookings'), to: '/my-bookings' },
          // ระหว่างโหลดรอบแรกยังไม่รู้แท็บ — "การจองของฉัน" เป็นชั้นสุดท้ายไปก่อน
          ...(tab ? [{ label: t(`bookings.tabs.${tab}`) }] : []),
        ]}
      />
      <h1 className="mb-5 text-h1 font-bold">{t('bookings.title')}</h1>

      {/* มือถือห้าแท็บไม่พอความกว้าง — เลื่อนแนวนอนแบบเดียวกับแถบเลือกวันในหน้าภาพยนตร์ */}
      <div className="-mx-4 mb-3 overflow-x-auto px-4 pb-2">
        <Tabs
          items={BOOKING_TABS.map((item) => ({ value: item, label: t(`bookings.tabs.${item}`) }))}
          value={tab}
          onChange={(next) => setSearchParams({ tab: next }, { replace: true })}
        />
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && tab && visible.length === 0 && (
        <EmptyState
          icon={TicketX}
          title={t(`bookings.tabEmpty.${tab}`)}
          action={
            <Button as={Link} to="/" size="sm" variant="secondary">
              {t('errors.goHome')}
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-4">
        {visible.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            onCancel={openCancel}
            onEditRefundAccount={openAccount}
            onViewRefundSlip={setSlipTarget}
          />
        ))}
      </div>

      <RefundSlipModal target={slipTarget} onClose={() => setSlipTarget(null)} />

      <ConfirmModal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('bookings.cancelTitle')}
        confirmLabel={t('bookings.cancel')}
        loading={cancelling}
        onConfirm={confirmCancel}
      >
        <p className="text-body-2 text-muted">{t('bookings.cancelBody', { code: cancelTarget?.code })}</p>

        {/* จ่ายเงินไปแล้วต้องบอกบัญชีปลายทาง เพราะระบบไม่ได้ตัดเงินเอง จึงคืนอัตโนมัติไม่ได้ */}
        {needsRefundAccount(cancelTarget) && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
            <p className="text-caption text-muted">{t('bookings.refundAccountIntro')}</p>
            <RefundAccountFields form={refundForm} onChange={setRefundForm} errors={formError} />
          </div>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(accountTarget)}
        onClose={() => setAccountTarget(null)}
        title={t('bookings.refundAccountTitle')}
        variant="primary"
        confirmLabel={t('common.save')}
        loading={savingAccount}
        onConfirm={saveAccount}
      >
        <div className="flex flex-col gap-3">
          <p className="text-body-2 text-muted">
            {t('bookings.refundAccountLater', { code: accountTarget?.code })}
          </p>
          <RefundAccountFields form={accountForm} onChange={setAccountForm} errors={accountErrors} />
        </div>
      </ConfirmModal>
    </div>
  );
};

export default MyBookingsPage;
