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
import Pagination from '../../components/ui/Pagination.jsx';
import { FIT_BODY, FIT_CARD, FIT_PAGE, FIT_PAGER } from '../../components/admin/fitLayout.js';
import useApi from '../../hooks/useApi.js';
import useFitPageSize from '../../hooks/useFitPageSize.js';
import { bangkokDateKey, formatDateTime, formatMoney, formatTime, toBangkokInputValue } from '../../utils/format.js';
import { slicePage } from '../../utils/pagination.js';

/** ระยะต่อแถวบนจอ xl = xl:h-14 (56px) — เปลี่ยนคู่กับ class ของแถว · เส้นคั่นแถวรวมอยู่ในความสูงนี้แล้ว (border-collapse) */
const ROW_HEIGHT = 56;

const AdminShowtimesPage = () => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [movies, setMovies] = useState([]);
  const [theatres, setTheatres] = useState([]);
  const [date, setDate] = useState(bangkokDateKey());
  const [page, setPage] = useState(1);
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

  // ได้รอบของวันนั้นครบแล้ว จึงแบ่งหน้าฝั่งเว็บ — จอใหญ่หน้าละเท่าที่วางพอดีจอ ทั้งหน้าไม่ต้องเลื่อน
  const fit = useFitPageSize(ROW_HEIGHT);
  const paged = slicePage(showtimes, page, fit.pageSize);
  // โหลดครั้งแรก = ยังไม่มีอะไรให้ดู · โหลดซ้ำหลังบันทึก/ยกเลิก/ลบ คงตารางเดิมไว้แค่หรี่ลง
  const showSpinner = loading && showtimes.length === 0;

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
    <div className={FIT_PAGE}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('admin.showtimes')}</h1>
        {/* มือถือช่องวันที่ยืดเต็มแถวข้างปุ่มเพิ่ม จอใหญ่กว้างเท่าที่ต้องใช้ */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPage(1);
            }}
            className="min-w-0 flex-1 sm:w-auto sm:flex-none"
          />
          <Button onClick={openCreate} disabled={movies.length === 0 || activeTheatres.length === 0}>
            <Plus size={16} /> {t('common.create')}
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : (
        // แบ่งหน้าอยู่ท้ายการ์ดเดียวกับตาราง — overflow-hidden ตัดมุมแถบท้ายให้โค้งตามการ์ด
        <div className={FIT_CARD}>
          <div ref={fit.ref} className={FIT_BODY}>
            {/*
              จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด
              จอ xl ความกว้างคอลัมน์ตายตัว (table-fixed) ทุกช่องบรรทัดเดียว ชื่อหนังกับชื่อโรงที่ยาวตัดด้วย … ทุกแถวจึงสูงเท่ากัน
              ช่องเวลากว้างพอวางป้าย "ยกเลิกแล้ว" ต่อท้ายในบรรทัดเดียวกัน
            */}
            <table className="stack-table w-full min-w-180 text-body-2 sm:text-body-1 xl:table-fixed">
              <thead className="border-b border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium xl:w-60">{t('admin.showtimeForm.startsAt')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.movie')}</th>
                  <th className="px-4 py-3 font-medium xl:w-44">{t('admin.showtimeForm.theatre')}</th>
                  <th className="px-4 py-3 font-medium xl:w-36">{t('admin.showtimeForm.basePrice')}</th>
                  <th className="px-4 py-3 font-medium xl:w-28">{t('seats.available')}</th>
                  <th className="px-4 py-3 text-right font-medium xl:w-40">{t('common.actions')}</th>
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
                {!showSpinner && showtimes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted">
                      {t('movie.noShowtimes')}
                    </td>
                  </tr>
                )}
                {!showSpinner &&
                  paged.items.map((showtime) => (
                    <tr
                      key={showtime.id}
                      className={clsx(
                        'border-b border-line/60 last:border-0 xl:h-14',
                        showtime.status === 'CANCELLED' && 'text-muted',
                      )}
                    >
                      <td className="px-4 py-3 font-semibold xl:truncate">
                        {formatTime(showtime.startsAt, lang)} – {formatTime(showtime.endsAt, lang)}
                        {showtime.status === 'CANCELLED' && (
                          <StatusBadge
                            status="CANCELLED"
                            label={t('admin.showtimeForm.statusCancelled')}
                            className="ml-2 align-middle"
                          />
                        )}
                      </td>
                      <td
                        className="px-4 py-3 xl:truncate"
                        data-label={t('admin.showtimeForm.movie')}
                        title={pick(showtime.movie, 'title')}
                      >
                        {pick(showtime.movie, 'title')}
                      </td>
                      <td
                        className="px-4 py-3 text-muted xl:truncate"
                        data-label={t('admin.showtimeForm.theatre')}
                        title={`${showtime.theatre.name} (${showtime.theatre.screenType})`}
                      >
                        {showtime.theatre.name}
                        <span className="ml-1 text-caption">({showtime.theatre.screenType})</span>
                      </td>
                      <td className="px-4 py-3 text-muted xl:truncate" data-label={t('admin.showtimeForm.basePrice')}>
                        {formatMoney(showtime.basePrice, lang)}
                        <span className="ml-1 text-caption">
                          / {formatMoney(showtime.prices.PREMIUM, lang)} / {formatMoney(showtime.prices.SOFA, lang)}
                        </span>
                      </td>
                      <td className="px-4 py-3 xl:truncate" data-label={t('seats.available')}>
                        <span className={showtime.availableSeats === 0 ? 'text-danger' : 'text-success'}>
                          {showtime.availableSeats}
                        </span>
                        <span className="text-muted"> / {showtime.totalSeats}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1 xl:flex-nowrap">
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

          {/* ซ่อนตัวเองเมื่อมีหน้าเดียว — จอ xl กันที่ไว้แม้ตอนซ่อน กล่องตารางจะได้ไม่ยืดหดจนจำนวนแถวต่อหน้าเปลี่ยนตาม */}
          <Pagination
            numbered
            reserveSpace={fit.active}
            className={FIT_PAGER}
            page={paged.page}
            pageSize={fit.pageSize}
            total={showtimes.length}
            onChange={setPage}
          />
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
          <p className="text-body-2 text-muted">
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
            <p className="text-body-2 font-medium">
              {t('admin.showtimeForm.cancelBody', {
                time: formatDateTime(cancelTarget.startsAt, lang),
                movie: pick(cancelTarget.movie, 'title'),
                theatre: cancelTarget.theatre.name,
              })}
            </p>
            <p className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-body-2 text-danger">
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
