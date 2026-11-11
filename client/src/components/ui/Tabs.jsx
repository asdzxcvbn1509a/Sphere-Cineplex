import clsx from 'clsx';

/**
 * แถบสลับมุมมอง (กรองรายการ / เลือกการจัดกลุ่ม) — แถบเป็นสีครีม แท็บที่เลือกเป็นสีน้ำเงินตามบทบาทใน DS
 * เป็นปุ่มสลับธรรมดา (aria-pressed) ไม่ใช่ tablist เพราะทุกหน้าที่ใช้แค่กรองรายการเดิม ไม่ได้สลับแผงเนื้อหา
 * stretch = มือถือกางเต็มความกว้าง แบ่งช่องเท่ากัน จอใหญ่กลับเป็นขนาดตามข้อความ
 * ข้อความแท็บไม่ตัดบรรทัด — แท็บเยอะจนเกินจอมือถือ ให้หน้าที่ใช้หุ้มด้วยกล่อง overflow-x-auto เลื่อนแนวนอนแทน
 *
 * items: [{ value, label }]
 * activeClassName = สีแท็บที่เลือก ถ้าหน้าไหนต้องการต่างจากน้ำเงินของ DS
 */
const Tabs = ({
  items,
  value,
  onChange,
  stretch = false,
  className,
  activeClassName = 'bg-selected text-on-selected',
}) => {
  return (
    <div
      className={clsx(
        'rounded-xl bg-field p-1',
        stretch ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={clsx(
              'whitespace-nowrap rounded-lg px-4 py-1.5 text-body-2 font-medium transition',
              stretch && 'flex-1 px-3 sm:flex-none sm:px-4',
              active ? activeClassName : 'text-field-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
