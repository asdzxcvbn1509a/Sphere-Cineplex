import clsx from 'clsx';

/**
 * ป้ายข้อความสั้น
 * - md (ค่าเริ่มต้น) — ในแถบปุ่มของการ์ด (รอตรวจ รอคืนเงิน คืนเงินแล้ว ฯลฯ) สูงพอ ๆ กับปุ่มขนาด sm ที่วางอยู่ข้างกัน
 * - sm — ข้อมูลประกอบ เช่น เรต ความยาว แนวหนัง ประเภทจอ
 * accent = ชิปทองตามบทบาทของสีทองใน DS ส่วน tone อื่นเป็นสีสถานะของ DS (พื้นเข้ม ตัวอักษรอ่อนของโทนเดียวกัน)
 */
const tones = {
  accent: 'border-accent/40 bg-accent/10 text-accent',
  info: 'border-info/30 bg-info-bg text-info',
  success: 'border-success/30 bg-success-bg text-success',
  warning: 'border-warning/30 bg-warning-bg text-warning',
  danger: 'border-danger/30 bg-danger-bg text-danger',
};

const sizes = {
  sm: 'px-2 py-0.5 text-caption',
  md: 'px-2.5 py-1.5 text-caption sm:text-body-2',
};

const Chip = ({ tone = 'info', size = 'md', className, children }) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border',
        tones[tone],
        sizes[size],
        className,
      )}
    >
      {children}
    </span>
  );
};

export default Chip;
