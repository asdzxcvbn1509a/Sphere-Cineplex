import clsx from 'clsx';

/**
 * ป้ายสถานะแบบ pill ตาม DS — จุดสีนำหน้า พื้นเข้ม และตัวอักษรสีอ่อนของโทนเดียวกัน
 * ใช้ร่วมกันทั้งสถานะการจอง การชำระเงิน สถานะภาพยนตร์ และป้ายของหน้าการจองผู้ดูแล (displayStatus)
 * แบ่งโทนตามความหมาย ไม่ใช่ตามตาราง: รอผู้ใช้หรือรอโอนคืน (warning) · รอผู้ดูแลตรวจ/ยังไม่เริ่ม (info)
 * สำเร็จ (success) · ถูกปฏิเสธ (danger) · จบไปแล้วโดยไม่มีอะไรต้องทำต่อ (สีกลาง)
 */
const toneClass = {
  warning: 'border-warning/30 bg-warning-bg text-warning',
  info: 'border-info/30 bg-info-bg text-info',
  success: 'border-success/30 bg-success-bg text-success',
  danger: 'border-danger/30 bg-danger-bg text-danger',
  neutral: 'border-line bg-surface-2 text-muted',
};

const statusTone = {
  PENDING_PAYMENT: 'warning',
  AWAITING_SLIP: 'warning',
  REFUND_PENDING: 'warning',
  TOPUP_PENDING_PAYMENT: 'warning',
  DIFF_REFUND_PENDING: 'warning',
  CANCELLED_REFUND_PENDING: 'warning',
  PENDING_VERIFICATION: 'info',
  TOPUP_PENDING_VERIFICATION: 'info',
  COMING_SOON: 'info',
  PAID: 'success',
  APPROVED: 'success',
  REFUNDED: 'success',
  NOW_SHOWING: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
};

// tone = บังคับโทนสีเอง เมื่อสถานะเดียวกันต้องการสีต่างจากค่าปกติในบางหน้า
const StatusBadge = ({ status, label, tone, className }) => {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium',
        toneClass[tone ?? statusTone[status] ?? 'neutral'],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label ?? status}
    </span>
  );
};

export default StatusBadge;
