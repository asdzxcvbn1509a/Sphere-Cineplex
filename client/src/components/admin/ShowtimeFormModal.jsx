import { useEffect, useState } from 'react';
import { apiError } from '../../api/client.js';
import { createShowtime, getShowtimeAvailability, updateShowtime } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import Select from '../ui/Select.jsx';
import {
  dateOfInputValue,
  formatTime,
  fromBangkokInputValue,
  toBangkokInputValue,
} from '../../utils/format.js';

/**
 * หน้าต่างเพิ่ม/แก้รอบฉาย — หน้ารอบฉายเปิดด้วยการ mount ใหม่ทุกครั้ง ฟอร์มจึงเริ่มจาก initialForm เสมอ
 * showtimeId = 'new' คือเพิ่มรอบใหม่ · บันทึกสำเร็จแล้วเรียก onSaved ให้หน้าโหลดตารางใหม่
 * initialForm.originalTheatreId = โรงเดิมของรอบที่กำลังแก้ (เพิ่มใหม่ไม่มี)
 */
const ShowtimeFormModal = ({ showtimeId, initialForm, movies, theatres, onClose, onSaved }) => {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState(null);
  const creating = showtimeId === 'new';

  // โรงที่ปิดใช้งานลงรอบใหม่ไม่ได้ แต่ตอนแก้รอบเดิมที่อยู่ในโรงนั้นต้องยังเห็นโรงเดิมในรายการ
  // ไม่งั้น select จะเด้งไปโรงแรกเอง แล้วกดบันทึกกลายเป็นย้ายรอบโดยไม่ได้ตั้งใจ
  const theatreOptions = theatres.filter(
    (theatre) => theatre.isActive || theatre.id === form.originalTheatreId,
  );

  /**
   * ถามเซิร์ฟเวอร์ว่าโรงนี้ในวันนี้เหลือช่วงไหนให้ลงรอบใหม่ได้บ้าง
   * ยิงใหม่ทุกครั้งที่เปลี่ยนหนัง โรง หรือวัน เพราะทั้งสามอย่างมีผลต่อการชนกัน
   * (หนังยาวไม่เท่ากัน โรงคนละโรงไม่ชนกัน คนละวันก็คนละตาราง)
   */
  useEffect(() => {
    const formDate = dateOfInputValue(form.startsAt);
    if (!form.movieId || !form.theatreId || !formDate) {
      setAvailability(null);
      return undefined;
    }
    let cancelled = false;
    getShowtimeAvailability({
      movieId: form.movieId,
      theatreId: form.theatreId,
      date: formDate,
      ...(!creating && { excludeId: showtimeId }),
    })
      .then(({ data }) => !cancelled && setAvailability(data))
      .catch(() => !cancelled && setAvailability(null));
    return () => {
      cancelled = true;
    };
  }, [creating, showtimeId, form.movieId, form.theatreId, form.startsAt]);

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

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        startsAt: fromBangkokInputValue(form.startsAt),
        basePrice: Number(form.basePrice),
        ...(creating && { movieId: form.movieId }),
        theatreId: form.theatreId,
      };
      if (creating) await createShowtime(payload);
      else await updateShowtime(showtimeId, payload);
      toast.success(t('common.save'));
      onSaved();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? t('admin.showtimeForm.createTitle') : t('admin.showtimeForm.editTitle')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
          <Select value={form.movieId} onChange={setField('movieId')} disabled={!creating} required>
            {movies.map((movie) => (
              <option key={movie.id} value={movie.id}>
                {pick(movie, 'title')} ({movie.durationMin} {t('movie.minutesUnit')})
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
                  movie: pick(conflict.movie, 'title'),
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
              <p className="mb-1.5 text-sm font-medium text-muted">{t('admin.showtimeForm.busyInTheatre')}</p>
              {availability.busy.length === 0 ? (
                <p className="text-sm text-success">{t('admin.showtimeForm.noBusy')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availability.busy.map((item) => (
                    <span
                      key={item.id}
                      className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger"
                      title={pick(item.movie, 'title')}
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
                {t('admin.showtimeForm.freeSlots', { minutes: availability.turnaroundMinutes })}
              </p>
              {availability.freeSlots.length === 0 ? (
                <p className="text-sm text-danger">{t('admin.showtimeForm.noFreeSlot')}</p>
              ) : (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {availability.freeSlots.map((slot) => {
                    const value = toBangkokInputValue(slot);
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
  );
};

export default ShowtimeFormModal;
