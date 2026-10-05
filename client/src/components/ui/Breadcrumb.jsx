import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';

/**
 * แถบบอกตำแหน่งของหน้า ใช้แทนปุ่มย้อนกลับแบบ navigate(-1)
 * ทุกชั้นเป็นลิงก์จริง คนที่เปิดหน้าจากลิงก์ที่แชร์มาก็ยังกลับขึ้นไปได้ ไม่หลุดออกนอกเว็บ
 * รายการสุดท้ายคือหน้าปัจจุบัน ไม่ต้องใส่ `to`
 */
const Breadcrumb = ({ items, className }) => {
  const { t } = useI18n();

  return (
    <nav aria-label={t('common.breadcrumb')} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={item.to ?? item.label} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0" />}
              {/* ชื่อหนังยาว ๆ ตัดด้วย … ไม่ให้ดันจอมือถือจนเลื่อนแนวนอน ชื่อเต็มยังอยู่ใน title */}
              {current ? (
                <span aria-current="page" title={item.label} className="max-w-60 truncate font-medium text-fg">
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} title={item.label} className="max-w-60 truncate transition hover:text-fg">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumb;
