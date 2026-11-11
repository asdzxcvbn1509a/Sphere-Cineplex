import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
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
import Pagination from '../../components/ui/Pagination.jsx';
import { FIT_BODY, FIT_CARD, FIT_PAGE, FIT_PAGER } from '../../components/admin/fitLayout.js';
import useApi from '../../hooks/useApi.js';
import useFitPageSize from '../../hooks/useFitPageSize.js';
import { formatDate } from '../../utils/format.js';
import { slicePage } from '../../utils/pagination.js';

/**
 * ระยะต่อแถวบนจอ xl = xl:h-23 (92px — โปสเตอร์ 64px + ระยะบนล่าง) — เปลี่ยนคู่กับ class ของแถว
 * เส้นคั่นแถวรวมอยู่ในความสูงนี้แล้ว (border-collapse)
 */
/** หัวหมวดในฟอร์มภาพยนตร์ — ตัวเล็กสีทอง เต็มแถวของกริด */
const SECTION_TITLE = 'col-span-full text-caption font-semibold text-gold-50';
const ROW_HEIGHT = 92;

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
  const { t, lang, pick, genre } = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
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

  // แบ่งหน้าฝั่งเว็บจากผลค้นหา — จอใหญ่หน้าละเท่าที่วางพอดีจอ ทั้งหน้าไม่ต้องเลื่อน
  const fit = useFitPageSize(ROW_HEIGHT);
  const paged = slicePage(filtered, page, fit.pageSize);
  // โหลดครั้งแรก = ยังไม่มีอะไรให้ดู · โหลดซ้ำหลังบันทึก/ลบ คงตารางเดิมไว้แค่หรี่ลง
  const showSpinner = loading && movies.length === 0;

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
    <div className={FIT_PAGE}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('admin.movies')}</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> {t('common.create')}
        </Button>
      </div>

      <Field label={t('common.search')} className="mb-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-field-muted"
            size={15}
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t('home.searchPlaceholder')}
            className="pl-9"
          />
        </div>
      </Field>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : (
        // แบ่งหน้าอยู่ท้ายการ์ดเดียวกับตาราง — overflow-hidden ตัดมุมแถบท้ายให้โค้งตามการ์ด
        <div className={FIT_CARD}>
          <div ref={fit.ref} className={FIT_BODY}>
            {/*
              จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด
              จอ xl ความกว้างคอลัมน์ตายตัว (table-fixed) ชื่อเรื่องกับหมวดหมู่ที่ยาวตัดด้วย … ทุกแถวจึงสูงเท่ากัน
            */}
            <table className="stack-table w-full min-w-180 text-body-2 sm:text-body-1 xl:table-fixed">
              <thead className="border-b border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('admin.movieForm.titleTh')}</th>
                  <th className="px-4 py-3 font-medium xl:w-28">{t('movie.duration')}</th>
                  <th className="px-4 py-3 font-medium xl:w-56">{t('admin.movieForm.genres')}</th>
                  <th className="px-4 py-3 font-medium xl:w-36">{t('admin.movieForm.releaseDate')}</th>
                  <th className="px-4 py-3 font-medium xl:w-44">{t('common.status')}</th>
                  <th className="px-4 py-3 text-right font-medium xl:w-28">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody
                aria-busy={loading || undefined}
                className={clsx('transition', loading && !showSpinner && 'opacity-60')}
              >
                {showSpinner && (
                  <tr>
                    <td colSpan={6}>
                      <LoadingBlock label={t('common.loading')} />
                    </td>
                  </tr>
                )}
                {!showSpinner && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted">
                      {query.trim() ? t('home.noResults') : t('common.empty')}
                    </td>
                  </tr>
                )}
                {!showSpinner &&
                  paged.items.map((movie) => (
                    <tr key={movie.id} className="border-b border-line/60 last:border-0 xl:h-23">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img src={movie.posterUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
                          {/* min-w-0 ให้ชื่อหดลงจนตัดด้วย … ได้ ไม่ดันคอลัมน์ */}
                          <div className="min-w-0">
                            <p className="font-medium xl:truncate" title={movie.titleTh}>
                              {movie.titleTh}
                            </p>
                            <p className="text-caption text-muted xl:truncate" title={movie.titleEn}>
                              {movie.titleEn}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted xl:truncate" data-label={t('movie.duration')}>
                        {movie.durationMin} {t('movie.minutesUnit')}
                      </td>
                      <td
                        className="px-4 py-3 text-muted xl:truncate"
                        data-label={t('admin.movieForm.genres')}
                        title={movie.genres.map(genre).join(', ')}
                      >
                        {movie.genres.map(genre).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-muted xl:truncate" data-label={t('admin.movieForm.releaseDate')}>
                        {formatDate(movie.releaseDate, lang)}
                      </td>
                      <td className="px-4 py-3" data-label={t('common.status')}>
                        <StatusBadge status={movie.status} label={t(`admin.movieStatus.${movie.status}`)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1 xl:flex-nowrap">
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

          {/* ซ่อนตัวเองเมื่อมีหน้าเดียว — จอ xl กันที่ไว้แม้ตอนซ่อน กล่องตารางจะได้ไม่ยืดหดจนจำนวนแถวต่อหน้าเปลี่ยนตาม */}
          <Pagination
            numbered
            reserveSpace={fit.active}
            className={FIT_PAGER}
            page={paged.page}
            pageSize={fit.pageSize}
            total={filtered.length}
            onChange={setPage}
          />
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
              {t('admin.bookingPage.cancelBack')}
            </Button>
            <Button form="movie-form" type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {/*
          แบ่งเป็นสามหมวด (ข้อมูลหลัก · รายละเอียดการฉาย · รูปภาพ) หัวหมวดสีทอง คั่นด้วยเส้น
          ช่องกรอกพื้นครีมขอบทอง หัวช่องตัวอ่อน — ปรับผ่าน selector ของฟอร์ม ช่องกรอกหน้าอื่นไม่เปลี่ยน
          เรตไม่มีในฟอร์มแล้ว (เว็บไม่แสดงเรต) — ค่าเดิมของเรื่องยังส่งกลับไปตามเดิม
        */}
        <form
          id="movie-form"
          onSubmit={save}
          className="flex flex-col gap-6 [&_.input-base]:border-gold-50 [&_label>span:first-child]:text-fg!"
        >
          <section className="grid gap-4 sm:grid-cols-2">
            <h3 className={SECTION_TITLE}>{t('admin.movieForm.sectionMain')}</h3>
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
          </section>

          <section className="grid gap-4 border-t border-cream-40 pt-6 sm:grid-cols-3">
            <h3 className={SECTION_TITLE}>{t('admin.movieForm.sectionShow')}</h3>
            <Field label={t('admin.movieForm.durationMin')} required>
              <Input
                type="number"
                min={30}
                max={400}
                value={form.durationMin}
                onChange={setField('durationMin')}
                placeholder={t('admin.movieForm.durationPlaceholder')}
                required
              />
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
            <Field label={t('admin.movieForm.genres')} className="sm:col-span-3">
              <Input value={form.genres} onChange={setField('genres')} placeholder={t('admin.movieForm.genresPlaceholder')} />
            </Field>
          </section>

          <section className="grid gap-4 border-t border-cream-40 pt-6">
            <h3 className={SECTION_TITLE}>{t('admin.movieForm.sectionImages')}</h3>
            <Field label={t('admin.movieForm.posterUrl')} required>
              <Input type="url" value={form.posterUrl} onChange={setField('posterUrl')} placeholder="https://..." required />
            </Field>
            <Field label={t('admin.movieForm.backdropUrl')}>
              <Input type="url" value={form.backdropUrl} onChange={setField('backdropUrl')} placeholder="https://..." />
            </Field>
          </section>
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
                {t('admin.bookingPage.cancelBack')}
              </Button>
              <Button variant="dangerBright" loading={deleting} onClick={() => remove()}>
                {t('common.delete')}
              </Button>
            </>
          )
        }
      >
        {deleteTarget?.blocked ? (
          <div className="flex flex-col gap-3 text-body-2">
            <p className="text-muted">
              {t('admin.movieForm.deleteBlockedBody', {
                title: pick(deleteTarget.movie, 'title'),
                bookings: deleteTarget.blocked.bookingCount,
                showtimes: deleteTarget.blocked.showtimeCount,
              })}
            </p>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-caption text-muted">
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
          // ชื่อเรื่องสีทอง เห็นชัดว่ากำลังจะลบเรื่องไหน
          <p className="text-body-1">
            {t('admin.movieForm.deleteBodyBefore')}{' '}
            <span className="text-gold-50">{deleteTarget && pick(deleteTarget.movie, 'title')}</span>{' '}
            {t('admin.movieForm.deleteBodyAfter')}
          </p>
        )}
      </Modal>
    </div>
  );
};

export default AdminMoviesPage;
