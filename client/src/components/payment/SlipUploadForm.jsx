import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import Button from '../ui/Button.jsx';

/**
 * ฟอร์มอัปโหลดสลิป — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * onUpload(file) คืน true เมื่อส่งสำเร็จ (ฟอร์มจะล้างไฟล์ที่เลือกไว้)
 * การแจ้งผลและโหลดข้อมูลใหม่เป็นหน้าที่ของหน้าที่เรียกใช้
 */
const SlipUploadForm = ({ onUpload }) => {
  const { t } = useI18n();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      if (await onUpload(file)) setFile(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    // ไม่ใส่ระยะห่างด้านนอก — หน้าที่เรียกใช้จัดเอง (จอใหญ่วางคู่กับ QR ใน grid)
    <form onSubmit={handleSubmit} className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <Upload size={18} className="text-accent" /> {t('payment.uploadTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('payment.uploadHint')}</p>

      <label className="mt-4 flex min-h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 text-center transition hover:border-accent/60 sm:min-h-72">
        {preview ? (
          <img src={preview} alt="" className="max-h-64 rounded-lg object-contain" />
        ) : (
          <Upload size={22} className="text-muted" />
        )}
        {/* ชื่อไฟล์จากมือถือยาวติดกันไม่มีช่องว่าง (IMG_20261002_…) ต้องตัดกลางคำได้ ไม่งั้นดันจอล้น */}
        <span className="text-sm text-muted wrap-anywhere">{file ? file.name : t('payment.chooseFile')}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <Button type="submit" size="lg" className="mt-4 w-full" loading={uploading} disabled={!file}>
        {t('payment.submitSlip')}
      </Button>
    </form>
  );
};

export default SlipUploadForm;
