import { useEffect, useRef } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Clapperboard,
  Film,
  LayoutDashboard,
  ReceiptText,
  ScanLine,
  HandCoins,
  Sofa,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import Header from '../../components/layout/Header.jsx';
import { useI18n } from '../../context/I18nContext.jsx';
import { usePolling } from '../../hooks/usePolling.js';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';

const items = [
  { to: '/admin', end: true, key: 'overview', icon: LayoutDashboard },
  { to: '/admin/payments', key: 'payments', icon: ScanLine, badge: 'pendingSlips' },
  { to: '/admin/refunds', key: 'refunds', icon: HandCoins, badge: 'pendingRefunds' },
  { to: '/admin/bookings', key: 'bookings', icon: ReceiptText },
  { to: '/admin/showtimes', key: 'showtimes', icon: Clapperboard },
  { to: '/admin/movies', key: 'movies', icon: Film },
  { to: '/admin/theatres', key: 'theatres', icon: Sofa },
  { to: '/admin/users', key: 'users', icon: Users },
  { to: '/admin/reports', key: 'reports', icon: BarChart3 },
];

const AdminLayout = () => {
  const { t } = useI18n();
  const location = useLocation();
  // เลือกทีละค่า ไม่ประกอบเป็น object ใน selector เพราะ zustand v5 ต้องการ snapshot ที่คงที่
  const pendingSlips = useAdminQueueStore((state) => state.pendingSlips);
  const pendingRefunds = useAdminQueueStore((state) => state.pendingRefunds);
  const refreshCounts = useAdminQueueStore((state) => state.refresh);
  const counts = { pendingSlips, pendingRefunds };

  // อัปเดตตอนเปิดหน้าและทุกครั้งที่เปลี่ยนเมนู เพื่อให้ตัวเลขตรงกับสิ่งที่เพิ่งทำไป
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, location.pathname]);

  // ลูกค้าส่งสลิปหรือกดยกเลิกเข้ามาได้ตลอด แม้ผู้ดูแลจะเปิดค้างอยู่หน้าอื่น
  usePolling(refreshCounts, 30000, true);

  // จอเล็กเมนูเป็นแถบเลื่อนแนวนอน — เปิดหน้าไหนก็เลื่อนเมนูของหน้านั้นมาไว้กลางแถบ (เช่นเปิด /admin/reports ตรง ๆ)
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (!active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2 });
  }, [location.pathname]);

  // ใช้ header เดียวกับฝั่งผู้ใช้ ปุ่มกลับหน้าแรก สลับภาษา และชื่อผู้ใช้จึงไม่ต้องมีซ้ำใน sidebar
  return (
    <div className="flex min-h-dvh flex-col">
      {/* เปิดหน้าใหม่ให้เริ่มที่บนสุด ไม่ค้างตำแหน่งที่เลื่อนไว้ในหน้าก่อน */}
      <ScrollRestoration />
      <Header />

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-line bg-surface lg:w-48 lg:shrink-0 lg:border-b-0 lg:border-r">
          {/*
            จอใหญ่เมนูติดใต้ header ตอนเลื่อนรายการยาว ๆ ไม่ต้องเลื่อนกลับขึ้นไปเปลี่ยนหน้า
            สูงไม่เกินพื้นที่ใต้ header — จอเตี้ย (เช่นซูมเบราว์เซอร์) จะเลื่อนในเมนูได้ ไม่บังเมนูท้าย ๆ
          */}
          <nav
            ref={navRef}
            className="relative flex gap-1 overflow-x-auto px-3 py-3 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-4rem)] lg:flex-col lg:overflow-y-auto"
          >
            {items.map(({ to, end, key, icon: Icon, badge }) => {
              const count = badge ? counts[badge] : 0;
              return (
                <NavLink
                  key={key}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    clsx(
                      'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                      isActive ? 'bg-accent text-ink' : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )
                  }
                >
                  <Icon size={16} />
                  {t(`admin.${key}`)}
                  {count > 0 && (
                    <span
                      // สีแดงเสมอ เพราะเมนูที่ถูกเลือกอยู่พื้นเป็นสีทอง ป้ายสีทองจะกลืนหาย
                      className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white"
                      aria-label={t('admin.pendingBadge', { count })}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* เว้นที่ให้แถบสรุปของหน้าย้ายที่นั่ง — ใส่ที่ main ไม่ใช่ root พื้นเมนูข้างจะได้ยืดลงไปถึงล่างสุด */}
        <main className="min-w-0 flex-1 bg-ink pb-(--bottom-bar,0px)">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
