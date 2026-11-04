import { useState } from 'react';
import { BadgeCheck, CircleCheck, Copy, Info, Landmark, Pencil } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { completeRefund, updateRefund } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../ui/Button.jsx';
import Chip from '../ui/Chip.jsx';
import Input from '../ui/Input.jsx';
import SlipDropzone from '../ui/SlipDropzone.jsx';
import SlipImage from '../ui/SlipImage.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { DETAIL_BODY, DETAIL_FOOTER, DETAIL_LIST, DETAIL_PANEL, SLIP_PANEL } from './queueLayout.js';
import { formatAccountNo } from '../../utils/banks.js';
import { formatBaht, formatDate, formatDateTime, formatTime } from '../../utils/format.js';

/** เงินส่วนต่างจากการเปลี่ยนที่นั่ง — สลิปคืนเงินต้องอ้าง id ของรายการนี้ ไม่ใช่ใบหลักของการจอง */
const isSeatChangeMoney = (item) => item.kind !== 'BOOKING';

/**
 * เหตุที่ต้องคืนเงิน — ใช้ทั้งป้ายสถานะ ชื่อเหตุการณ์แรกในประวัติ และเลือกเวลาที่ทำรายการ
 * ระบบไม่ได้เก็บว่าใครเป็นคนยกเลิก (ลูกค้า ผู้ดูแล หรือยกเลิกทั้งรอบ) จึงบอกที่เหตุ แล้วให้ cancelReason เล่ารายละเอียด
 */
const refundReasonOf = (item) => {
  if (item.kind === 'SEAT_CHANGE_REFUND') return 'SEAT_CHANGE';
  if (item.kind === 'SEAT_CHANGE_TOPUP') return 'LATE_TOPUP';
  // ค่าตั๋วของการจองที่หมดเวลา = สลิปที่โอนมาหลังหมดเวลาแล้วที่นั่งไม่ว่าง (ผู้ดูแลยืนยันยอดแล้วจึงเข้าคิวนี้)
  return item.booking.status === 'EXPIRED' ? 'LATE_PAYMENT' : 'CANCELLED';
};

/**
 * เวลาที่เกิดเหตุให้ต้องคืนเงิน
 * โอนหลังหมดเวลาใช้เวลาที่ลูกค้าส่งสลิป เพราะ refundDueAt ของกรณีนี้คือเวลาที่ผู้ดูแลอนุมัติ
 * เปลี่ยนไปที่ถูกกว่าเข้าคิวพร้อมกับการย้ายที่นั่ง refundDueAt จึงเป็นเวลาที่ลูกค้าทำรายการพอดี
 */
const requestedAtOf = (item, reason) => {
  if (reason === 'CANCELLED') return item.booking.cancelledAt ?? item.refundDueAt;
  if (reason === 'LATE_PAYMENT' || reason === 'LATE_TOPUP') return item.slipUploadedAt ?? item.refundDueAt;
  return item.refundDueAt;
};

/** ที่นั่ง — เงินส่วนต่างบอกว่าย้ายจากไหนไปไหน (ตรงกับที่ลูกค้าเห็นตอนเปลี่ยนที่นั่ง) */
const seatsOf = (item) => {
  return item.seatChange
    ? `${item.seatChange.fromSeats.join(', ')} → ${item.seatChange.toSeats.join(', ')}`
    : item.booking.seats.map((seat) => seat.label).join(', ');
};

/** เหตุการณ์หนึ่งแถวในประวัติ — จุดสีบอกว่าเป็นฝั่งลูกค้า (หม่น) หรือการคืนเงินที่จบแล้ว (เขียว) */
const HistoryEvent = ({ dot, label, at, children }) => {
  const { lang } = useI18n();
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className={clsx('mt-1 size-3 shrink-0 rounded-full', dot)} />
      <div className="min-w-0">
        <p className="text-body-2 font-medium">{label}</p>
        <time dateTime={at} className="block text-caption text-muted">
          {formatDateTime(at, lang)}
        </time>
        {children}
      </div>
    </li>
  );
};

