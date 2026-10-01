import clsx from 'clsx';

/** ครอบ input ด้วย label, ข้อความช่วยเหลือ และข้อความ error */
const Field = ({ label, hint, error, required, children, className }) => {
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-muted">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
};

export default Field;
