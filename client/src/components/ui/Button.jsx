import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const variants = {
  primary: 'bg-accent text-ink hover:bg-accent-dark disabled:hover:bg-accent',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-accent/60',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
  success: 'bg-success/15 text-success border border-success/40 hover:bg-success/25',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
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
