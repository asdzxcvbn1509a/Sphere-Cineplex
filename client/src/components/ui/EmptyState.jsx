import clsx from 'clsx';

/**
 * compact = แบบเบาสำหรับคิวงานฝั่ง admin ที่ว่างเป็นเรื่องปกติ ไม่ต้องเรียกร้องความสนใจ
 * className = จัดตำแหน่งในเลย์เอาต์ของหน้าที่ใช้ (เช่น กินหลายคอลัมน์ของ grid)
 */
const EmptyState = ({ icon: Icon, title, description, action, compact = false, className }) => {
  return (
    <div
      className={clsx(
        'card flex flex-col items-center gap-3 px-6 text-center',
        compact ? 'py-10' : 'py-14',
        className,
      )}
    >
      {/* ไอคอนเป็นสีทองตามบทบาทของสีทองใน DS — แบบ compact หรี่ลงเพราะคิวว่างเป็นเรื่องปกติ */}
      {Icon && <Icon size={compact ? 28 : 40} className={compact ? 'text-accent/60' : 'text-accent'} />}
      <p className={compact ? 'text-body-1 text-muted' : 'text-h2 font-bold'}>{title}</p>
      {description && <p className="max-w-sm text-body-2 text-muted">{description}</p>}
      {action}
    </div>
  );
};

export default EmptyState;