/**
 * แผงสลิป + แผงรายละเอียดของรายการคืนเงินที่เลือก (หน้าคืนเงินวาง key = id รายการ)
 *
 * สลิปที่แนบ หมายเหตุ และโหมดแก้ไขเป็น state ของรายการนี้เท่านั้น — เปลี่ยนรายการ (กดเอง หรือรายการหายจากคิวเพราะ
 * ผู้ดูแลอีกคนบันทึกไปแล้ว) แผงนี้ถูกสร้างใหม่ทั้งหมด สลิปที่แนบไว้จึงไม่มีทางถูกส่งไปผิดรายการ
 *
 * onCompleted(item) — บันทึกการคืนสำเร็จ (หน้าเลื่อนไปรายการถัดไปแล้วโหลดคิวใหม่)
 * onChanged() — ข้อมูลรายการนี้เปลี่ยนหรืออาจไม่ตรงกับ server แล้ว ให้โหลดคิวใหม่
 */
const RefundWorkspace = ({ item, panelRef, onCompleted, onChanged }) => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // เปลี่ยนสลิปแล้ว props ของ SlipImage เหมือนเดิมทุกตัว — ใส่ตัวนับนี้ใน key ให้โหลดรูปใหม่
  const [slipVersion, setSlipVersion] = useState(0);

  const pending = item.status === 'REFUND_PENDING';
  const reason = refundReasonOf(item);
  const requestedAt = requestedAtOf(item, reason);
  // เงินส่วนต่างบอกที่นั่งที่ย้ายในแถวที่นั่งแล้ว ส่วนค่าตั๋วบอกเหตุผลที่ระบบหรือผู้ดูแลบันทึกไว้ตอนยกเลิก
  const requestDetail = isSeatChangeMoney(item) ? null : item.booking.cancelReason;
  const attaching = pending || editing;
  // แก้ไขโดยไม่ได้เปลี่ยนอะไร = ไม่ต้องยิง server
  const dirty = Boolean(file) || note.trim() !== (item.refundNote ?? '');

  const startEdit = () => {
    setFile(null);
    setNote(item.refundNote ?? '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setFile(null);
    setEditing(false);
  };

  /** คัดลอกเลขบัญชีไปวางในแอปธนาคาร ไม่ต้องพิมพ์เองให้เสี่ยงโอนผิดบัญชี */
  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(item.refundAccountNo);
      toast.success(t('admin.refundPage.accountCopied'));
    } catch {
      // clipboard ใช้ได้เฉพาะ https หรือ localhost — นอกนั้นให้ผู้ดูแลคัดลอกเอง
      toast.error(t('admin.refundPage.copyFailed'));
    }
  };

  // บันทึกการคืนต้องมีสลิป (ลูกค้าเปิดดูเป็นหลักฐานได้) — ปุ่มจึงกดได้เมื่อแนบแล้วเท่านั้น
  const complete = async () => {
    setBusy(true);
    try {
      await completeRefund(item.id, { note: note.trim(), file });
      toast.success(t('admin.refundPage.completed'));
      onCompleted(item);
    } catch (error) {
      // เช่น ผู้ดูแลอีกคนบันทึกไปก่อน (409) — server ลบสลิปที่เพิ่งอัปโหลดทิ้งให้แล้ว
      toast.error(apiError(error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // ไม่แนบสลิปใหม่ = ใช้สลิปเดิม · หมายเหตุว่าง = ลบหมายเหตุเดิม (สถานะและเวลาที่คืนไม่เปลี่ยน ลูกค้าไม่ได้แจ้งเตือนซ้ำ)
  const saveEdit = async () => {
    setBusy(true);
    try {
      await updateRefund(item.id, { note: note.trim(), file });
      toast.success(t('admin.refundPage.updated'));
      if (file) setSlipVersion((version) => version + 1);
      setFile(null);
      setEditing(false);
      onChanged();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section ref={panelRef} aria-label={t('common.slip')} className={SLIP_PANEL}>
        {attaching ? (
          <div className="absolute inset-3 flex flex-col gap-3">
            <SlipDropzone
              file={file}
              onChange={setFile}
              title={t(editing ? 'admin.refundPage.replaceSlip' : 'admin.refundPage.attachSlip')}
              hint={t('admin.refundPage.slipFormats')}
              description={t(editing ? 'admin.refundPage.replaceSlipHint' : 'admin.refundPage.attachHint')}
              disabled={busy}
              className="min-h-0 flex-1"
            />
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('admin.refundPage.notePlaceholder')}
              aria-label={t('admin.refundPage.note')}
              maxLength={200}
              disabled={busy}
            />
          </div>
        ) : (
          <SlipImage
            key={`${item.id}:${slipVersion}`}
            bookingId={item.booking.id}
            paymentId={isSeatChangeMoney(item) ? item.id : undefined}
            kind="refund"
            className="absolute inset-3"
          />
        )}
      </section>

      <section className={DETAIL_PANEL}>
        <div className={DETAIL_BODY}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-code text-h2 font-semibold text-accent">{item.booking.code}</h2>
            {/* รอคืน: ป้ายบอกเหตุที่ต้องคืน · คืนแล้ว: ที่เดียวกันเป็นปุ่มแก้ไข (เปลี่ยนสลิปที่แนบผิด หรือแก้หมายเหตุ) */}
            {pending ? (
              <StatusBadge
                status="REFUND_PENDING"
                label={t(`admin.refundPage.badge${reason}`)}
                className="mt-1"
              />
            ) : (
              !editing && (
                <Button variant="secondary" size="sm" onClick={startEdit}>
                  <Pencil size={14} />
                  {t('common.edit')}
                </Button>
              )
            )}
          </div>
          <p className="mt-1 text-body-1 font-bold">{pick(item.booking.showtime.movie, 'title')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip tone="accent" size="sm">
              {item.booking.showtime.theatre.name}
            </Chip>
            <Chip tone="accent" size="sm">
              {formatDate(item.booking.showtime.startsAt, lang)}
            </Chip>
            <Chip tone="accent" size="sm">
              {formatTime(item.booking.showtime.startsAt, lang)}
            </Chip>
          </div>

          <dl className={clsx(DETAIL_LIST, 'mt-4')}>
            <dt className="text-muted">{t('ticket.seats')}</dt>
            <dd className="font-medium">{seatsOf(item)}</dd>

            {/* คืนแล้ว: เวลานี้อยู่ในประวัติด้านล่างแทน */}
            {pending && (
              <>
                <dt className="text-muted">{t('admin.refundPage.requestedAt')}</dt>
                <dd>
                  {formatDateTime(requestedAt, lang)}
                  {requestDetail && <span className="block text-caption text-muted">{requestDetail}</span>}
                </dd>
              </>
            )}

            <dt className="text-muted">{t('admin.queue.customer')}</dt>
            <dd>{item.booking.user.name}</dd>

            <dt className="text-muted">{t('admin.queue.phone')}</dt>
            <dd className="font-code">{item.booking.user.phone}</dd>
          </dl>

          {/* ยอดและปลายทางที่ต้องพิมพ์ลงแอปธนาคาร แยกเป็นกล่องเด่น ตาเลื่อนมาหาได้ทันที */}
          <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-body-2 font-medium">
              {pending ? (
                <Landmark size={16} className="shrink-0 text-accent" />
              ) : (
                <BadgeCheck size={16} className="shrink-0 text-success" />
              )}
              {t(pending ? 'admin.refundPage.transferTo' : 'admin.refundPage.transferred')}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-body-2 text-muted">
                {t(pending ? 'admin.refundPage.amountDue' : 'admin.refundPage.amountRefunded')}
              </span>
              <span className="text-h1 font-bold text-accent">{formatBaht(item.refundAmount, lang)}</span>
            </div>
            {/* ยกเลิกการจองที่เคยเปลี่ยนที่นั่ง — คืนยอดสุทธิครั้งเดียว ไม่ใช่ยอดที่จ่ายตอนจอง */}
            {!isSeatChangeMoney(item) && item.refundAmount !== item.amount && (
              <p className="text-right text-caption text-muted">{t('admin.refundPage.netOfSeatChanges')}</p>
            )}

            {item.refundAccountNo ? (
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-body-2">
                <dt className="text-muted">{t('bookings.bankName')}</dt>
                <dd className="text-right wrap-anywhere">{item.refundBankName}</dd>

                <dt className="text-muted">{t('bookings.accountNo')}</dt>
                <dd className="flex items-center justify-end gap-1">
                  <span className="font-code">{formatAccountNo(item.refundAccountNo)}</span>
                  <button
                    type="button"
                    onClick={copyAccount}
                    title={t('admin.refundPage.copyAccount')}
                    aria-label={t('admin.refundPage.copyAccount')}
                    className="-my-1 rounded-md p-1 text-muted transition hover:bg-surface hover:text-fg"
                  >
                    <Copy size={14} />
                  </button>
                </dd>

                {/* แจ้งบัญชีไว้ก่อนมีช่องชื่อบัญชี (หรือจาก client รุ่นก่อน) — บอกให้รู้ว่าไม่มี ไม่ใช่ปล่อยว่าง */}
                <dt className="text-muted">{t('bookings.accountName')}</dt>
                <dd className={clsx('text-right wrap-anywhere', !item.refundAccountName && 'text-muted')}>
                  {item.refundAccountName ?? t('admin.refundPage.accountNameMissing')}
                </dd>
              </dl>
            ) : (
              <p className="mt-2 text-body-2 text-danger">{t('admin.refundPage.noAccount')}</p>
            )}
          </div>

          {!pending && (
            <section className="mt-5" aria-label={t('admin.refundPage.history')}>
              <h3 className="text-body-2 font-medium text-muted">{t('admin.refundPage.history')}</h3>
              <ol className="mt-3 flex flex-col gap-3">
                <HistoryEvent dot="bg-muted" label={t(`admin.refundPage.event${reason}`)} at={requestedAt}>
                  {requestDetail && <p className="text-caption text-muted">{requestDetail}</p>}
                </HistoryEvent>
                <HistoryEvent dot="bg-success" label={t('admin.refundPage.eventRefunded')} at={item.refundedAt}>
                  {item.refundedBy && (
                    <p className="text-caption text-muted">
                      {t('admin.refundPage.by', { name: item.refundedBy.name })}
                    </p>
                  )}
                  {item.refundNote && (
                    <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 text-caption wrap-anywhere">
                      {item.refundNote}
                    </p>
                  )}
                </HistoryEvent>
              </ol>
            </section>
          )}
        </div>

        {pending && (
          <div className={DETAIL_FOOTER}>
            {/* ระบบไม่ได้ตัดเงินเอง จึงคืนเองไม่ได้ — ปุ่มนี้แค่บันทึกว่าผู้ดูแลโอนไปแล้ว */}
            <p className="flex items-start gap-1.5 text-caption text-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              {t('admin.refundPage.transferFirst')}
            </p>
            <Button
              variant="success"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!file}
              onClick={complete}
            >
              {!busy && <CircleCheck size={18} />}
              {t('admin.refundPage.confirmTransfer')}
            </Button>
          </div>
        )}

        {editing && (
          <div className={clsx(DETAIL_FOOTER, 'sm:flex-row')}>
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={cancelEdit}>
              {t('common.cancel')}
            </Button>
            <Button variant="success" className="flex-1" loading={busy} disabled={!dirty} onClick={saveEdit}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </section>
    </>
  );
};

export default RefundWorkspace;
