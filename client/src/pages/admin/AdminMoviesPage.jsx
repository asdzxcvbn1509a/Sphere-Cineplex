import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import useApi from '../../hooks/useApi.js';
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
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMovie);
  const [saving, setSaving] = useState(false);

  // ขั้นตอนการลบ: movie = เรื่องที่จะลบ, blocked = ข้อมูลการจองที่ค้างอยู่ (ถ้ามี)
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { data: movies = [], loading, error, reload } = useApi(
    () => listMovies().then(({ data }) => data.movies),
    [],
  );

  // ได้หนังครบทุกเรื่องมาอยู่แล้ว จึงกรองฝั่ง client แบบหน้าแรก — ผลขึ้นทันที และคำค้นไม่หายตอน reload() หลังบันทึก/ลบ
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return movies;
    return movies.filter(
      (movie) =>
        movie.titleTh.toLowerCase().includes(keyword) ||
        movie.titleEn.toLowerCase().includes(keyword),
    );
  }, [movies, query]);

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
      reload();
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
      toast.success(`${t('common.delete')}: ${pick(deleteTarget.movie, 'title')}`);
      setDeleteTarget(null);
      reload();
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
      reload();
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

      <Field label={t('common.search')} className="mb-4 max-w-md">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            size={15}
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            className="pl-9"
          />
        </div>
      </Field>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          {/* จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด */}
          <table className="stack-table w-full min-w-180 text-sm sm:text-base">
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {query.trim() ? t('home.noResults') : t('common.empty')}
                  </td>
                </tr>
              )}
              {filtered.map((movie) => (
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
                  <td className="px-4 py-3 text-muted" data-label={t('movie.duration')}>
                    {movie.durationMin} {t('movie.minutesUnit')}
                  </td>
                  <td className="px-4 py-3 text-muted" data-label={t('admin.movieForm.genres')}>
                    {movie.genres.join(', ')}
                  </td>
                  <td className="px-4 py-3 text-muted" data-label={t('admin.movieForm.releaseDate')}>
                    {formatDate(movie.releaseDate, lang)}
                  </td>
                  <td className="px-4 py-3" data-label={t('common.status')}>
                    <StatusBadge status={movie.status} label={t(`admin.movieStatus.${movie.status}`)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
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
                title: pick(deleteTarget.movie, 'title'),
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
            {t('admin.movieForm.deleteBody', { title: deleteTarget && pick(deleteTarget.movie, 'title') })}
          </p>
        )}
      </Modal>
    </div>
  );
};

export default AdminMoviesPage;
