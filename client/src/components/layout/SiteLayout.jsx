import { Outlet, ScrollRestoration } from 'react-router-dom';
import Header from './Header.jsx';
import { useI18n } from '../../context/I18nContext.jsx';

const SiteLayout = () => {
  const { t } = useI18n();

  return (
    // ตอนพิมพ์ไม่ต้องยืดเต็มความสูงจอ ไม่งั้นได้กระดาษเปล่าเพิ่มอีกหน้า
    // pb = ความสูงแถบสรุปติดขอบล่าง (BottomBar) เนื้อหาท้ายหน้าและ footer จะไม่ถูกบัง — หน้าที่ไม่มีแถบเป็น 0
    <div className="flex min-h-dvh flex-col pb-(--bottom-bar,0px) print:block print:min-h-0">
      {/* เปิดหน้าใหม่ให้เริ่มที่บนสุด ไม่ค้างตำแหน่งที่เลื่อนไว้ในหน้าก่อน */}
      <ScrollRestoration />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface px-4 py-6 text-center text-sm text-muted print:hidden">
        <p>
          © {new Date().getFullYear()} {t('common.appName')}. {t('common.allRightsReserved')}
        </p>
      </footer>
    </div>
  );
};

export default SiteLayout;
