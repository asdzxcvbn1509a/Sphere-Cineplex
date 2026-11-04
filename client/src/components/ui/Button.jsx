import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/*
  ปุ่มหลักเป็นทอง ตัวอักษร Cocoa 100 ตาม DS (ink)
  ghost ใช้พื้นโปร่งของ fg ตอนชี้ — surface-2 สีเดียวกับพื้น page และแถบหัว Modal ชี้แล้วจะไม่เห็นอะไรเปลี่ยน
  danger/success ใช้พื้นเข้มของสีสถานะ แล้วเน้นขอบตอนชี้ ใช้ได้ทั้งบนการ์ดและบน Modal สีน้ำเงิน
*/
const variants = {
  primary: 'bg-accent text-ink hover:bg-accent-dark disabled:hover:bg-accent',
  secondary: 'bg-surface-2 text-fg border border-line-strong hover:border-accent/60',
  ghost: 'text-muted hover:text-fg hover:bg-fg/8',
  danger: 'bg-danger-bg text-danger border border-danger/40 hover:border-danger',
  success: 'bg-success-bg text-success border border-success/40 hover:border-success',
};

const sizes = {
  sm: 'px-3 py-1.5 text-body-2 gap-1.5',
  md: 'px-4 py-2.5 text-body-2 gap-2',
  lg: 'px-6 py-3 text-body-1 gap-2',
};

const Button = ({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}) => {
  return (
    <Component
      className={clsx(
        'inline-flex items-center justify-center rounded-xl font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={Component === 'button' ? disabled || loading : undefined}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </Component>
  );
};

export default Button;
