import { useI18n } from '../../context/I18nContext.jsx';
import Modal from '../ui/Modal.jsx';
import SlipImage from '../ui/SlipImage.jsx';
import { formatDateTime } from '../../utils/format.js';

/**
 * สลิปที่ผู้ดูแลโอนคืนให้ พร้อมหมายเหตุและเวลาโอน — ลูกค้าเปิดดูเป็นหลักฐานได้เองที่หน้าการจองของฉัน
 * target = { bookingId, payment, paymentId } · paymentId ใส่เฉพาะสลิปคืนส่วนต่างเปลี่ยนที่นั่ง (ไม่ใส่ = ใบหลักของการจอง)
 */
const RefundSlipModal = ({ target, onClose }) => {
  const { t, lang } = useI18n();

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={t('bookings.refundSlipTitle')} size="sm">
      <SlipImage bookingId={target?.bookingId} paymentId={target?.paymentId} kind="refund" className="h-80 w-full" />
      {target?.payment?.refundNote && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{target.payment.refundNote}</p>
      )}
      <p className="mt-3 text-xs text-muted">
        {t('bookings.refundedAt', { at: formatDateTime(target?.payment?.refundedAt, lang) })}
      </p>
    </Modal>
  );
};

export default RefundSlipModal;
