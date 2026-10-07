import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Clock3, RefreshCw, TimerReset } from 'lucide-react';
import { apiError } from '../api/client.js';
import { getSeatMap } from '../api/showtimes.js';
import { cancelBooking, createBooking, listMyBookings } from '../api/bookings.js';
import { useIsAuthenticated } from '../store/authStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import BottomBar from '../components/layout/BottomBar.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import SeatMap from '../components/seatmap/SeatMap.jsx';
import SeatLegend from '../components/seatmap/SeatLegend.jsx';
import useApi from '../hooks/useApi.js';
import useSeatSelection from '../hooks/useSeatSelection.js';
import { formatDate, formatMoney, formatTime } from '../utils/format.js';
import { seatLabels } from '../utils/seats.js';

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

  const [submitting, setSubmitting] = useState(false);
  // มีการจองรอบนี้ที่ยังไม่จ่ายอยู่ (มักเกิดจากกด back ออกจากหน้าชำระเงินมาเลือกใหม่) — { bookingId, seats }
  const [pendingBooking, setPendingBooking] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const { selected, toggle, clear, keepOnly } = useSeatSelection(showtimeId, MAX_SEATS);

  const { data: seatMap, loading, error, reload } = useApi(async () => {
    const { data } = await getSeatMap(showtimeId);
    // ถ้าที่นั่งที่เลือกไว้ถูกคนอื่นจองไปแล้ว ให้เอาออกจากตะกร้าเงียบ ๆ
    const stillAvailable = data.rows
      .flatMap((row) => row.seats)
      .filter((seat) => seat.status === 'AVAILABLE')
      .map((seat) => seat.id);
    keepOnly(stillAvailable);
    return data;
  }, [showtimeId, keepOnly]);

  // กลับมาหน้านี้ทั้งที่ใบเดิมของรอบนี้ยังไม่จ่าย — เปิดกล่องให้เลือกตั้งแต่เปิดหน้า
  // ไม่ต้องให้เลือกที่นั่งใหม่จนกดยืนยันแล้วค่อยเจอ 409 PENDING_BOOKING_EXISTS (server ยังเป็นด่านจริงอยู่)
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let ignore = false;
    listMyBookings('upcoming')
      .then(({ data }) => {
        // เงื่อนไขเดียวกับ assertCanHoldMoreSeats ฝั่ง server — holdSecondsLeft นับด้วยนาฬิกา server
        const unpaid = data.bookings.find(
          (booking) =>
            booking.status === 'PENDING_PAYMENT' &&
            booking.holdSecondsLeft > 0 &&
            booking.showtime.id === showtimeId,
        );
        if (!ignore && unpaid) {
          setPendingBooking({
            bookingId: unpaid.id,
            seats: (unpaid.seats ?? []).map((seat) => seat.label),
          });
        }
      })
      .catch(() => {
        // เช็กไม่สำเร็จก็ไม่เป็นไร กดยืนยันแล้ว server ตอบ 409 ให้เปิดกล่องเดิมอยู่ดี
      });
    return () => {
      ignore = true;
    };
  }, [isAuthenticated, showtimeId]);

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
        await reload({ silent: true });
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
      await reload({ silent: true });
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setReleasing(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      </div>
    );
  }

  const { showtime } = seatMap;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: t('nav.home'), to: '/' },
          { label: pick(showtime.movie, 'title'), to: `/movies/${showtime.movie.id}` },
          { label: t('seats.title') },
        ]}
      />

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

        <Button variant="ghost" size="sm" onClick={() => reload({ silent: true })}>
          <RefreshCw size={14} /> {t('seats.refreshMap')}
        </Button>
      </div>

      <SeatMap rows={seatMap.rows} selectedIds={selected} onToggle={handleToggle} disabled={submitting} />

      <div className="mt-4">
        <SeatLegend prices={seatMap.prices} />
      </div>

      {/* แถบสรุปติดขอบล่าง — ราคาต้องอัปเดตทันทีที่แตะที่นั่ง ตามที่ผลสำรวจระบุ */}
      <BottomBar>
        <div className="min-w-0">
          {/* มือถือวางป้ายกับรายการที่นั่งบรรทัดเดียวกัน แถบจะเตี้ยลงและบังผังน้อยลง */}
          <div className="flex items-baseline gap-2 sm:block">
            <p className="shrink-0 text-sm text-muted">
              {t('seats.selectedSeats')} ({selected.length}/{MAX_SEATS})
            </p>
            <p className="min-w-0 truncate font-semibold">
              {selectedSeats.length > 0 ? seatLabels(selectedSeats) : '—'}
            </p>
          </div>
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
      </BottomBar>

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
