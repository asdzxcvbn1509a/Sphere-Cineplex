import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, Info, QrCode } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatCountdown } from '../../utils/format.js';
import Button from '../ui/Button.jsx';

/**
 * QR พร้อมเพย์ + เวลาที่เหลือ + เลขอ้างอิง — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * secondsLeft มาจาก useCountdown ของหน้าที่เรียกใช้ (นับจากวินาทีที่ server บอก ไม่ใช่นาฬิกาเครื่องลูกค้า)
 * downloadName = ชื่อไฟล์ตอนกดบันทึกรูป QR (ไม่ต้องใส่ .png)
 */
const PromptPayPanel = ({ qrPayload, reference, promptPayId, secondsLeft, downloadName }) => {
  const { t } = useI18n();
  const qrWrapperRef = useRef(null);

  const downloadQr = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${downloadName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <QrCode size={18} className="text-accent" /> {t('payment.scanTitle')}
        </h2>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted">{t('payment.timeLeft')}</p>
          <p className="font-mono text-lg font-bold leading-none text-accent">
            {formatCountdown(secondsLeft)}
          </p>
        </div>
      </div>

      <p className="mb-6 text-sm text-muted">{t('payment.scanHint')}</p>

      {/* style ทับขนาดที่ได้จาก size ทำให้ QR ย่อตามจอมือถือได้ ส่วนรูปที่บันทึกยังคมเท่าเดิม */}
      <div ref={qrWrapperRef} className="mx-auto w-full max-w-80 rounded-2xl bg-white p-4">
        <QRCodeCanvas
          value={qrPayload}
          size={288}
          level="M"
          marginSize={1}
          style={{ width: '100%', height: 'auto' }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center text-sm">
        <span className="text-muted">
          {t('payment.reference')}: <span className="font-mono text-fg">{reference}</span>
        </span>
        <span className="text-muted">
          PromptPay: <span className="font-mono text-fg">{promptPayId}</span>
        </span>
      </div>

      <div className="mt-4 flex justify-center">
        <Button variant="secondary" onClick={downloadQr}>
          <Download size={16} /> {t('payment.saveQr')}
        </Button>
      </div>

      <p className="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" />
        {t('payment.verifyNotice')}
      </p>
    </div>
  );
};

export default PromptPayPanel;
