import { Outlet } from 'react-router-dom';
import Header from './Header.jsx';
import { useI18n } from '../../context/I18nContext.jsx';

const SiteLayout = () => {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        <p>
          © {new Date().getFullYear()} {t('common.appName')}. {t('common.allRightsReserved')}
        </p>
      </footer>
    </div>
  );
};

export default SiteLayout;
