import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';

const emptyTheatre = { name: '', screenType: '2D', rowsCount: 8, colsCount: 12 };

const zoneStyle = {
  NORMAL: 'border-line',
  PREMIUM: 'border-info/60',
  SOFA: 'border-accent/60',
};

const AdminTheatresPage = () => {
  const { t } = useI18n();
  const toast = useToast();
  const [theatres, setTheatres] = useState([]);
  const [state, setState] = useState({ loading: true, error: null });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyTheatre);
  const [saving, setSaving] = useState(false);

  const [seatEditor, setSeatEditor] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState([]);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setState({ loading: true, error: null });
    listTheatres()
      .then(({ data }) => {
        setTheatres(data.theatres);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  };

  useEffect(load, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      screenType: form.screenType,
      rowsCount: Number(form.rowsCount),
      colsCount: Number(form.colsCount),
    };
    try {
      if (editing === 'new') await createTheatre(payload);
      else await updateTheatre(editing, payload);
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
      await deleteTheatre(deleteTarget.id);
      toast.success(`${t('common.delete')}: ${deleteTarget.name}`);
      setDeleteTarget(null);
      load();
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
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('admin.theatres')}</h1>
        <Button
          onClick={() => {
            setForm(emptyTheatre);
            setEditing('new');
          }}
        >
          <Plus size={16} /> {t('common.create')}
        </Button>
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {theatres.map((theatre) => (
          <div key={theatre.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold sm:text-xl">{theatre.name}</h2>
                <p className="text-xs text-muted">{theatre.screenType}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForm({
                      name: theatre.name,
                      screenType: theatre.screenType,
                      rowsCount: theatre.rowsCount,
                      colsCount: theatre.colsCount,
                    });
                    setEditing(theatre.id);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(theatre)}>
                  <Trash2 size={14} className="text-danger" />
                </Button>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-muted">{t('admin.theatreForm.seatCount')}</dt>
              <dd className="text-right font-semibold">{theatre.seatCount}</dd>
              <dt className="text-muted">{t('admin.showtimes')}</dt>
              <dd className="text-right font-semibold">{theatre.showtimeCount}</dd>
              <dt className="text-muted">{t('admin.theatreForm.rowsCount')} × {t('admin.theatreForm.colsCount')}</dt>
              <dd className="text-right font-semibold">
                {theatre.rowsCount} × {theatre.colsCount}
              </dd>
            </dl>

            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => openSeatEditor(theatre)}
            >
              {t('admin.theatreForm.seatEditor')}
            </Button>
          </div>
        ))}
      </div>

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
          <p className="text-sm text-muted">{t('admin.theatreForm.resizeWarning')}</p>
        </form>
      </Modal>

      <Modal
        open={Boolean(seatEditor)}
        onClose={() => setSeatEditor(null)}
        title={`${t('admin.theatreForm.seatEditor')} — ${seatEditor?.name ?? ''}`}
        size="xl"
      >
        <p className="mb-3 text-sm text-muted">{t('admin.theatreForm.seatEditorHint')}</p>

        <div className="overflow-x-auto pb-2">
          <div className="mx-auto flex w-fit flex-col gap-1.5">
            {seatEditor?.rows.map((row) => (
              <div key={row.rowLabel} className="flex items-center gap-2">
                <span className="w-4 text-center text-[11px] font-semibold text-muted">
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
                          'flex h-7 w-7 items-center justify-center rounded-md border text-[10px] font-semibold transition',
                          picked
                            ? 'border-accent bg-accent text-ink'
                            : clsx('bg-surface-2 text-muted hover:text-fg', zoneStyle[seat.zone]),
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
          <span className="text-sm text-muted">
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

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.theatreForm.deleteTitle')}
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
        <p className="text-sm text-muted">
          {t('admin.theatreForm.deleteBody', { name: deleteTarget?.name })}
        </p>
        {/* schema ลบรอบฉายตามโรงแบบ cascade — ต้องบอกให้รู้ก่อนว่ารอบจะหายไปด้วย */}
        {deleteTarget?.showtimeCount > 0 && (
          <p className="mt-2 text-sm text-danger">
            {t('admin.theatreForm.deleteShowtimesNote', { count: deleteTarget.showtimeCount })}
          </p>
        )}
      </Modal>
    </div>
  );
};

export default AdminTheatresPage;
