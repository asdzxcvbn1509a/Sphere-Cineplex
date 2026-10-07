import clsx from 'clsx';

/** ป้ายข้อความสั้นในแถบปุ่มของการ์ด (รอตรวจ รอคืนเงิน คืนเงินแล้ว ฯลฯ) — สูงพอ ๆ กับปุ่มขนาด sm ที่วางอยู่ข้างกัน */
const tones = {
  info: 'border-info/40 bg-info/10 text-info',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  success: 'border-success/40 bg-success/10 text-success',
};

const Chip = ({ tone = 'info', className, children }) => {
  return (
    <span className={clsx('rounded-md border px-2.5 py-1.5 text-xs sm:text-sm', tones[tone], className)}>
      {children}
    </span>
  );
};

export default Chip;
