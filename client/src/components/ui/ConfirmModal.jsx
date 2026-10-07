import { useI18n } from '../../context/I18nContext.jsx';
import Button from './Button.jsx';
import Modal from './Modal.jsx';

/**
 * หน้าต่างยืนยันแบบสองปุ่ม (ปิด / ยืนยัน) ที่หลายหน้าใช้ — ยกเลิกการจอง ลบรอบ ปฏิเสธสลิป ฯลฯ
 * ปุ่มยืนยันเป็นสีแดงเป็นค่าเริ่มต้น เพราะส่วนใหญ่เป็นการกระทำที่ย้อนกลับไม่ได้
 * หน้าต่างที่เป็นฟอร์ม (ปุ่ม submit) หรือมีหลายทางเลือกให้ใช้ Modal ตรง ๆ
 */
const ConfirmModal = ({
  open,
  onClose,
  title,
  confirmLabel,
  onConfirm,
  cancelLabel,
  variant = 'danger',
  loading = false,
  disabled = false,
  size = 'sm',
  children,
}) => {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={variant} loading={loading} disabled={disabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
};

export default ConfirmModal;
