import clsx from 'clsx';

/** compact = แบบเบาสำหรับคิวงานฝั่ง admin ที่ว่างเป็นเรื่องปกติ ไม่ต้องเรียกร้องความสนใจ */
const EmptyState = ({ icon: Icon, title, description, action, compact = false }) => {
  return (
    <div
      className={clsx(
        'card flex flex-col items-center gap-3 px-6 text-center',
        compact ? 'py-10' : 'py-14',
      )}
    >
      {Icon && <Icon size={compact ? 28 : 40} className="text-muted" />}
      <p className={compact ? 'text-lg text-muted' : 'text-xl font-bold sm:text-2xl'}>{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
};

export default EmptyState;
