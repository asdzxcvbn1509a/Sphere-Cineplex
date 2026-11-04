import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../../context/I18nContext.jsx';

/** ชนิดไฟล์เดียวกับที่ server รับ (middleware/upload.js) — ขนาดไฟล์ให้ server ตรวจ เพราะเพดานตั้งค่าได้ (MAX_SLIP_SIZE_MB) */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * ช่องแนบรูปสลิปแบบเส้นประ — กดเลือกไฟล์หรือลากมาวางก็ได้ แนบแล้วเห็นรูปตัวอย่างในช่องเลย
 *
 * ไฟล์อยู่ที่ผู้เรียก (file / onChange) ช่องนี้ไม่ส่งอะไรขึ้น server เอง
 * ขนาดของช่องมาจาก className — วางเต็มแผงก็ได้ รูปตัวอย่างย่อลงให้พอดีพื้นที่ที่เหลือ
 */
const SlipDropzone = ({ file, onChange, title, hint, description, disabled = false, className }) => {
  const { t } = useI18n();
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // URL ของรูปตัวอย่างต้องคืนหน่วยความจำทุกครั้งที่เปลี่ยนไฟล์หรือช่องถูกถอดออก
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (next) => {
    if (!next) return;
    // accept ของ input กรองได้แค่หน้าต่างเลือกไฟล์ — ไฟล์ที่ลากมาวาง (หรือเลือกแบบ "All files") ต้องตรวจเอง
    if (!ACCEPTED_TYPES.includes(next.type)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(next);
  };

  return (
    <label
      onDragOver={(event) => {
        if (disabled) return;
        // ต้อง preventDefault ทุกครั้งที่ลากผ่าน ไม่งั้นเบราว์เซอร์เปิดรูปที่วางแทนหน้านี้
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // ลากผ่านลูก (รูป/ข้อความ) ก็ยิง dragleave — นับว่าออกเมื่อเคอร์เซอร์พ้นช่องจริง ๆ ขอบจะได้ไม่กระพริบ
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) pick(event.dataTransfer.files?.[0]);
      }}
      className={clsx(
        'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition focus-within:border-accent',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        dragging
          ? 'border-accent bg-accent/5'
          : file
            ? 'border-accent/60'
            : 'border-line hover:border-accent/60',
        className,
      )}
    >
      {preview ? (
        <>
          <img src={preview} alt={t('common.slip')} className="min-h-0 w-full flex-1 rounded-lg object-contain" />
          {/* ชื่อไฟล์จากมือถือยาวติดกันไม่มีช่องว่าง (IMG_20261002_…) ต้องตัดกลางคำได้ ไม่งั้นดันแผงล้น */}
          <span className="max-w-full text-caption text-muted wrap-anywhere">{file.name}</span>
          <span className="text-body-2 font-medium text-accent">{t('payment.changeFile')}</span>
        </>
      ) : (
        <>
          <ImagePlus size={40} strokeWidth={1.5} className="text-accent" />
          <span className="text-body-1 font-semibold">{title}</span>
          {hint && <span className="text-caption text-muted">{hint}</span>}
          {description && <span className="mt-3 max-w-xs text-body-2 text-muted">{description}</span>}
        </>
      )}

      {invalid && (
        <span role="alert" className="text-caption text-danger">
          {t('common.slipTypeInvalid')}
        </span>
      )}

      {/* sr-only ไม่ใช่ hidden — ยังกด Tab มาที่ช่องแล้วเปิดหน้าต่างเลือกไฟล์ด้วยคีย์บอร์ดได้ */}
      <input
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          // ล้างค่าไว้ เลือกไฟล์เดิมซ้ำ (เช่นหลังเปลี่ยนรายการ) ก็ยังยิง change
          event.target.value = '';
        }}
      />
    </label>
  );
};

export default SlipDropzone;
