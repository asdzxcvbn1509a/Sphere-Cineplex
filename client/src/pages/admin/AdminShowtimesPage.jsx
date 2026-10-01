import { useCallback, useEffect, useState } from 'react';
import { Ban, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import {
  cancelShowtime,
  createShowtime,
  deleteShowtime,
  getShowtimeAvailability,
  listMovies,
  listShowtimes,
  listTheatres,
  updateShowtime,
} from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import { bangkokDateKey, formatDateTime, formatMoney, formatTime } from '../../utils/format.js';

/** input[type=datetime-local] ทำงานบนเวลาเครื่อง จึงต้องแปลงเป็น/จากเวลาไทยให้ชัดเจน */
const toLocalInputValue = (iso) => {
  const bangkok = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 16);
};

const fromBangkokInputValue = (value) => new Date(`${value}:00+07:00`).toISOString();

/** ดึงเฉพาะส่วนวันที่ (YYYY-MM-DD) ออกจากค่าใน input datetime-local */
const dateOfInputValue = (value) => (value ? value.slice(0, 10) : '');

const AdminShowtimesPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [showtimes, setShowtimes] = useState([]);
  const [movies, setMovies] = useState([]);
  const [theatres, setTheatres] = useState([]);
  const [date, setDate] = useState(bangkokDateKey());
  const [state, setState] = useState({ loading: true, error: null });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ movieId: '', theatreId: '', startsAt: '', basePrice: 200 });
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  // ยกเลิกรอบที่มีคนจ่ายแล้ว = งานคืนเงินเพิ่ม ป้ายบนเมนูต้องขยับตามทันที
  const refreshCounts = useAdminQueueStore((store) => store.refresh);

  // โรงที่ปิดใช้งานลงรอบใหม่ไม่ได้ แต่ตอนแก้รอบเดิมที่อยู่ในโรงนั้นต้องยังเห็นโรงเดิมในรายการ
  // ไม่งั้น select จะเด้งไปโรงแรกเอง แล้วกดบันทึกกลายเป็นย้ายรอบโดยไม่ได้ตั้งใจ
  const theatreOptions = theatres.filter(
    (theatre) => theatre.isActive || theatre.id === form.originalTheatreId,
  );
  const activeTheatres = theatres.filter((theatre) => theatre.isActive);

  /**
   * ถามเซิร์ฟเวอร์ว่าโรงนี้ในวันนี้เหลือช่วงไหนให้ลงรอบใหม่ได้บ้าง
   * ยิงใหม่ทุกครั้งที่เปลี่ยนหนัง โรง หรือวัน เพราะทั้งสามอย่างมีผลต่อการชนกัน
   * (หนังยาวไม่เท่ากัน โรงคนละโรงไม่ชนกัน คนละวันก็คนละตาราง)
   */
  useEffect(() => {
    const formDate = dateOfInputValue(form.startsAt);
    if (!editing || !form.movieId || !form.theatreId || !formDate) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    getShowtimeAvailability({
      movieId: form.movieId,
      theatreId: form.theatreId,
      date: formDate,
      ...(editing !== 'new' && { excludeId: editing }),
    })
      .then(({ data }) => !cancelled && setAvailability(data))
      .catch(() => !cancelled && setAvailability(null));
    return () => {
      cancelled = true;
    };
  }, [editing, form.movieId, form.theatreId, form.startsAt]);

  /** เวลาที่เลือกอยู่ชนกับรอบไหนหรือไม่ — ใช้ค่ากฎ (buffer, ความยาว) ที่ server ส่งมา */
  const conflict = (() => {
    if (!availability || !form.startsAt) return null;
    const startMs = new Date(fromBangkokInputValue(form.startsAt)).getTime();
    if (Number.isNaN(startMs)) return null;
    const endMs = startMs + availability.durationMin * 60 * 1000;
    const bufferMs = availability.turnaroundMinutes * 60 * 1000;
    return (
      availability.busy.find(
        (item) =>
          new Date(item.startsAt).getTime() < endMs + bufferMs &&
          new Date(item.endsAt).getTime() > startMs - bufferMs,
      ) ?? null
    );
  })();

  const load = useCallback(() => {
    setState({ loading: true, error: null });
    listShowtimes({ date })
      .then(({ data }) => {
        setShowtimes(data.showtimes);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [date]);

  useEffect(load, [load]);

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
    setForm({
      movieId: movies[0]?.id ?? '',
      theatreId: activeTheatres[0]?.id ?? '',
      startsAt: `${date}T19:00`,
      basePrice: 200,
    });
    setEditing('new');
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        startsAt: fromBangkokInputValue(form.startsAt),
        basePrice: Number(form.basePrice),
        ...(editing === 'new' && { movieId: form.movieId }),
        theatreId: form.theatreId,
      };
      if (editing === 'new') await createShowtime(payload);
      else await updateShowtime(editing, payload);
      toast.success(t('common.save'));
      setEditing(null);
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteShowtime(deleteTarget.id);
      toast.success(t('common.delete'));
      setDeleteTarget(null);
      load();
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
      load();
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

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('admin.showtimes')}</h1>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-auto"
          />
          <Button onClick={openCreate} disabled={movies.length === 0 || activeTheatres.length === 0}>
            <Plus size={16} /> {t('common.create')}
          </Button>
        </div>
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-180 text-sm sm:text-base">
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
                  <td className="px-4 py-3">
                    {lang === 'en' ? showtime.movie.titleEn : showtime.movie.titleTh}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {showtime.theatre.name}
                    <span className="ml-1 text-xs">({showtime.theatre.screenType})</span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatMoney(showtime.basePrice, lang)}
                    <span className="ml-1 text-xs">
                      / {formatMoney(showtime.prices.PREMIUM, lang)} / {formatMoney(showtime.prices.SOFA, lang)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={showtime.availableSeats === 0 ? 'text-danger' : 'text-success'}>
                      {showtime.availableSeats}
                    </span>
                    <span className="text-muted"> / {showtime.totalSeats}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {showtime.status === 'SCHEDULED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('common.edit')}
                          onClick={() => {
                            setForm({
                              movieId: showtime.movieId,
                              theatreId: showtime.theatre.id,
                              originalTheatreId: showtime.theatre.id,
                              startsAt: toLocalInputValue(showtime.startsAt),
                              basePrice: showtime.basePrice,
                            });
                            setEditing(showtime.id);
                          }}
                        >
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

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing === 'new' ? t('admin.showtimeForm.createTitle') : t('admin.showtimeForm.editTitle')
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            {/* กันไว้ตั้งแต่ต้นทาง ไม่ต้องรอให้ server ตอบ 409 */}
            <Button form="showtime-form" type="submit" loading={saving} disabled={Boolean(conflict)}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <form id="showtime-form" onSubmit={save} className="flex flex-col gap-4">
          <Field label={t('admin.showtimeForm.movie')} required>
            <Select value={form.movieId} onChange={setField('movieId')} disabled={editing !== 'new'} required>
              {movies.map((movie) => (
                <option key={movie.id} value={movie.id}>
                  {lang === 'en' ? movie.titleEn : movie.titleTh} ({movie.durationMin} {t('movie.minutesUnit')})
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('admin.showtimeForm.theatre')} required>
            <Select value={form.theatreId} onChange={setField('theatreId')} required>
              {theatreOptions.map((theatre) => (
                <option key={theatre.id} value={theatre.id}>
                  {theatre.name} · {theatre.seatCount} {t('common.seat')}
                  {!theatre.isActive && ` (${t('admin.showtimeForm.theatreInactive')})`}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`${t('admin.showtimeForm.startsAt')} (UTC+7)`}
            required
            error={
              conflict
                ? t('admin.showtimeForm.conflictWith', {
                    movie: lang === 'en' ? conflict.movie.titleEn : conflict.movie.titleTh,
                    from: formatTime(conflict.startsAt, lang),
                    to: formatTime(conflict.endsAt, lang),
                  })
                : undefined
            }
          >
            <Input type="datetime-local" value={form.startsAt} onChange={setField('startsAt')} required />
          </Field>

          {availability && (
            <div className="-mt-2 flex flex-col gap-4 rounded-xl border border-line bg-surface-2/50 p-3">
              {/* รอบที่มีอยู่แล้วในโรงนี้วันนี้ ให้เห็นภาพว่าเวลาไหนถูกจองไปแล้ว */}
              <div>
                <p className="mb-1.5 text-sm font-medium text-muted">
                  {t('admin.showtimeForm.busyInTheatre')}
                </p>
                {availability.busy.length === 0 ? (
                  <p className="text-sm text-success">{t('admin.showtimeForm.noBusy')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {availability.busy.map((item) => (
                      <span
                        key={item.id}
                        className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger"
                        title={lang === 'en' ? item.movie.titleEn : item.movie.titleTh}
                      >
                        {formatTime(item.startsAt, lang)}–{formatTime(item.endsAt, lang)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* เวลาที่ลงรอบได้จริง คำนวณจากความยาวหนัง + เวลาเว้นระหว่างรอบ */}
              <div>
                <p className="mb-1.5 text-sm font-medium text-muted">
                  {t('admin.showtimeForm.freeSlots', {
                    minutes: availability.turnaroundMinutes,
                  })}
                </p>
                {availability.freeSlots.length === 0 ? (
                  <p className="text-sm text-danger">{t('admin.showtimeForm.noFreeSlot')}</p>
                ) : (
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {availability.freeSlots.map((slot) => {
                      const value = toLocalInputValue(slot);
                      const active = form.startsAt === value;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, startsAt: value }))}
                          className={
                            active
                              ? 'rounded-md border border-accent bg-accent px-2 py-1 text-xs font-semibold text-ink'
                              : 'rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg transition hover:border-accent hover:text-accent'
                          }
                        >
                          {formatTime(slot, lang)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <Field label={t('admin.showtimeForm.basePrice')} hint={t('admin.showtimeForm.priceHint')} required>
            <Input type="number" min={1} max={5000} value={form.basePrice} onChange={setField('basePrice')} required />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.showtimeForm.deleteTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={deleting} onClick={remove}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <p className="text-sm text-muted">
            {t('admin.showtimeForm.deleteBody', {
              time: formatDateTime(deleteTarget.startsAt, lang),
              movie: lang === 'en' ? deleteTarget.movie.titleEn : deleteTarget.movie.titleTh,
              theatre: deleteTarget.theatre.name,
            })}
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('admin.showtimeForm.cancelTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {t('common.back')}
            </Button>
            <Button variant="danger" loading={cancelling} onClick={confirmCancel}>
              {t('admin.showtimeForm.cancelConfirm')}
            </Button>
          </>
        }
      >
        {cancelTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">
              {t('admin.showtimeForm.cancelBody', {
                time: formatDateTime(cancelTarget.startsAt, lang),
                movie: lang === 'en' ? cancelTarget.movie.titleEn : cancelTarget.movie.titleTh,
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
      </Modal>
    </div>
  );
};

export default AdminShowtimesPage;
