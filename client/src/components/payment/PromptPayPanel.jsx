import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, QrCode } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatCountdown } from '../../utils/format.js';
import Button from '../ui/Button.jsx';

/**
 * QR พร้อมเพย์ + เวลาที่เหลือ + เลขอ้างอิง — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * secondsLeft มาจาก useCountdown ของหน้าที่เรียกใช้ (นับจากวินาทีที่ server บอก ไม่ใช่นาฬิกาเครื่องลูกค้า)
 * downloadName = ชื่อไฟล์ตอนกดบันทึกรูป QR (ไม่ต้องใส่ .png)
 * notice = หมายเหตุท้ายการ์ด ให้หน้าที่เรียกใช้ส่งมาเอง เพราะหมดเวลาแล้วผลต่างกัน
 *   (ค่าตั๋ว: การจองถูกยกเลิก · ส่วนต่าง: แค่คำขอถูกยกเลิก ที่นั่งเดิมยังเป็นของลูกค้า)
 */
const PromptPayPanel = ({ qrPayload, reference, promptPayId, secondsLeft, downloadName, notice }) => {
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
        <h2 className="flex items-center gap-2 text-h2 font-semibold">
          <QrCode size={18} className="text-accent" /> {t('payment.scanTitle')}
        </h2>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-center">
          <p className="text-caption uppercase tracking-wide text-muted">{t('payment.timeLeft')}</p>
          <p className="font-code text-h2 font-bold text-accent">
            {formatCountdown(secondsLeft)}
          </p>
        </div>
      </div>

      <p className="mb-6 text-body-2 text-muted">{t('payment.scanHint')}</p>

      {/* style ทับขนาดที่ได้จาก size ทำให้ QR ย่อตามจอมือถือได้ ส่วนรูปที่บันทึกยังคมเท่าเดิม */}
      {/* กรอบพื้นสว่าง (paper) — แอปธนาคารสแกน QR บนพื้นมืดได้ไม่ดี */}
      <div ref={qrWrapperRef} className="mx-auto w-full max-w-80 rounded-2xl bg-paper p-4">
        <QRCodeCanvas
          value={qrPayload}
          size={288}
          level="M"
          marginSize={1}
          style={{ width: '100%', height: 'auto' }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center text-body-2">
        <span className="text-muted">
          {t('payment.reference')}: <span className="font-code text-fg">{reference}</span>
        </span>
        <span className="text-muted">
          PromptPay: <span className="font-code text-fg">{promptPayId}</span>
        </span>
      </div>

      <div className="mt-4 flex justify-center">
        <Button variant="secondary" onClick={downloadQr}>
          <Download size={16} /> {t('payment.saveQr')}
        </Button>
      </div>

      <p className="mt-6 rounded-lg border border-line bg-surface-2 p-4 text-body-2 text-muted">
        <span className="font-semibold">{t('payment.noteLabel')}:</span> {notice}
      </p>
    </div>
  );
};

export default PromptPayPanel;
