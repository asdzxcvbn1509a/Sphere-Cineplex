import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

/** จุดสีหน้าชื่อตัวเลือก — โทนเดียวกับจุดในป้ายสถานะ (StatusBadge) */
const DOT_TONE = {
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
  neutral: 'bg-muted',
};

/**
 * ช่องเลือกที่กางเป็นรายการ ตัวเลือกมีจุดสีและบรรทัดอธิบายได้ (เช่น กลุ่มสถานะ + ป้ายที่อยู่ในกลุ่ม)
 * <select> ของเบราว์เซอร์ใส่จุดสีหรือบรรทัดอธิบายในตัวเลือกไม่ได้ จึงทำเองตามแบบ select-only combobox ของ WAI-ARIA
 * focus อยู่ที่ปุ่มตลอด — ตัวเลือกที่เลื่อนคีย์บอร์ดมาถึงบอก screen reader ผ่าน aria-activedescendant
 *
 * options: [{ value, label, description?, tone? }] · tone = warning | info | success | neutral
 * description เป็นข้อความ หรืออาร์เรย์ของรายการที่ต่อกันด้วย ", " — แบบอาร์เรย์ตัดบรรทัดได้แค่ระหว่างรายการ
 *   (ภาษาไทยตัดคำเองได้ ถ้าไม่กันไว้ "รอคืนส่วนต่าง" จะขาดเป็น "รอคืน" / "ส่วนต่าง" คนละบรรทัด)
 * className = ความกว้างของช่อง · menuClassName = ความกว้างของรายการ (กว้างกว่าช่องได้ บรรทัดอธิบายจะได้ไม่ตัดถี่)
 * ช่องเป็นสีครีมแบบช่องกรอกอื่น ส่วนรายการเป็นพื้นเข้มแบบการ์ด จุดสีจึงเป็นสีเดียวกับในป้ายสถานะ
 */
const SelectMenu = ({ value, onChange, options, className, menuClassName = 'w-72', ...props }) => {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (index) => `${id}-option-${index}`;
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  // คลิกที่อื่นของหน้า = ปิดรายการ เหมือน <select>
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // เปิดทีไรเริ่มที่ตัวที่เลือกอยู่ — กด Enter ทันทีจะได้ค่าเดิม ไม่เปลี่ยนตัวกรองโดยไม่ตั้งใจ
  const openMenu = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  const choose = (option) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    const last = options.length - 1;
    const moves = {
      ArrowDown: () => setActive((index) => Math.min(index + 1, last)),
      ArrowUp: () => setActive((index) => Math.max(index - 1, 0)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(options[active]),
      ' ': () => choose(options[active]),
      Escape: () => setOpen(false),
    };
    if (moves[event.key]) {
      event.preventDefault();
      moves[event.key]();
    } else if (event.key === 'Tab') {
      // ออกจากช่องด้วย Tab = ปิดโดยไม่เปลี่ยนค่า
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="input-base flex items-center justify-between gap-2 text-left"
        {...props}
      >
        <span className="truncate">{options[selectedIndex]?.label}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={clsx('shrink-0 text-field-muted transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={props['aria-label']}
          className={clsx(
            'card absolute left-0 top-full z-30 mt-1 flex flex-col gap-0.5 p-1.5 shadow-xl',
            menuClassName,
          )}
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                // focus ต้องอยู่ที่ปุ่มต่อ — ไม่งั้นคลิกตัวเลือกแล้วปุ่มเสีย focus ใช้คีย์บอร์ดต่อไม่ได้
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
                  // ตัวที่เลือก = "รายการที่เลือก" ของ DS · ตัวที่ชี้/เลื่อนคีย์บอร์ดมาถึง = พื้นอ่อนลงหนึ่งขั้น
                  isSelected
                    ? 'border-selected-line bg-selected text-on-selected'
                    : clsx('border-transparent', index === active && 'bg-surface-2'),
                )}
              >
                {option.tone && (
                  <span
                    aria-hidden="true"
                    className={clsx('mt-1.5 size-2 shrink-0 rounded-full', DOT_TONE[option.tone])}
                  />
                )}
                <span className="min-w-0">
                  <span className="block text-body-2 font-medium">{option.label}</span>
                  {/* ตัวที่เลือกไม่ใช้ muted — ครีมหม่นบนน้ำเงินคอนทราสต์ไม่พอ (แบบเดียวกับแผงรายการคิว) */}
                  {option.description && (
                    <span className={clsx('block text-caption', !isSelected && 'text-muted')}>
                      {Array.isArray(option.description)
                        ? option.description.map((part, partIndex) => (
                            <Fragment key={part}>
                              {partIndex > 0 && ', '}
                              <span className="whitespace-nowrap">{part}</span>
                            </Fragment>
                          ))
                        : option.description}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SelectMenu;
