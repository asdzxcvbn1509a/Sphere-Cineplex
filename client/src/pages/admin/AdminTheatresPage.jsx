import { useState } from 'react';
import { Armchair, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import {
  createTheatre,
  deleteTheatre,
  getTheatre,
  listTheatres,
  updateSeats,
  updateTheatre,
} from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../../components/ui/Button.jsx';
import Chip from '../../components/ui/Chip.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { zoneRing } from '../../components/seatmap/zoneRing.js';
import { FIT_BODY, FIT_CARD, FIT_PAGE, FIT_PAGER } from '../../components/admin/fitLayout.js';
import useApi from '../../hooks/useApi.js';
import useFitPageSize from '../../hooks/useFitPageSize.js';
import { slicePage } from '../../utils/pagination.js';

const emptyTheatre = { name: '', screenType: '2D', rowsCount: 8, colsCount: 12, isActive: true };
/**
 * ระยะต่อแถวบนจอ xl = xl:h-12 (48px) — เปลี่ยนคู่กับ class ของแถว · เส้นคั่นแถวรวมอยู่ในความสูงนี้แล้ว (border-collapse)
 * เซลล์ใช้ py-2 ไม่ใช่ py-3 แบบตารางอื่น: ปุ่มไอคอนสูง 26px บวก py-3 ได้ 50px เกินแถว
 */
const ROW_HEIGHT = 48;

/** ตัวเลขตัวหนาตามด้วยหน่วยตัวปกติ ตามแบบ เช่น "90 ที่นั่ง" */
const Amount = ({ value, unit }) => (
  <>
    <span className="font-semibold">{value}</span> {unit}
  </>
);

const AdminTheatresPage = () => {
  const { t } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyTheatre);
  const [saving, setSaving] = useState(false);

  const [seatEditor, setSeatEditor] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState([]);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { data: theatres = [], loading, error, reload } = useApi(
    () => listTheatres().then(({ data }) => data.theatres),
    [],
  );

  // ได้ครบทุกโรงแล้ว จึงแบ่งหน้าฝั่งเว็บ — จอใหญ่หน้าละเท่าที่วางพอดีจอ ทั้งหน้าไม่ต้องเลื่อน
  const fit = useFitPageSize(ROW_HEIGHT);
  const paged = slicePage(theatres, page, fit.pageSize);
  // โหลดครั้งแรก = ยังไม่มีอะไรให้ดู · โหลดซ้ำหลังบันทึก/ลบ คงตารางเดิมไว้แค่หรี่ลง
  const showSpinner = loading && theatres.length === 0;

  const openCreate = () => {
    setForm(emptyTheatre);
    setEditing('new');
  };

  const openEdit = (theatre) => {
    setForm({
      name: theatre.name,
      screenType: theatre.screenType,
      rowsCount: theatre.rowsCount,
      colsCount: theatre.colsCount,
      isActive: theatre.isActive,
    });
    setEditing(theatre.id);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      screenType: form.screenType,
      rowsCount: Number(form.rowsCount),
      colsCount: Number(form.colsCount),
      isActive: form.isActive,
    };
    try {
      if (editing === 'new') await createTheatre(payload);
      else await updateTheatre(editing, payload);
      toast.success(t('common.save'));
      setEditing(null);
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteTheatre(deleteTarget.id);
      toast.success(`${t('common.delete')}: ${deleteTarget.name}`);
      setDeleteTarget(null);
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setDeleting(false);
    }
  };

  const openSeatEditor = async (theatre) => {
    setSelectedSeats([]);
    try {
      const { data } = await getTheatre(theatre.id);
      setSeatEditor(data.theatre);
    } catch (error) {
      toast.error(apiError(error).message);
    }
  };

  const applySeatChange = async (changes) => {
    try {
      const { data } = await updateSeats(seatEditor.id, { seatIds: selectedSeats, ...changes });
      setSeatEditor(data.theatre);
      setSelectedSeats([]);
      toast.success(`${data.updated} ${t('common.seat')}`);
    } catch (error) {
      toast.error(apiError(error).message);
    }
  };

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className={FIT_PAGE}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('admin.theatres')}</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> {t('common.create')}
        </Button>
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : (
        // แบ่งหน้าอยู่ท้ายการ์ดเดียวกับตาราง — overflow-hidden ตัดมุมแถบท้ายให้โค้งตามการ์ด
        <div className={FIT_CARD}>
          <div ref={fit.ref} className={FIT_BODY}>
            {/*
              จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด
              จอ xl ความกว้างคอลัมน์ตายตัว (table-fixed) — ห้าช่องข้อมูลไม่กำหนดความกว้าง จึงแบ่งที่ที่เหลือจากช่องจัดการเท่า ๆ กันตามแบบ
              ทุกช่องบรรทัดเดียว ชื่อโรงที่ยาวตัดด้วย … ทุกแถวจึงสูงเท่ากัน
              หัวตารางไม่ตัดบรรทัด — จอ lg เบราว์เซอร์ตัด "ที่นั่ง" กลางคำ · จอ xl ทุกหัวพอดีช่องอยู่แล้ว (ช่องแคบสุด 172px ที่จอ 1280)
            */}
            <table className="stack-table w-full min-w-180 text-body-2 xl:table-fixed">
              <thead className="whitespace-nowrap border-b border-line bg-surface-2/60 text-left text-caption uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('admin.showtimeForm.theatre')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.theatreForm.screenType')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.theatreForm.layoutSize')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.theatreForm.seatCount')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.showtimes')}</th>
                  <th className="px-4 py-3 text-right font-medium xl:w-44">{t('common.actions')}</th>
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
                {!showSpinner && theatres.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted">
                      {t('common.empty')}
                    </td>
                  </tr>
                )}
                {!showSpinner &&
                  paged.items.map((theatre) => (
                    <tr
                      key={theatre.id}
                      className={clsx(
                        'border-b border-line/60 last:border-0 xl:h-12',
                        !theatre.isActive && 'text-muted',
                      )}
                    >
                      <td className="px-4 py-2">
                        {/*
                          ป้ายปิดใช้งานไม่ถูกตัด — จอ xl ชื่อยาวตัดเฉพาะตัวชื่อ
                          จอเล็กกว่านั้นป้ายลงไปใต้ชื่อได้ ช่องชื่อจะได้ไม่ดันตารางจนล้นด้านข้าง (จอ lg ภาษาอังกฤษ)
                        */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 xl:flex-nowrap">
                          <span className="font-medium xl:truncate" title={theatre.name}>
                            {theatre.name}
                          </span>
                          {!theatre.isActive && (
                            <StatusBadge status="CANCELLED" label={t('admin.theatreForm.inactiveBadge')} />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2" data-label={t('admin.theatreForm.screenType')}>
                        <Chip tone="accent" size="sm">
                          {theatre.screenType}
                        </Chip>
                      </td>
                      {/*
                        ตัวเลขกับหน่วยไม่ตัดบรรทัดทุกจอ — จอ lg ตารางไม่ได้ fixed ถ้าช่องแคบเบราว์เซอร์ตัด "ที่นั่ง" กลางคำเป็น "ที่ / นั่ง"
                        ข้อความสั้นอยู่แล้ว ชื่อโรงจึงเป็นช่องที่ตัดบรรทัดแทน
                      */}
                      <td
                        className="whitespace-nowrap px-4 py-2 xl:truncate"
                        data-label={t('admin.theatreForm.layoutSize')}
                      >
                        <Amount value={theatre.rowsCount} unit={t('admin.theatreForm.unitRows')} /> ×{' '}
                        <Amount value={theatre.colsCount} unit={t('admin.theatreForm.unitSeats')} />
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-2 xl:truncate"
                        data-label={t('admin.theatreForm.seatCount')}
                      >
                        <Amount value={theatre.seatCount} unit={t('admin.theatreForm.unitSeats')} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 xl:truncate" data-label={t('admin.showtimes')}>
                        <Amount value={theatre.showtimeCount} unit={t('admin.unitShowtimes')} />
                      </td>
                      <td className="px-4 py-2">
                        {/* ปุ่มอยู่บรรทัดเดียวทุกจอ — ตารางกว้างอย่างน้อย min-w-180 พอวางสามปุ่ม แถวจะได้ไม่สูงเพราะปุ่มตกบรรทัด */}
                        <div className="flex justify-end gap-1">
                          {/*
                            ผังที่นั่งไม่มีในแบบ แต่เป็นทางเดียวที่เข้าไปเปลี่ยนโซนหรือปิดที่นั่งได้
                            จึงเป็นไอคอนเพิ่มหน้าปุ่มแก้ไข/ลบ คู่ที่อยู่ในแบบยังชิดขวาเหมือนเดิม — ชี้ค้างเห็นชื่อปุ่ม
                          */}
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('admin.theatreForm.seatEditor')}
                            aria-label={t('admin.theatreForm.seatEditor')}
                            onClick={() => openSeatEditor(theatre)}
                          >
                            <Armchair size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                            onClick={() => openEdit(theatre)}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                            onClick={() => setDeleteTarget(theatre)}
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
            total={theatres.length}
            onChange={setPage}
          />
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing === 'new' ? t('admin.theatreForm.createTitle') : t('admin.theatreForm.editTitle')
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button form="theatre-form" type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="theatre-form" onSubmit={save} className="flex flex-col gap-4">
          <Field label={t('admin.theatreForm.name')} required>
            <Input value={form.name} onChange={setField('name')} required />
          </Field>
          <Field label={t('admin.theatreForm.screenType')}>
            <Select value={form.screenType} onChange={setField('screenType')}>
              {['2D', '3D', 'IMAX', '4DX'].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.theatreForm.rowsCount')} required>
              <Input type="number" min={1} max={26} value={form.rowsCount} onChange={setField('rowsCount')} required />
            </Field>
            <Field label={t('admin.theatreForm.colsCount')} required>
              <Input type="number" min={1} max={30} value={form.colsCount} onChange={setField('colsCount')} required />
            </Field>
          </div>
          <p className="text-body-2 text-muted">{t('admin.theatreForm.resizeWarning')}</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <input
              type="checkbox"
              // checkbox สีครีมตาม DS — color-scheme light ให้กล่องตอนยังไม่ติ๊กเป็นพื้นสว่างด้วย
              className="mt-0.5 h-4 w-4 shrink-0 accent-field scheme-light"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            <span>
              <span className="block text-body-2 font-medium">{t('admin.theatreForm.isActive')}</span>
              <span className="mt-0.5 block text-caption text-muted">{t('admin.theatreForm.isActiveHint')}</span>
            </span>
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(seatEditor)}
        onClose={() => setSeatEditor(null)}
        title={`${t('admin.theatreForm.seatEditor')} — ${seatEditor?.name ?? ''}`}
        size="xl"
      >
        <p className="mb-3 text-body-2 text-muted">{t('admin.theatreForm.seatEditorHint')}</p>

        <div className="overflow-x-auto pb-2">
          <div className="mx-auto flex w-fit flex-col gap-1.5">
            {seatEditor?.rows.map((row) => (
              <div key={row.rowLabel} className="flex items-center gap-2">
                <span className="w-4 text-center text-caption font-medium text-muted">
                  {row.rowLabel}
                </span>
                <div className="flex gap-1.5">
                  {row.seats.map((seat) => {
                    const picked = selectedSeats.includes(seat.id);
                    return (
                      <button
                        key={seat.id}
                        type="button"
                        onClick={() =>
                          setSelectedSeats((current) =>
                            current.includes(seat.id)
                              ? current.filter((id) => id !== seat.id)
                              : [...current, seat.id],
                          )
                        }
                        title={`${row.rowLabel}${seat.seatNumber} · ${seat.zone}`}
                        className={clsx(
                          'flex h-7 w-7 items-center justify-center rounded-md border text-caption font-medium transition',
                          // อยู่ใน Modal (theme-blue) — selected กลายเป็นฟ้าอ่อนเอง ไม่กลืนกับพื้นหน้าต่าง
                          picked
                            ? 'border-selected-line bg-selected text-on-selected'
                            : clsx('bg-surface-2 text-muted hover:text-fg', zoneRing[seat.zone]),
                          !seat.isActive && !picked && 'opacity-35 line-through',
                        )}
                      >
                        {seat.seatNumber}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="text-body-2 text-muted">
            {t('seats.selectedSeats')}: {selectedSeats.length}
          </span>

          <div className="ml-auto flex flex-wrap gap-2">
            {['NORMAL', 'PREMIUM', 'SOFA'].map((zone) => (
              <Button
                key={zone}
                variant="secondary"
                size="sm"
                disabled={selectedSeats.length === 0}
                onClick={() => applySeatChange({ zone })}
              >
                {t('admin.theatreForm.applyZone')} {t(`seats.zone${zone}`)}
              </Button>
            ))}
            <Button
              variant="danger"
              size="sm"
              disabled={selectedSeats.length === 0}
              onClick={() => applySeatChange({ isActive: false })}
            >
              {t('admin.theatreForm.disable')}
            </Button>
            <Button
              variant="success"
              size="sm"
              disabled={selectedSeats.length === 0}
              onClick={() => applySeatChange({ isActive: true })}
            >
              {t('admin.theatreForm.enable')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={selectedSeats.length === 0}
              onClick={() => setSelectedSeats([])}
            >
              {t('admin.theatreForm.clearSelection')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.theatreForm.deleteTitle')}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onConfirm={remove}
      >
        <p className="text-body-2 text-muted">
          {t('admin.theatreForm.deleteBody', { name: deleteTarget?.name })}
        </p>
        {/* schema ลบรอบฉายตามโรงแบบ cascade — ต้องบอกให้รู้ก่อนว่ารอบจะหายไปด้วย */}
        {deleteTarget?.showtimeCount > 0 && (
          <p className="mt-2 text-body-2 text-danger">
            {t('admin.theatreForm.deleteShowtimesNote', { count: deleteTarget.showtimeCount })}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
};

export default AdminTheatresPage;
