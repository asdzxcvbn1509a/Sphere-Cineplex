import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Clapperboard, LayoutDashboard, LogOut, Menu, Ticket, User, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore, useAuthUser, useIsAdmin, useIsAuthenticated } from '../../store/authStore.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useNotificationStore, useUnreadCount } from '../../store/notificationStore.js';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import usePolling from '../../hooks/usePolling.js';
import Button from '../ui/Button.jsx';

const navClass = ({ isActive }) =>
  clsx(
    'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-surface-2 text-accent' : 'text-muted hover:text-fg',
  );

const Header = () => {
  const { t, toggleLang } = useI18n();
  const isAuthenticated = useIsAuthenticated();
  const isAdmin = useIsAdmin();
  const user = useAuthUser();
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // ปิดเมนูมือถือเมื่อเปลี่ยนหน้า — รวมการกด back ของเบราว์เซอร์ที่ไม่ได้ผ่าน onClick ของลิงก์ในเมนู
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape ปิดเมนูได้เหมือน Modal
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // ตัวเลขมาจาก store กลาง หน้า /notifications อ่านแจ้งเตือนเมื่อไหร่ กระดิ่งจะเปลี่ยนตามทันที
  const unread = useUnreadCount();
  const fetchUnreadCount = useNotificationStore((state) => state.fetchUnreadCount);
  const resetNotifications = useNotificationStore((state) => state.reset);

  const loadUnread = useCallback(() => {
    if (isAuthenticated) fetchUnreadCount();
  }, [isAuthenticated, fetchUnreadCount]);

  useEffect(() => {
    if (!isAuthenticated) {
      resetNotifications();
      // ป้ายงานค้างของผู้ดูแลคนก่อนต้องหายไปด้วย ไม่ให้ค้างให้คนถัดไปเห็น
      useAdminQueueStore.getState().reset();
      return;
    }
    loadUnread();
  }, [isAuthenticated, loadUnread, resetNotifications]);

  // ยังต้อง poll อยู่ เผื่อมีแจ้งเตือนใหม่เข้ามาจากที่อื่น เช่น admin เพิ่งอนุมัติสลิป
  usePolling(loadUnread, 60000, isAuthenticated);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur print:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-bold tracking-tight">
          <Clapperboard className="shrink-0 text-accent" size={22} />
          <span className="truncate text-lg">{t('common.appName')}</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          <NavLink to="/" className={navClass} end>
            {t('nav.home')}
          </NavLink>
          {isAuthenticated && (
            <NavLink to="/my-bookings" className={navClass}>
              {t('nav.myBookings')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={navClass}>
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleLang}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:border-accent/60 hover:text-fg"
            title="เปลี่ยนภาษา / Switch language"
          >
            {t('nav.language')}
          </button>

          {isAuthenticated ? (
            <>
              <Link
                to="/notifications"
                className="relative rounded-lg p-2.5 text-muted transition hover:bg-surface-2 hover:text-fg"
                aria-label={t('nav.notifications')}
              >
                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-ink">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>

              <div className="hidden items-center gap-2 md:flex">
                {/* ช่วง md–lg ที่ว่างไม่พอ (เมนูผู้ดูแล + ชื่อยาว) แสดงแค่ไอคอน ชื่อยาวจอใหญ่ก็ตัดด้วย … */}
                <Link
                  to="/profile"
                  className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-sm transition hover:text-accent"
                  title={t('nav.profile')}
                  aria-label={t('nav.profile')}
                >
                  <User size={14} className="shrink-0 text-muted" />
                  <span className="hidden max-w-40 truncate lg:inline">{user?.name}</span>
                </Link>
                <Button variant="ghost" size="sm" onClick={handleLogout} title={t('nav.logout')}>
                  <LogOut size={16} />
                </Button>
              </div>
            </>
          ) : (
            <div className="hidden items-center gap-1.5 md:flex">
              <Button as={Link} to="/register" variant="ghost" size="sm">
                {t('nav.register')}
              </Button>
              <Button as={Link} to="/login" size="sm">
                {t('nav.login')}
              </Button>
            </div>
          )}

          <button
            type="button"
            className="rounded-lg p-2.5 text-muted transition hover:bg-surface-2 hover:text-fg md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="เมนู"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="mobile-menu" className="border-t border-line bg-surface px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
              {t('nav.home')}
            </NavLink>
            {isAuthenticated && (
              <NavLink to="/my-bookings" className={navClass} onClick={() => setMenuOpen(false)}>
                <span className="inline-flex items-center gap-2">
                  <Ticket size={15} /> {t('nav.myBookings')}
                </span>
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={navClass} onClick={() => setMenuOpen(false)}>
                <span className="inline-flex items-center gap-2">
                  <LayoutDashboard size={15} /> {t('nav.admin')}
                </span>
              </NavLink>
            )}
            {isAuthenticated && (
              <NavLink to="/profile" className={navClass} onClick={() => setMenuOpen(false)}>
                <span className="inline-flex items-center gap-2">
                  <User size={15} /> {t('nav.profile')}
                </span>
              </NavLink>
            )}
            {isAuthenticated ? (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-muted transition hover:text-fg"
              >
                {t('nav.logout')} ({user?.name})
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <Button as={Link} to="/login" size="sm" onClick={() => setMenuOpen(false)}>
                  {t('nav.login')}
                </Button>
                <Button
                  as={Link}
                  to="/register"
                  variant="secondary"
                  size="sm"
                  onClick={() => setMenuOpen(false)}
                >
                  {t('nav.register')}
                </Button>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
