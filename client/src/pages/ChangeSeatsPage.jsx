import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Clock3, Info, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../api/client.js';
import { getBooking, requestSeatChange } from '../api/bookings.js';
import { changeSeats } from '../api/admin.js';
import { getSeatMap } from '../api/showtimes.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import RefundAccountFields from '../components/booking/RefundAccountFields.jsx';
import BottomBar from '../components/layout/BottomBar.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import Field from '../components/ui/Field.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import Modal from '../components/ui/Modal.jsx';
import Textarea from '../components/ui/Textarea.jsx';
import SeatMap from '../components/seatmap/SeatMap.jsx';
import SeatLegend from '../components/seatmap/SeatLegend.jsx';
import { EMPTY_REFUND_FORM, readRefundAccountForm } from '../utils/banks.js';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';
import { previewSeatChange, sameZones } from '../utils/seatChange.js';
import { seatLabels } from '../utils/seats.js';

// ต้องตรงกับ SEAT_HOLD_MINUTES ฝั่ง server — เวลาที่กันที่นั่งใหม่ไว้รอโอนส่วนต่าง
const HOLD_MINUTES = 10;

/**
 * เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว — เริ่มจากที่นั่งเดิมเลือกไว้ครบ ลูกค้าแตะที่นั่งเดิมออกแล้วเลือกที่ใหม่แทน
 * ส่วนต่างที่เห็นก่อนกดยืนยันคิดด้วยกติกาเดียวกับ server (utils/seatChange.js) แต่ยอดจริงให้ server คิด
 *
 * admin = ผู้ดูแลย้ายแทนลูกค้า (เปิดจาก /admin/bookings) — โซนเดิมทุกที่ ไม่มีส่วนต่าง และใส่เหตุผลให้ลูกค้าเห็น
 */
