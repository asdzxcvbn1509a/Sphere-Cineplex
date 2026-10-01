import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, RefreshCw, TimerReset } from 'lucide-react';
import { apiError } from '../api/client.js';
import { getSeatMap } from '../api/showtimes.js';
import { cancelBooking, createBooking } from '../api/bookings.js';
import { useIsAuthenticated } from '../store/authStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import SeatMap from '../components/seatmap/SeatMap.jsx';
import SeatLegend from '../components/seatmap/SeatLegend.jsx';
import useSeatSelection from '../hooks/useSeatSelection.js';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';

const MAX_SEATS = 8;
// ต้องตรงกับ SEAT_HOLD_MINUTES ฝั่ง server
const HOLD_MINUTES = 10;

const SeatSelectionPage = () => {
  const { showtimeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, pick } = useI18n();
  const isAuthenticated = useIsAuthenticated();
  const toast = useToast();

  const [seatMap, setSeatMap] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });
  const [submitting, setSubmitting] = useState(false);
  // มีการจองรอบนี้ที่ยังไม่จ่ายอยู่ (มักเกิดจากกด back ออกจากหน้าชำระเงินมาเลือกใหม่) — { bookingId, seats }
  const [pendingBooking, setPendingBooking] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const { selected, toggle, clear, keepOnly } = useSeatSelection(showtimeId, MAX_SEATS);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setState({ loading: true, error: null });
      return getSeatMap(showtimeId)
        .then(({ data }) => {
          setSeatMap(data);
          setState({ loading: false, error: null });
          // ถ้าที่นั่งที่เลือกไว้ถูกคนอื่นจองไปแล้ว ให้เอาออกจากตะกร้าเงียบ ๆ
          const stillAvailable = data.rows
            .flatMap((row) => row.seats)
            .filter((seat) => seat.status === 'AVAILABLE')
            .map((seat) => seat.id);
          keepOnly(stillAvailable);
          return data;
        })
        .catch((error) => {
          setState({ loading: false, error: apiError(error).message });
          return null;
        });
    },
    [showtimeId, keepOnly],
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

  const selectedSeats = selected.map((id) => seatsById.get(id)).filter(Boolean);
  const total = selectedSeats.reduce((sum, seat) => sum + seat.price, 0);

  const handleToggle = (seat) => {
    if (!selected.includes(seat.id) && selected.length >= MAX_SEATS) {
      toast.info(t('seats.maxSeats', { max: MAX_SEATS }));
      return;
    }
    toggle(seat.id);
  };

  const handleConfirm = async () => {
    if (selected.length === 0) {
      toast.info(t('seats.pickSeatFirst'));
      return;
    }
    // Lazy registration: บังคับล็อกอินตอนนี้เท่านั้น ที่นั่งที่เลือกถูกเก็บไว้ใน sessionStorage แล้ว
    if (!isAuthenticated) {
      toast.info(t('errors.loginRequired'));
      navigate('/login', { state: { from: location } });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await createBooking({ showtimeId, seatIds: selected });
      clear();
      navigate(`/booking/${data.booking.id}/payment`);
    } catch (error) {
      const problem = apiError(error);
      if (problem.code === 'SEAT_TAKEN') {
        toast.error(t('seats.seatTaken', { seats: problem.details?.seats?.join(', ') ?? '' }));
        await load(true);
      } else if (problem.code === 'PENDING_BOOKING_EXISTS') {
        setPendingBooking(problem.details);
      } else {
        toast.error(problem.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** ยกเลิกใบเดิมที่ยังไม่จ่าย แล้วโหลดผังใหม่ — ที่นั่งชุดเดิมจะกลับมาว่างให้เลือกรวมกับชุดใหม่ได้ */
  const releasePendingBooking = async () => {
    setReleasing(true);
    try {
      await cancelBooking(pendingBooking.bookingId, { reason: 'ผู้ใช้ยกเลิกเพื่อเลือกที่นั่งใหม่' });
      toast.success(t('seats.pendingReleased'));
      setPendingBooking(null);
      await load(true);
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setReleasing(false);
    }
  };

  if (state.loading) return <LoadingBlock label={t('common.loading')} />;
  if (state.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />
      </div>
    );
  }

  const { showtime } = seatMap;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-40 pt-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{pick(showtime.movie, 'title')}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted sm:text-base">
            <span>{showtime.theatre.name}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
              {showtime.theatre.screenType}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 size={13} />
              {formatDate(showtime.startsAt, lang)} · {formatTime(showtime.startsAt, lang)}
            </span>
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={() => load(true)}>
          <RefreshCw size={14} /> {t('seats.refreshMap')}
        </Button>
      </div>

      <SeatMap rows={seatMap.rows} selectedIds={selected} onToggle={handleToggle} disabled={submitting} />

      <div className="mt-4">
        <SeatLegend prices={seatMap.prices} />
      </div>

      {/* แถบสรุปติดขอบล่าง — ราคาต้องอัปเดตทันทีที่แตะที่นั่ง ตามที่ผลสำรวจระบุ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted">
              {t('seats.selectedSeats')} ({selected.length}/{MAX_SEATS})
            </p>
            <p className="truncate font-semibold">
              {selectedSeats.length > 0
                ? selectedSeats
                    .map((seat) => `${seat.rowLabel}${seat.seatNumber}`)
                    .sort()
                    .join(', ')
                : '—'}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <TimerReset size={13} className="shrink-0" />
              {t('seats.holdNotice', { minutes: HOLD_MINUTES })}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted">{t('seats.totalPrice')}</p>
              <p className="text-xl font-bold text-accent">
                {formatMoney(total, lang)} <span className="text-sm">{t('common.baht')}</span>
              </p>
            </div>

            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              loading={submitting}
              disabled={selected.length === 0}
              onClick={handleConfirm}
            >
              {t('seats.continue')}
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(pendingBooking)}
        onClose={() => setPendingBooking(null)}
        title={t('seats.pendingTitle')}
        size="sm"
        footer={
          <>
            <Button variant="danger" loading={releasing} onClick={releasePendingBooking}>
              {t('seats.pendingRelease')}
            </Button>
            <Button
              disabled={releasing}
              onClick={() => navigate(`/booking/${pendingBooking.bookingId}/payment`)}
            >
              {t('seats.pendingGoPay')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {t('seats.pendingBody', { seats: pendingBooking?.seats?.join(', ') ?? '' })}
        </p>
      </Modal>
    </div>
  );
};

export default SeatSelectionPage;
