import { useState } from 'react';
import { CircleCheck, CircleX, Inbox, RefreshCw, ScanSearch } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { approvePayment, listPayments, rejectPayment } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Chip from '../../components/ui/Chip.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import SlipImage from '../../components/ui/SlipImage.jsx';
import QueueList from '../../components/admin/QueueList.jsx';
import {
  DETAIL_BODY,
  DETAIL_FOOTER,
  DETAIL_LIST,
  DETAIL_PANEL,
  QUEUE_GRID,
  QUEUE_PAGE,
  SLIP_PANEL,
} from '../../components/admin/queueLayout.js';
import { usePagedApi } from '../../hooks/useApi.js';
import usePolling from '../../hooks/usePolling.js';
import useQueueSelection from '../../hooks/useQueueSelection.js';
import { formatBaht, formatDate, formatDateTime, formatTime } from '../../utils/format.js';

/** สลิปส่วนต่างเปลี่ยนที่นั่ง — อนุมัติแล้วย้ายที่นั่งจริงและออกใบเสร็จส่วนต่าง */
const isTopUp = (payment) => payment.kind === 'SEAT_CHANGE_TOPUP';

/**
 * สลิปที่ส่งหลังหมดเวลาแล้วและเอาที่นั่งคืนไม่ได้ — อนุมัติ = เข้าคิวคืนเงิน
 * ค่าตั๋ว: การจองยังเป็น EXPIRED · ส่วนต่างเปลี่ยนที่นั่ง: คำขอยังเป็น EXPIRED (การจองเป็น PAID ตามเดิม)
 */
const isLateSlip = (payment) => {
  return isTopUp(payment)
    ? payment.seatChange?.status === 'EXPIRED'
    : payment.booking.status === 'EXPIRED';
};

/** แถวในแผงรายการ — เวลาท้ายแถวคือสลิปรอมานานเท่าไหร่ */
const rowOf = (payment) => ({
  code: payment.booking.code,
  at: payment.slipUploadedAt,
  name: payment.booking.user.name,
  amount: payment.amount,
});

const AdminPaymentsPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('oldest');
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reason, setReason] = useState('');

  const refreshCounts = useAdminQueueStore((state) => state.refresh);

  // ตรวจใบสุดท้ายของหน้าหมดแล้ว usePagedApi พาไปหน้าสุดท้ายที่ยังมีคิวเหลืออยู่เอง
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listPayments('PENDING_VERIFICATION', { page, sort });
      // ป้ายบนเมนูต้องลดลงทันทีที่อนุมัติ/ปฏิเสธ ไม่ต้องรอผู้ดูแลรีเฟรชหน้าเอง
      refreshCounts();
      return { items: body.payments, total: body.total, pageSize: body.pageSize };
    },
    { page, setPage },
    [page, sort, refreshCounts],
  );
  const payments = data?.items ?? [];

  // ใบที่เลือก (ตกไปใบแรกเองเมื่อใบเดิมหายจากคิว) และการไปใบถัดไปหลังตรวจเสร็จ
  const { selected, select, moveOnFrom, panelRef } = useQueueSelection(payments);

  // โหลดครั้งแรก หรือกำลังถอยไปหน้าที่ยังมีรายการ — ยังไม่มีอะไรให้ตรวจ
  // ส่วนสลับลำดับ/เปลี่ยนหน้าตอนมีรายการอยู่แล้ว คงพื้นที่ทำงานไว้แค่หรี่รายการลง หน้าจะได้ไม่กระพริบทั้งหน้า
  const showSpinner = loading && payments.length === 0;

  // คิวตรวจสลิปควรอัปเดตเองเมื่อมีลูกค้าส่งสลิปเข้ามาใหม่ — ตัวเลขเวลาที่รอในรายการก็ขยับตามรอบนี้ไปด้วย
  usePolling(() => reload({ silent: true }), 15000, true);

  const refresh = async () => {
    setRefreshing(true);
    await reload({ silent: true });
    setRefreshing(false);
  };

  const toggleSort = () => {
    setSort((current) => (current === 'oldest' ? 'newest' : 'oldest'));
    setPage(1);
  };

  const approve = async (payment) => {
    setBusyId(payment.id);
    try {
      await approvePayment(payment.id);
      // สลิปที่ส่งหลังหมดเวลาและที่นั่งไม่ว่างแล้ว อนุมัติ = เข้าคิวคืนเงิน ไม่ได้ออกตั๋ว
      toast.success(
        isLateSlip(payment)
          ? t('admin.paymentQueue.lateApproved', { code: payment.booking.code })
          : isTopUp(payment)
            ? t('admin.paymentQueue.topUpApproved', { code: payment.booking.code })
            : `${payment.booking.code} → ${t('bookings.statusPAID')}`,
      );
      moveOnFrom(payment);
      await reload({ silent: true });
    } catch (error) {
      toast.error(apiError(error).message);
      await reload({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    const target = rejectTarget;
    setBusyId(target.id);
    try {
      await rejectPayment(target.id, reason.trim());
      toast.success(`${target.booking.code} → ${t('admin.paymentQueue.reject')}`);
      setRejectTarget(null);
      setReason('');
      moveOnFrom(target);
      await reload({ silent: true });
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={QUEUE_PAGE}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('admin.payments')}</h1>
        {/* คิวรีเฟรชเองทุก 15 วินาทีอยู่แล้ว ปุ่มนี้ไว้ดึงทันทีตอนลูกค้าแจ้งว่าเพิ่งส่งสลิป — Button ใส่ spinner แทนไอคอนให้ตอนโหลด */}
        <Button variant="secondary" size="sm" loading={refreshing} onClick={refresh}>
          {!refreshing && <RefreshCw size={14} />}
          {t('common.refresh')}
        </Button>
      </div>

      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}
      {showSpinner && <LoadingBlock label={t('common.loading')} />}

      {data && !showSpinner && (
        <div className={QUEUE_GRID}>
          <QueueList
            label={t('admin.paymentQueue.pending')}
            sortLabel={t(sort === 'oldest' ? 'admin.paymentQueue.sortOldest' : 'admin.paymentQueue.sortNewest')}
            onToggleSort={toggleSort}
            items={payments}
            rowOf={rowOf}
            selectedId={selected?.id}
            onSelect={select}
            loading={loading}
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />

          {selected ? (
            <>
              {/*
                key = เปลี่ยนใบแล้ว SlipImage เริ่มใหม่หมด ไม่งั้นจะค้างรูปของใบก่อน (URL ที่ revoke ไปแล้ว) หรือสถานะโหลดไม่ได้ของใบก่อน
              */}
              <section ref={panelRef} aria-label={t('common.slip')} className={SLIP_PANEL}>
                <SlipImage
                  key={selected.id}
                  bookingId={selected.booking.id}
                  paymentId={isTopUp(selected) ? selected.id : undefined}
                  className="absolute inset-3"
                />
              </section>

              <section className={DETAIL_PANEL}>
                <div className={DETAIL_BODY}>
                  <h2 className="font-code text-h2 font-semibold text-accent">{selected.booking.code}</h2>
                  <p className="mt-1 text-body-1 font-bold">{pick(selected.booking.showtime.movie, 'title')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Chip tone="accent" size="sm">
                      {selected.booking.showtime.theatre.name}
                    </Chip>
                    <Chip tone="accent" size="sm">
                      {formatDate(selected.booking.showtime.startsAt, lang)}
                    </Chip>
                    <Chip tone="accent" size="sm">
                      {formatTime(selected.booking.showtime.startsAt, lang)}
                    </Chip>
                  </div>

                  {isTopUp(selected) && (
                    <p className="mt-3 rounded-lg border border-info/40 bg-info-bg px-3 py-2 text-caption text-info sm:text-body-2">
                      {t('admin.paymentQueue.topUp')}
                    </p>
                  )}
                  {isLateSlip(selected) && (
                    <p className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-caption text-warning sm:text-body-2">
                      {isTopUp(selected) ? t('admin.paymentQueue.lateTopUp') : t('admin.paymentQueue.lateSlip')}
                    </p>
                  )}

                  {/* ยอดที่ต้องเทียบกับรูปสลิป แยกเป็นกล่องเด่น ตาเลื่อนจากรูปมาหาตัวเลขได้ทันที */}
                  <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-body-2 font-medium">
                      <ScanSearch size={16} className="shrink-0 text-accent" />
                      {t('admin.paymentQueue.checkOnSlip')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-body-2 text-muted">{t('admin.paymentQueue.amount')}</span>
                      <span className="text-h1 font-bold text-accent">{formatBaht(selected.amount, lang)}</span>
                    </div>
                  </div>

                  <p className="mt-4 text-caption font-medium text-muted">{t('admin.paymentQueue.systemInfo')}</p>
                  <dl className={clsx(DETAIL_LIST, 'mt-1.5')}>
                    <dt className="text-muted">{t('payment.reference')}</dt>
                    <dd className="font-code">{selected.reference}</dd>

                    <dt className="text-muted">{t('admin.paymentQueue.waitingSince')}</dt>
                    <dd>{formatDateTime(selected.slipUploadedAt, lang)}</dd>
                  </dl>

                  <dl className={clsx(DETAIL_LIST, 'mt-3 border-t border-line pt-3')}>
                    <dt className="text-muted">{t('admin.queue.customer')}</dt>
                    <dd>{selected.booking.user.name}</dd>

                    <dt className="text-muted">{t('admin.queue.phone')}</dt>
                    <dd className="font-code">{selected.booking.user.phone}</dd>

                    <dt className="text-muted">{t('ticket.seats')}</dt>
                    <dd className="font-medium">
                      {isTopUp(selected)
                        ? `${selected.seatChange.fromSeats.join(', ')} → ${selected.seatChange.toSeats.join(', ')}`
                        : selected.booking.seats.map((seat) => seat.label).join(', ')}
                    </dd>
                  </dl>
                </div>

                <div className={DETAIL_FOOTER}>
                  <Button
                    variant="success"
                    size="lg"
                    className="w-full"
                    loading={busyId === selected.id}
                    onClick={() => approve(selected)}
                  >
                    {busyId !== selected.id && <CircleCheck size={18} />}
                    {t('admin.paymentQueue.approve')}
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    className="w-full"
                    disabled={busyId === selected.id}
                    onClick={() => {
                      setRejectTarget(selected);
                      setReason('');
                    }}
                  >
                    <CircleX size={18} />
                    {t('admin.paymentQueue.reject')}
                  </Button>
                </div>
              </section>
            </>
          ) : (
            // คิวว่าง: แผงสลิปกับรายละเอียดรวมเป็นแผงเดียว
            <EmptyState
              compact
              icon={Inbox}
              title={t('admin.paymentQueue.empty')}
              className="justify-center md:col-span-2 xl:min-h-0"
            />
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('admin.paymentQueue.rejectTitle')}
        confirmLabel={t('admin.paymentQueue.reject')}
        loading={busyId === rejectTarget?.id}
        disabled={!reason.trim()}
        onConfirm={reject}
      >
        <Field label={t('admin.paymentQueue.rejectReason')} required>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('admin.paymentQueue.rejectPlaceholder')}
            rows={5}
            maxLength={200}
            autoFocus
          />
        </Field>
      </ConfirmModal>
    </div>
  );
};

export default AdminPaymentsPage;