const ChangeSeatsPage = ({ admin = false }) => {
  const { bookingId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, pick } = useI18n();
  const toast = useToast();

  const [booking, setBooking] = useState(null);
  const [seatMap, setSeatMap] = useState(null);
  const [selected, setSelected] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refundForm, setRefundForm] = useState(EMPTY_REFUND_FORM);
  const [refundErrors, setRefundErrors] = useState({});
  const [reason, setReason] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ loading: true, error: null });
      try {
        const { data } = await getBooking(bookingId);
        const next = data.booking;
        // มีคำขอที่รอโอนส่วนต่างค้างอยู่ — ลูกค้าต้องไปจัดการคำขอนั้นก่อน (โอนต่อหรือยกเลิก)
        if (!admin && next.seatChange.open) {
          navigate(`/booking/${next.id}/seat-change/${next.seatChange.open.id}`, { replace: true });
          return;
        }
        const map = await getSeatMap(next.showtime.id);
        const ownIds = next.seats.map((seat) => seat.id);
        const free = new Set(
          map.data.rows
            .flatMap((row) => row.seats)
            .filter((seat) => seat.status === 'AVAILABLE' || ownIds.includes(seat.id))
            .map((seat) => seat.id),
        );
        setBooking(next);
        setSeatMap(map.data);
        // โหลดครั้งแรกเริ่มจากที่นั่งเดิม · โหลดซ้ำ (ที่นั่งถูกตัดหน้า) ตัดเฉพาะที่นั่งที่ไม่ว่างแล้วออก
        // ที่นั่งเดิมที่ผู้ดูแลปิดใช้งาน (เช่น ชำรุด) ไม่อยู่ในผัง ถ้าปล่อยไว้ใน selected จะแตะเอาออกไม่ได้จนเลือกที่ใหม่ไม่ได้เลย
        setSelected((current) => (silent ? current : ownIds).filter((id) => free.has(id)));
        setState({ loading: false, error: null });
      } catch (error) {
        setState({ loading: false, error: apiError(error).message });
      }
    },
    [bookingId, admin, navigate],
  );

  useEffect(() => {
    load();
  }, [load]);

  const seatsById = useMemo(() => {
    const map = new Map();
    for (const row of seatMap?.rows ?? []) {
      for (const seat of row.seats) map.set(seat.id, { ...seat, rowLabel: row.rowLabel });
    }
    return map;
  }, [seatMap]);

  if (state.loading) return <LoadingBlock label={t('common.loading')} />;
  if (state.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />
      </div>
    );
  }

  // ผู้ดูแลเปิดมาจากตารางการจอง (ลิงก์ส่ง state.from มา) — กลับไปหน้าเดิมพร้อมตัวกรองที่ค้างไว้
  const from = location.state?.from;
  const adminBackTo = from ? `${from.pathname}${from.search ?? ''}` : '/admin/bookings';
  const backTo = admin ? adminBackTo : '/my-bookings';
  const { showtime } = booking;
  const required = booking.seats.length;
  const ownIds = booking.seats.map((seat) => seat.id);
  const selectedSeats = selected.map((id) => seatsById.get(id)).filter(Boolean);
  // ที่นั่งเดิมที่ปิดใช้งานแล้ว ไม่อยู่ในผังจึงไม่ได้ถูกเลือกไว้ตั้งแต่ต้น — บอกให้รู้ว่าต้องเลือกที่ใหม่แทน
  const closedOwn = booking.seats.filter((seat) => !seatsById.has(seat.id));
  const preview = previewSeatChange(booking.seats, selectedSeats);
  const unchanged = selected.length === required && selected.every((id) => ownIds.includes(id));
  const zonesOk = !admin || sameZones(booking.seats, selectedSeats);
  const ready = selected.length === required && !unchanged && zonesOk;
  const amount = formatMoney(Math.abs(preview.diffAmount), lang);
  // ฝั่งลูกค้าดูกติกาจาก server (ผ่านเส้นตาย/โควตาแล้วหรือยัง) ส่วนผู้ดูแลติดแค่ว่าต้องเป็นการจองที่จ่ายแล้ว
  const blockedReason = admin
    ? booking.status === 'PAID'
      ? null
      : 'NOT_PAID'
    : booking.seatChange.blockedReason;

  const handleToggle = (seat) => {
    if (selected.includes(seat.id)) {
      setSelected(selected.filter((id) => id !== seat.id));
      return;
    }
    if (selected.length >= required) {
      toast.info(t('seatChange.pickExact', { count: required }));
      return;
    }
    setSelected([...selected, seat.id]);
  };

  const openConfirm = () => {
    setRefundForm(EMPTY_REFUND_FORM);
    setRefundErrors({});
    setConfirming(true);
  };

  const submit = async () => {
    // ย้ายไปที่ถูกกว่า — ต้องบอกบัญชีรับเงินคืนก่อน เพราะผู้ดูแลโอนคืนเองด้วยมือ
    let refundAccount = {};
    if (!admin && preview.diffAmount < 0) {
      const { value, errors } = readRefundAccountForm(refundForm, t);
      setRefundErrors(errors);
      if (!value) return;
      refundAccount = value;
    }

    setSubmitting(true);
    try {
      const { data } = admin
        ? await changeSeats(bookingId, { seatIds: selected, reason: reason.trim() })
        : await requestSeatChange(bookingId, { seatIds: selected, ...refundAccount });
      const change = data.seatChange;
      if (change.status === 'PENDING_PAYMENT') {
        navigate(`/booking/${bookingId}/seat-change/${change.id}`);
        return;
      }
      toast.success(
        change.diffAmount < 0
          ? t('seatChange.doneRefund', { amount: formatMoney(-change.diffAmount, lang) })
          : t('seatChange.done'),
      );
      // ผู้ดูแลกลับไปตารางที่เปิดมา แถวนี้จะโชว์ที่นั่งใหม่ · เปิดหน้านี้ตรง ๆ (ไม่มีตารางให้กลับ) ไปที่รายการของการจองนี้แทน
      const adminNext = from ? adminBackTo : `/admin/bookings?q=${booking.code}`;
      navigate(admin ? adminNext : `/booking/${bookingId}/ticket`);
    } catch (error) {
      const problem = apiError(error);
      if (problem.code === 'SEAT_TAKEN') {
        toast.error(t('seats.seatTaken', { seats: problem.details?.seats?.join(', ') ?? '' }));
        setConfirming(false);
        await load(true);
      } else if (problem.code === 'SEAT_CHANGE_PENDING' && problem.details?.seatChangeId && !admin) {
        navigate(`/booking/${bookingId}/seat-change/${problem.details.seatChangeId}`);
      } else {
        toast.error(problem.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const priceSummary =
    preview.diffAmount > 0
      ? t('seatChange.payMore', { amount })
      : preview.diffAmount < 0
        ? t('seatChange.getBack', { amount })
        : t('seatChange.free');

  const header = (
    <>
      <Breadcrumb
        className="mb-4"
        items={
          admin
            ? [
                { label: t('nav.admin'), to: '/admin' },
                { label: t('admin.bookings'), to: backTo },
                { label: t('seatChange.adminTitle') },
              ]
            : [
                { label: t('nav.home'), to: '/' },
                { label: t('nav.myBookings'), to: '/my-bookings' },
                { label: t('seatChange.title') },
              ]
        }
      />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {admin ? t('seatChange.adminTitle') : t('seatChange.title')}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted sm:text-base">
            <span className="font-semibold text-fg">{pick(showtime.movie, 'title')}</span>
            <span>{showtime.theatre.name}</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 size={13} />
              {formatDate(showtime.startsAt, lang)} · {formatTime(showtime.startsAt, lang)}
            </span>
            <span className="font-mono text-accent">{booking.code}</span>
          </p>
        </div>
        {!blockedReason && (
          <Button variant="ghost" size="sm" onClick={() => load(true)}>
            <RefreshCw size={14} /> {t('seats.refreshMap')}
          </Button>
        )}
      </div>
    </>
  );

  if (blockedReason) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        {header}
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <Info size={36} className="text-muted" />
          <p className="text-base sm:text-lg">
            {t(`seatChange.blocked${blockedReason}`, {
              max: booking.seatChange.maxChanges,
              minutes: booking.seatChange.cutoffMinutes,
            })}
          </p>
          <Button as={Link} to={backTo} variant="secondary">
            {t('common.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6">
      {header}

      <p className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" />
        {admin
          ? t('seatChange.adminIntro')
          : `${t('seatChange.intro', { count: required })} · ${t('seatChange.policy', {
              left: booking.seatChange.changesLeft,
              minutes: booking.seatChange.cutoffMinutes,
            })}`}
      </p>

      {closedOwn.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {t('seatChange.ownSeatClosed', { seats: seatLabels(closedOwn) })}
        </p>
      )}

      <SeatMap
        rows={seatMap.rows}
        selectedIds={selected}
        ownIds={ownIds}
        onToggle={handleToggle}
        disabled={submitting}
      />

      <div className="mt-4">
        <SeatLegend prices={seatMap.prices} showOwn />
      </div>

      {/* แถบสรุปติดขอบล่าง — เห็นเดิม → ใหม่ และส่วนต่างทันทีที่แตะที่นั่ง แบบเดียวกับหน้าเลือกที่นั่ง */}
      {/* ฝั่งผู้ดูแลเริ่มหลังแถบเมนูซ้าย (lg:w-48 ใน AdminLayout) จะได้ไม่บังเมนู */}
      <BottomBar className={clsx(admin && 'lg:left-48')}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="text-muted">{t('seatChange.from')}</span>
            <span className="font-semibold">{booking.seats.map((seat) => seat.label).join(', ')}</span>
            <ArrowRight size={14} className="text-muted" />
            <span className="text-muted">{t('seatChange.to')}</span>
            <span className="font-semibold text-accent">
              {selectedSeats.length > 0 ? seatLabels(selectedSeats) : '—'}{' '}
              <span className="text-xs font-normal text-muted">
                ({selected.length}/{required})
              </span>
            </span>
          </p>
          {admin && !zonesOk && selected.length === required && (
            <p className="mt-1 text-xs text-danger">{t('seatChange.zoneMismatch')}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-muted">{t('seatChange.amount')}</p>
            <p
              className={clsx(
                'text-lg font-bold',
                preview.diffAmount > 0 && 'text-accent',
                preview.diffAmount < 0 && 'text-success',
              )}
            >
              {ready ? priceSummary : '—'}
            </p>
          </div>
          <Button size="lg" className="flex-1 sm:flex-none" disabled={!ready} onClick={openConfirm}>
            {t('seatChange.confirm')}
          </Button>
        </div>
      </BottomBar>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('seatChange.confirmTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={submitting} onClick={submit}>
              {preview.diffAmount > 0 ? t('seatChange.payDifference', { amount }) : t('seatChange.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-semibold">
            {booking.seats.map((seat) => seat.label).join(', ')}
            <ArrowRight size={14} className="text-muted" />
            <span className="text-accent">{seatLabels(selectedSeats)}</span>
          </p>

          <p className="text-muted">
            {preview.diffAmount > 0
              ? t('seatChange.confirmTopUp', { amount, minutes: HOLD_MINUTES })
              : preview.diffAmount < 0
                ? t('seatChange.confirmRefund', { amount })
                : t('seatChange.confirmFree')}
          </p>

          {!admin && preview.diffAmount < 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
              <RefundAccountFields form={refundForm} onChange={setRefundForm} errors={refundErrors} />
            </div>
          )}

          {admin && (
            <Field label={t('seatChange.reason')}>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('seatChange.reasonPlaceholder')}
                maxLength={200}
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ChangeSeatsPage;
