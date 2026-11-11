import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useI18n } from '../../context/I18nContext.jsx';
import { formatCountdown } from '../../utils/format.js';
import Button from '../ui/Button.jsx';

/**
 * QR พร้อมเพย์ + เวลาที่เหลือ + เลขอ้างอิง — ใช้ทั้งหน้าชำระค่าตั๋วและหน้าชำระส่วนต่างเปลี่ยนที่นั่ง
 * secondsLeft มาจาก useCountdown ของหน้าที่เรียกใช้ (นับจากวินาทีที่ server บอก ไม่ใช่นาฬิกาเครื่องลูกค้า)
 * downloadName = ชื่อไฟล์ตอนกดบันทึกรูป QR (ไม่ต้องใส่ .png)
 * noteLabel = หัวข้อหน้าหมายเหตุ (ไม่ส่ง = "หมายเหตุ")
 * notice = หมายเหตุท้ายการ์ด ให้หน้าที่เรียกใช้ส่งมาเอง เพราะหมดเวลาแล้วผลต่างกัน
 *   (ค่าตั๋ว: การจองถูกยกเลิก · ส่วนต่าง: แค่คำขอถูกยกเลิก ที่นั่งเดิมยังเป็นของลูกค้า)
 */
const PromptPayPanel = ({ qrPayload, reference, promptPayId, secondsLeft, downloadName, notice, noteLabel }) => {
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
    // การ์ดพื้นเข้มขอบทอง ตัวอักษรอ่อน — QR พื้นขาวจึงเด่นที่สุดในการ์ด
    <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-5 sm:p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 font-semibold">{t('payment.scanTitle')}</h2>
          <p className="mt-3 text-body-1">{t('payment.scanHint')}</p>
        </div>
        {/* กล่องเวลาพื้นทองทึบ ตัวเข้ม — สะดุดตาที่สุดรองจาก QR เพราะหมดเวลาแล้วจองหลุด */}
        <div className="shrink-0 rounded-md border border-gold-60 bg-gold-50 px-5 py-1.5 text-center text-cocoa-100">
          <p className="text-caption">{t('payment.timeLeft')}</p>
          <p className="font-code text-h2 font-medium">{formatCountdown(secondsLeft).replace(':', ' : ')}</p>
        </div>
      </div>

      {/* style ทับขนาดที่ได้จาก size ทำให้ QR ย่อตามจอมือถือได้ ส่วนรูปที่บันทึกยังคมเท่าเดิม */}
      {/* กรอบพื้นสว่าง (paper) — แอปธนาคารสแกน QR บนพื้นมืดได้ไม่ดี */}
      <div ref={qrWrapperRef} className="mx-auto w-full max-w-84 bg-paper p-3">
        <QRCodeCanvas
          value={qrPayload}
          size={288}
          level="M"
          marginSize={1}
          style={{ width: '100%', height: 'auto' }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-18 gap-y-1 text-center text-body-1">
        <span>
          {t('payment.reference')} : <span className="font-code">{reference}</span>
        </span>
        <span>
          Promptpay : <span className="font-code">{promptPayId}</span>
        </span>
      </div>

      <div className="mt-4 flex justify-center">
        {/* ปุ่มน้ำเงินขอบทอง แยกจากปุ่มทองหลักของหน้า — บันทึก QR เป็นงานรอง */}
        <Button variant="navy" onClick={downloadQr}>
          {t('payment.saveQr')}
        </Button>
      </div>

      {/* หมายเหตุพื้นทองอ่อน ตัวเข้ม — เรื่องหมดเวลาแล้วถูกยกเลิกต้องสะดุดตา */}
      <p className="mt-6 rounded-lg border border-gold-50 bg-gold-30 p-4 text-body-2 text-cocoa-90">
        {noteLabel ?? t('payment.noteLabel')} : {notice}
      </p>
    </div>
  );
};

export default PromptPayPanel;
