import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Copy, Info, Pencil, ReceiptText, Upload } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { completeRefund, listRefunds, updateRefund } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import SlipImage from '../../components/ui/SlipImage.jsx';
import usePolling from '../../hooks/usePolling.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';

const TABS = ['REFUND_PENDING', 'REFUNDED'];

const AdminRefundsPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('REFUND_PENDING');
  const [refunds, setRefunds] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });

  // target = รายการที่เปิดหน้าต่างอยู่ — รอคืนเงิน = บันทึกการคืน, คืนแล้ว = แก้ไขรายการ
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [slipTarget, setSlipTarget] = useState(null);
  const editing = target?.status === 'REFUNDED';

  const refreshCounts = useAdminQueueStore((state) => state.refresh);
  // สรุปยอดค้างจากตัวเลขชุดเดียวกับป้ายบนเมนู จึงโชว์ได้ทั้งสองแท็บและไม่ขัดกับป้าย
  const pendingRefunds = useAdminQueueStore((state) => state.pendingRefunds);
  const pendingRefundAmount = useAdminQueueStore((state) => state.pendingRefundAmount);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setState({ loading: true, error: null });
      return listRefunds(tab)
        .then(({ data }) => {
          setRefunds(data.refunds);
          setState({ loading: false, error: null });
          // เช่นเดียวกับคิวตรวจสลิป กดบันทึกคืนเงินแล้วป้ายต้องลดลงเลย
          refreshCounts();
        })
        .catch((error) => setState({ loading: false, error: apiError(error).message }));
    },
    [tab, refreshCounts],
  );

  useEffect(() => {
    load();
  }, [load]);

  // มีการยกเลิกเข้ามาระหว่างเปิดหน้าอยู่ได้ตลอด จึงรีเฟรชคิวเองเป็นระยะ
  usePolling(() => load(true), 20000, tab === 'REFUND_PENDING');

  const openTarget = (item) => {
    setTarget(item);
    setNote(item.refundNote ?? '');
    setFile(null);
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (editing) {
        await updateRefund(target.id, { note: note.trim(), file });
        toast.success(t('admin.refundPage.updated'));
      } else {
        await completeRefund(target.id, { note: note.trim(), file });
        toast.success(t('admin.refundPage.completed'));
      }
      setTarget(null);
      setNote('');
      setFile(null);
      load(true);
    } catch (error) {
      toast.error(apiError(error).message);
      load(true);
    } finally {
      setBusy(false);
    }
  };

  /** คัดลอกเลขบัญชีไปวางในแอปธนาคาร ไม่ต้องพิมพ์เองให้เสี่ยงโอนผิดบัญชี */
  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(target.refundAccountNo);
      toast.success(t('admin.refundPage.accountCopied'));
    } catch {
      // clipboard ใช้ได้เฉพาะ https หรือ localhost — นอกนั้นให้ผู้ดูแลคัดลอกเอง
      toast.error(t('admin.refundPage.copyFailed'));
    }
  };

  return (
    <div className="p-4 sm:p-6">
      {/* ไม่มีปุ่มรีเฟรชแล้ว — แท็บรอคืนเงินรีเฟรชเองทุก 20 วินาที เหมือนคิวตรวจสลิป */}
      <h1 className="text-2xl font-bold sm:text-3xl">{t('admin.refunds')}</h1>
      {/* ไม่มีงานค้างก็ไม่ต้องบอก "0 รายการ" — เว้นความสูงไว้ แท็บจะได้ไม่กระโดดตอนคืนรายการสุดท้าย */}
      <p className="mt-1 min-h-5 text-sm text-muted">
        {pendingRefunds > 0 &&
          t('admin.refundPage.pendingSummary', {
            count: pendingRefunds,
            amount: formatMoney(pendingRefundAmount, lang),
          })}
      </p>

      <div className="my-4 inline-flex rounded-xl border border-line bg-surface p-1">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={clsx(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === item ? 'bg-accent text-ink' : 'text-muted hover:text-fg',
            )}
          >
            {t(`admin.refundPage.tab${item}`)}
          </button>
        ))}
      </div>

      <div className="flex max-w-5xl flex-col gap-5">
        {/* ระบบไม่ได้ตัดเงินเอง จึงคืนเองไม่ได้ ต้องบอกให้ชัดว่าผู้ดูแลต้องโอนเอง */}
        {tab === 'REFUND_PENDING' && refunds.length > 0 && (
          <p className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent sm:text-base">
            <Info size={18} className="mt-0.5 shrink-0" />
            {t('admin.refundPage.manualNotice')}
          </p>
        )}

        {state.loading && <LoadingBlock label={t('common.loading')} />}
        {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

        {!state.loading && !state.error && refunds.length === 0 && (
          <EmptyState
            compact
            icon={BadgeCheck}
            title={
              tab === 'REFUND_PENDING' ? t('admin.refundPage.empty') : t('admin.refundPage.emptyDone')
            }
          />
        )}

        {refunds.map((item) => (
          <article key={item.id} className="card p-5 sm:p-8">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-base text-accent sm:text-lg">{item.booking.code}</span>
              <StatusBadge status={item.status} label={t(`admin.refundPage.tab${item.status}`)} />
            </div>

            <p className="mt-2 text-base font-bold sm:text-lg">
              {lang === 'en'
                ? item.booking.showtime.movie.titleEn
                : item.booking.showtime.movie.titleTh}
            </p>
            <p className="text-sm text-muted sm:text-base">
              {item.booking.showtime.theatre.name} ·{' '}
              {formatDateTime(item.booking.showtime.startsAt, lang)}
            </p>

            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm sm:text-base">
              <dt className="text-muted">{t('admin.refundPage.payTo')}</dt>
              <dd className="text-right">
                <span className="font-semibold">{item.booking.user.name}</span>
                <span className="block font-mono text-muted">{item.booking.user.phone}</span>
              </dd>

              <dt className="text-muted">{t('ticket.seats')}</dt>
              <dd className="text-right font-semibold">
                {item.booking.seats.map((seat) => seat.label).join(', ')}
              </dd>

              <dt className="text-muted">{t('admin.refundPage.cancelledAt')}</dt>
              <dd className="text-right font-semibold">
                {formatDateTime(item.booking.cancelledAt, lang)}
              </dd>

              <dt className="text-muted">{t('admin.refundPage.bankAccount')}</dt>
              <dd className="text-right">
                {item.refundAccountNo ? (
                  <>
                    <span className="font-semibold">{item.refundBankName}</span>
                    <span className="block font-mono">{item.refundAccountNo}</span>
                  </>
                ) : (
                  <span className="text-danger">{t('admin.refundPage.noAccount')}</span>
                )}
              </dd>

              <dt className="text-muted">{t('payment.reference')}</dt>
              <dd className="text-right font-mono font-semibold">{item.reference}</dd>

              {/* ชื่อผู้คืนและหมายเหตุอยู่ในหน้าต่างดูสลิป การ์ดจะได้ไม่ยาวเกิน */}
              {item.status === 'REFUNDED' && (
                <>
                  <dt className="text-muted">{t('admin.refundPage.refundedAt')}</dt>
                  <dd className="text-right font-semibold">{formatDateTime(item.refundedAt, lang)}</dd>
                </>
              )}
            </dl>

            <div className="mt-6 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-4 py-2.5 sm:px-6">
              <span className="text-sm text-muted sm:text-lg">{t('admin.refundPage.amount')}</span>
              <span className="text-xl font-bold text-accent sm:text-3xl">
                {formatMoney(item.amount, lang)} {t('common.baht')}
              </span>
            </div>

            {item.status === 'REFUND_PENDING' ? (
              <Button variant="success" className="mt-3 w-full" onClick={() => openTarget(item)}>
                <Upload size={16} /> {t('admin.refundPage.uploadSlip')}
              </Button>
            ) : (
              <div className="mt-3 flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setSlipTarget(item)}>
                  <ReceiptText size={16} /> {t('admin.refundPage.viewSlip')}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => openTarget(item)}>
                  <Pencil size={16} /> {t('admin.refundPage.editRecord')}
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={editing ? t('admin.refundPage.editTitle') : t('admin.refundPage.confirmTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            {/* บันทึกการคืนต้องมีสลิป (ลูกค้าเปิดดูเป็นหลักฐานได้) ส่วนตอนแก้ไขไม่แนบ = ใช้สลิปเดิม */}
            <Button variant="success" loading={busy} disabled={!editing && !file} onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {t(editing ? 'admin.refundPage.editBody' : 'admin.refundPage.confirmBody', {
            amount: formatMoney(target?.amount ?? 0, lang),
            name: target?.booking.user.name ?? '',
          })}
        </p>

        {/* ย้ำปลายทางอีกครั้งก่อนกดยืนยัน เพราะเป็นการโอนมือ พลาดแล้วตามคืนยาก */}
        <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="text-xs text-muted">{t('admin.refundPage.bankAccount')}</span>
          {target?.refundAccountNo ? (
            <p className="mt-0.5 flex items-center gap-1.5 font-medium">
              {target.refundBankName} <span className="font-mono">{target.refundAccountNo}</span>
              <button
                type="button"
                onClick={copyAccount}
                title={t('admin.refundPage.copyAccount')}
                aria-label={t('admin.refundPage.copyAccount')}
                className="rounded-md p-1 text-muted transition hover:bg-surface hover:text-fg"
              >
                <Copy size={14} />
              </button>
            </p>
          ) : (
            <p className="mt-0.5 text-danger">{t('admin.refundPage.noAccount')}</p>
          )}
        </div>

        <label
          className={clsx(
            'mb-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-4 text-center transition',
            file ? 'border-accent/60' : 'border-line hover:border-accent/60',
          )}
        >
          <Upload size={18} className="text-muted" />
          <span className={clsx('text-xs', file ? 'text-fg' : 'text-muted')}>
            {file
              ? file.name
              : t(
                  editing && target.hasRefundSlip
                    ? 'admin.refundPage.replaceSlip'
                    : 'admin.refundPage.attachSlip',
                )}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <Field label={t('admin.refundPage.note')}>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('admin.refundPage.notePlaceholder')}
            maxLength={200}
          />
        </Field>
      </Modal>

      {/* แบบเดียวกับที่ลูกค้าเห็นในหน้าการจองของฉัน + ชื่อผู้ดูแลที่บันทึก */}
      <Modal
        open={Boolean(slipTarget)}
        onClose={() => setSlipTarget(null)}
        title={t('bookings.refundSlipTitle')}
        size="sm"
      >
        {slipTarget && (
          <>
            <SlipImage bookingId={slipTarget.booking.id} kind="refund" className="h-80 w-full" />
            {slipTarget.refundNote && (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
                {slipTarget.refundNote}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">
              {t('bookings.refundedAt', { at: formatDateTime(slipTarget.refundedAt, lang) })}
              {slipTarget.refundedBy && ` · ${slipTarget.refundedBy.name}`}
            </p>
          </>
        )}
      </Modal>
    </div>
  );
};

export default AdminRefundsPage;
