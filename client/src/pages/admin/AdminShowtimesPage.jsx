import { useEffect, useState } from 'react';
import { Ban, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { cancelShowtime, deleteShowtime, listMovies, listShowtimes, listTheatres } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import ShowtimeFormModal from '../../components/admin/ShowtimeFormModal.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import useApi from '../../hooks/useApi.js';
import { bangkokDateKey, formatDateTime, formatMoney, formatTime, toBangkokInputValue } from '../../utils/format.js';

const AdminShowtimesPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [movies, setMovies] = useState([]);
  const [theatres, setTheatres] = useState([]);
  const [date, setDate] = useState(bangkokDateKey());
  // หน้าต่างเพิ่ม/แก้รอบ — { id: 'new' | showtimeId, form } · null = ปิดอยู่
  const [formSeed, setFormSeed] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  // ยกเลิกรอบที่มีคนจ่ายแล้ว = งานคืนเงินเพิ่ม ป้ายบนเมนูต้องขยับตามทันที
  const refreshCounts = useAdminQueueStore((store) => store.refresh);

  const activeTheatres = theatres.filter((theatre) => theatre.isActive);

  const { data: showtimes = [], loading, error, reload } = useApi(
    () => listShowtimes({ date }).then(({ data }) => data.showtimes),
    [date],
  );

  useEffect(() => {
    Promise.all([listMovies(), listTheatres()])
      .then(([moviesRes, theatresRes]) => {
        setMovies(moviesRes.data.movies.filter((movie) => movie.status !== 'ARCHIVED'));
        setTheatres(theatresRes.data.theatres);
      })
      .catch(() => {
        /* ฟอร์มจะว่างเปล่า แต่หน้ารายการยังใช้ได้ */
      });
  }, []);

  const openCreate = () => {
    setFormSeed({
      id: 'new',
      form: {
        movieId: movies[0]?.id ?? '',
        theatreId: activeTheatres[0]?.id ?? '',
        startsAt: `${date}T19:00`,
        basePrice: 200,
      },
    });
  };

  const openEdit = (showtime) => {
    setFormSeed({
      id: showtime.id,
      form: {
        movieId: showtime.movieId,
        theatreId: showtime.theatre.id,
        originalTheatreId: showtime.theatre.id,
        startsAt: toBangkokInputValue(showtime.startsAt),
        basePrice: showtime.basePrice,
      },
    });
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteShowtime(deleteTarget.id);
      toast.success(t('common.delete'));
      setDeleteTarget(null);
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setDeleting(false);
    }
  };

  const openCancel = (showtime) => {
    setCancelReason('');
    setCancelTarget(showtime);
  };

  const confirmCancel = async () => {
    setCancelling(true);
    try {
      const { data } = await cancelShowtime(cancelTarget.id, cancelReason.trim());
      toast.success(
        t('admin.showtimeForm.cancelledToast', {
          count: data.cancelledBookings,
          refunds: data.refundsQueued,
        }),
      );
      setCancelTarget(null);
      reload();
      refreshCounts();
    } catch (error) {
      // เช่น ยังมีสลิปรอตรวจ — ข้อความจาก server บอกจำนวนและสิ่งที่ต้องทำก่อน
      toast.error(apiError(error).message);
    } finally {
      setCancelling(false);
    }
  };

  /** ยกเลิกได้จนกว่ารอบจะฉายจบ — รอบที่ฉายจบแล้วไม่มีอะไรให้ยกเลิก */
  const canCancelShowtime = (showtime) =>
    showtime.status === 'SCHEDULED' && new Date(showtime.endsAt).getTime() > Date.now();

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('admin.showtimes')}</h1>
        {/* มือถือช่องวันที่ยืดเต็มแถวข้างปุ่มเพิ่ม จอใหญ่กว้างเท่าที่ต้องใช้ */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-w-0 flex-1 sm:w-auto sm:flex-none"
          />
          <Button onClick={openCreate} disabled={movies.length === 0 || activeTheatres.length === 0}>
            <Plus size={16} /> {t('common.create')}
          </Button>
        </div>
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          {/* จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด */}
          <table className="stack-table w-full min-w-180 text-sm sm:text-base">
            <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.startsAt')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.movie')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.theatre')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.basePrice')}</th>
                <th className="px-4 py-3 font-medium">{t('seats.available')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {showtimes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {t('movie.noShowtimes')}
                  </td>
                </tr>
              )}
              {showtimes.map((showtime) => (
                <tr
                  key={showtime.id}
                  className={clsx(
                    'border-b border-line/60 last:border-0',
                    showtime.status === 'CANCELLED' && 'text-muted',
                  )}
                >
                  <td className="px-4 py-3 font-semibold">
                    {formatTime(showtime.startsAt, lang)} – {formatTime(showtime.endsAt, lang)}
                    {showtime.status === 'CANCELLED' && (
                      <StatusBadge
                        status="CANCELLED"
                        label={t('admin.showtimeForm.statusCancelled')}
                        className="ml-2 align-middle"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3" data-label={t('admin.showtimeForm.movie')}>
                    {pick(showtime.movie, 'title')}
                  </td>
                  <td className="px-4 py-3 text-muted" data-label={t('admin.showtimeForm.theatre')}>
                    {showtime.theatre.name}
                    <span className="ml-1 text-xs">({showtime.theatre.screenType})</span>
                  </td>
                  <td className="px-4 py-3 text-muted" data-label={t('admin.showtimeForm.basePrice')}>
                    {formatMoney(showtime.basePrice, lang)}
                    <span className="ml-1 text-xs">
                      / {formatMoney(showtime.prices.PREMIUM, lang)} / {formatMoney(showtime.prices.SOFA, lang)}
                    </span>
                  </td>
                  <td className="px-4 py-3" data-label={t('seats.available')}>
                    <span className={showtime.availableSeats === 0 ? 'text-danger' : 'text-success'}>
                      {showtime.availableSeats}
                    </span>
                    <span className="text-muted"> / {showtime.totalSeats}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {showtime.status === 'SCHEDULED' && (
                        <Button variant="ghost" size="sm" title={t('common.edit')} onClick={() => openEdit(showtime)}>
                          <Pencil size={14} />
                        </Button>
                      )}
                      {canCancelShowtime(showtime) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('admin.showtimeForm.cancelAction')}
                          onClick={() => openCancel(showtime)}
                        >
                          <Ban size={14} className="text-accent" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('common.delete')}
                        onClick={() => setDeleteTarget(showtime)}
                      >
                        <Trash2 size={14} className="text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formSeed && (
        <ShowtimeFormModal
          showtimeId={formSeed.id}
          initialForm={formSeed.form}
          movies={movies}
          theatres={theatres}
          onClose={() => setFormSeed(null)}
          onSaved={() => {
            setFormSeed(null);
            reload();
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.showtimeForm.deleteTitle')}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onConfirm={remove}
      >
        {deleteTarget && (
          <p className="text-sm text-muted">
            {t('admin.showtimeForm.deleteBody', {
              time: formatDateTime(deleteTarget.startsAt, lang),
              movie: pick(deleteTarget.movie, 'title'),
              theatre: deleteTarget.theatre.name,
            })}
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('admin.showtimeForm.cancelTitle')}
        cancelLabel={t('common.back')}
        confirmLabel={t('admin.showtimeForm.cancelConfirm')}
        loading={cancelling}
        onConfirm={confirmCancel}
      >
        {cancelTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">
              {t('admin.showtimeForm.cancelBody', {
                time: formatDateTime(cancelTarget.startsAt, lang),
                movie: pick(cancelTarget.movie, 'title'),
                theatre: cancelTarget.theatre.name,
              })}
            </p>
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {t('admin.showtimeForm.cancelEffects')}
            </p>
            <Field label={t('admin.showtimeForm.cancelReason')}>
              <Textarea
                value={cancelReason}
                maxLength={200}
                placeholder={t('admin.showtimeForm.cancelReasonPlaceholder')}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </Field>
          </div>
        )}
      </ConfirmModal>
    </div>
  );
};

export default AdminShowtimesPage;
