import clsx from 'clsx';

/** สีของป้ายสถานะ ใช้ร่วมกันทั้งสถานะการจอง การชำระเงิน และสถานะภาพยนตร์ */
const tones = {
  PENDING_PAYMENT: 'bg-accent/15 text-accent border-accent/30',
  PENDING_VERIFICATION: 'bg-info/15 text-info border-info/30',
  PAID: 'bg-success/15 text-success border-success/30',
  APPROVED: 'bg-success/15 text-success border-success/30',
  CANCELLED: 'bg-muted/15 text-muted border-line',
  EXPIRED: 'bg-muted/15 text-muted border-line',
  REJECTED: 'bg-danger/15 text-danger border-danger/30',
  AWAITING_SLIP: 'bg-accent/15 text-accent border-accent/30',
  REFUND_PENDING: 'bg-accent/15 text-accent border-accent/30',
  REFUNDED: 'bg-success/15 text-success border-success/30',
  NOW_SHOWING: 'bg-success/15 text-success border-success/30',
  COMING_SOON: 'bg-info/15 text-info border-info/30',
  ARCHIVED: 'bg-muted/15 text-muted border-line',
};

const StatusBadge = ({ status, label, className }) => {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[status] ?? 'border-line bg-surface-2 text-muted',
        className,
      )}
    >
      {label ?? status}
    </span>
  );
};

export default StatusBadge;
