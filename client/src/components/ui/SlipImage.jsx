import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import clsx from 'clsx';
import { getRefundSlipBlob, getSlipBlob } from '../../api/payments.js';
import { useI18n } from '../../context/I18nContext.jsx';
import Spinner from './Spinner.jsx';

/**
 * รูปสลิปไม่ได้เปิดเป็นไฟล์ static — ต้องดึงผ่าน API พร้อม access token
 * แล้วแปลงเป็น object URL ให้ <img> ใช้ เพื่อไม่ให้ลิงก์รูปหลุดออกไปให้คนนอกเปิดได้
 *
 * kind = 'payment' คือสลิปที่ลูกค้าโอนเข้ามา (ผู้ดูแลใช้ตรวจ)
 * kind = 'refund'  คือสลิปที่ผู้ดูแลโอนคืน (ลูกค้าเปิดดูเป็นหลักฐานได้)
 */
const SlipImage = ({ bookingId, kind = 'payment', className }) => {
  const { t } = useI18n();
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    const fetchBlob = kind === 'refund' ? getRefundSlipBlob : getSlipBlob;

    fetchBlob(bookingId)
      .then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setSrc(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookingId, kind]);

  if (failed) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-2 text-muted', className)}>
        <ImageOff size={22} />
        <span className="text-xs">{t('common.noSlip')}</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className={clsx('flex items-center justify-center', className)}>
        <Spinner />
      </div>
    );
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className={clsx('block', className)}>
      <img
        src={src}
        alt={t('common.slip')}
        className="h-full w-full rounded-lg object-contain"
      />
    </a>
  );
};

export default SlipImage;
