import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiError } from '../../api/client.js';
import { createMovie, deleteMovie, listMovies, updateMovie } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { formatDate } from '../../utils/format.js';

const emptyMovie = {
  titleTh: '',
  titleEn: '',
  synopsisTh: '',
  synopsisEn: '',
  posterUrl: '',
  backdropUrl: '',
  durationMin: 120,
  rating: 'G',
  genres: '',
  releaseDate: new Date().toISOString().slice(0, 10),
  status: 'NOW_SHOWING',
};

const AdminMoviesPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [movies, setMovies] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMovie);
  const [saving, setSaving] = useState(false);

  // ขั้นตอนการลบ: movie = เรื่องที่จะลบ, blocked = ข้อมูลการจองที่ค้างอยู่ (ถ้ามี)
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const titleOf = (movie) => (lang === 'en' ? movie.titleEn : movie.titleTh);

  const load = () => {
    setState({ loading: true, error: null });
    listMovies()
      .then(({ data }) => {
        setMovies(data.movies);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  };

  useEffect(load, []);

  const openCreate = () => {
    setForm(emptyMovie);
    setEditing('new');
  };

  const openEdit = (movie) => {
    setForm({
      ...movie,
      backdropUrl: movie.backdropUrl ?? '',
      genres: movie.genres.join(', '),
      releaseDate: movie.releaseDate.slice(0, 10),
    });
    setEditing(movie.id);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      durationMin: Number(form.durationMin),
      genres: form.genres
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean),
    };
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;
    delete payload.availableDates;

    try {
      if (editing === 'new') await createMovie(payload);
      else await updateMovie(editing, payload);
      toast.success(t('common.save'));
      setEditing(null);
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  /** force = true เมื่อผู้ดูแลยืนยันแล้วว่ายอมให้ประวัติการจองหายไปด้วย */
  const remove = async ({ force = false } = {}) => {
    setDeleting(true);
    try {
      await deleteMovie(deleteTarget.movie.id, { force });
      toast.success(`${t('common.delete')}: ${titleOf(deleteTarget.movie)}`);
      setDeleteTarget(null);
      load();
    } catch (error) {
      const problem = apiError(error);
      // มีการจองค้างอยู่ — ยังไม่ลบให้ แต่เปิดตัวเลือกให้ตัดสินใจ
      if (problem.code === 'MOVIE_HAS_BOOKINGS') {
        setDeleteTarget((current) => ({ ...current, blocked: problem.details }));
      } else {
        toast.error(problem.message);
      }
    } finally {
      setDeleting(false);
    }
  };

  /** ทางเลือกที่ปลอดภัยกว่า: เก็บเข้าคลังแทนการลบ ประวัติการจองยังอยู่ครบ */
  const archiveInstead = async () => {
    setDeleting(true);
    try {
      await updateMovie(deleteTarget.movie.id, { status: 'ARCHIVED' });
      toast.success(t('admin.movieForm.archivedInstead'));
      setDeleteTarget(null);
      load();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setDeleting(false);
    }
  };

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('admin.movies')}</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> {t('common.create')}
        </Button>
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-180 text-sm sm:text-base">
            <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.movieForm.titleTh')}</th>
                <th className="px-4 py-3 font-medium">{t('movie.duration')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.movieForm.genres')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.movieForm.releaseDate')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {movies.map((movie) => (
                <tr key={movie.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img src={movie.posterUrl} alt="" className="h-16 w-11 rounded object-cover" />
                      <div>
                        <p className="font-medium">{movie.titleTh}</p>
                        <p className="text-xs text-muted">{movie.titleEn}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{movie.durationMin} {t('movie.minutesUnit')}</td>
                  <td className="px-4 py-3 text-muted">{movie.genres.join(', ')}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(movie.releaseDate, lang)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={movie.status} label={t(`admin.movieStatus.${movie.status}`)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(movie)}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ movie, blocked: null })}
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
        title={editing === 'new' ? t('admin.movieForm.createTitle') : t('admin.movieForm.editTitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button form="movie-form" type="submit" loading={saving}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <form id="movie-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.movieForm.titleTh')} required>
            <Input value={form.titleTh} onChange={setField('titleTh')} required />
          </Field>
          <Field label={t('admin.movieForm.titleEn')} required>
            <Input value={form.titleEn} onChange={setField('titleEn')} required />
          </Field>

          <Field label={t('admin.movieForm.synopsisTh')} className="sm:col-span-2">
            <Textarea value={form.synopsisTh} onChange={setField('synopsisTh')} />
          </Field>
          <Field label={t('admin.movieForm.synopsisEn')} className="sm:col-span-2">
            <Textarea value={form.synopsisEn} onChange={setField('synopsisEn')} />
          </Field>

          <Field label={t('admin.movieForm.posterUrl')} required className="sm:col-span-2">
            <Input type="url" value={form.posterUrl} onChange={setField('posterUrl')} required />
          </Field>
          <Field label={t('admin.movieForm.backdropUrl')} className="sm:col-span-2">
            <Input type="url" value={form.backdropUrl} onChange={setField('backdropUrl')} />
          </Field>

          <Field label={t('admin.movieForm.durationMin')} required>
            <Input
              type="number"
              min={30}
              max={400}
              value={form.durationMin}
              onChange={setField('durationMin')}
              required
            />
          </Field>
          <Field label={t('admin.movieForm.rating')}>
            <Select value={form.rating} onChange={setField('rating')}>
              {['G', 'PG13', 'N15', 'N18'].map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('admin.movieForm.genres')} className="sm:col-span-2">
            <Input value={form.genres} onChange={setField('genres')} placeholder="ดราม่า, ลึกลับ" />
          </Field>

          <Field label={t('admin.movieForm.releaseDate')} required>
            <Input type="date" value={form.releaseDate} onChange={setField('releaseDate')} required />
          </Field>
          <Field label={t('admin.movieForm.status')}>
            <Select value={form.status} onChange={setField('status')}>
              {['NOW_SHOWING', 'COMING_SOON', 'ARCHIVED'].map((status) => (
                <option key={status} value={status}>
                  {t(`admin.movieStatus.${status}`)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      {/*
        การลบมีสองขั้น
        ขั้นแรก: ยืนยันธรรมดา — ถ้าเรื่องนั้นไม่มีการจอง ลบได้เลย
        ขั้นสอง: เจอ 409 ว่ามีการจองค้าง จึงเสนอสองทางเลือกให้ตัดสินใจเอง
                 เก็บเข้าคลัง (ประวัติอยู่ครบ) หรือลบถาวร (ประวัติหายไปด้วย)
      */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={
          deleteTarget?.blocked
            ? t('admin.movieForm.deleteBlockedTitle')
            : t('admin.movieForm.deleteTitle')
        }
        size="sm"
        footer={
          deleteTarget?.blocked ? (
            <>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="secondary" loading={deleting} onClick={archiveInstead}>
                {t('admin.movieForm.archiveAction')}
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => remove({ force: true })}>
                {t('admin.movieForm.forceDeleteAction')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => remove()}>
                {t('common.delete')}
              </Button>
            </>
          )
        }
      >
        {deleteTarget?.blocked ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              {t('admin.movieForm.deleteBlockedBody', {
                title: titleOf(deleteTarget.movie),
                bookings: deleteTarget.blocked.bookingCount,
                showtimes: deleteTarget.blocked.showtimeCount,
              })}
            </p>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
              <p className="mb-1">
                <span className="font-semibold text-fg">
                  {t('admin.movieForm.archiveAction')}
                </span>{' '}
                — {t('admin.movieForm.archiveExplain')}
              </p>
              <p>
                <span className="font-semibold text-danger">
                  {t('admin.movieForm.forceDeleteAction')}
                </span>{' '}
                — {t('admin.movieForm.forceDeleteExplain')}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {t('admin.movieForm.deleteBody', { title: deleteTarget && titleOf(deleteTarget.movie) })}
          </p>
        )}
      </Modal>
    </div>
  );
};

export default AdminMoviesPage;
