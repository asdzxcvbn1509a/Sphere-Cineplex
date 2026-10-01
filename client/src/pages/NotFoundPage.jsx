import { Link } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import { useI18n } from '../context/I18nContext.jsx';
import Button from '../components/ui/Button.jsx';

const NotFoundPage = () => {
  const { t } = useI18n();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <Clapperboard size={40} className="mb-4 text-muted" />
      <h1 className="text-2xl font-bold">{t('errors.notFound')}</h1>
      <p className="mt-2 text-sm text-muted">{t('errors.notFoundBody')}</p>
      <Button as={Link} to="/" className="mt-6">
        {t('errors.goHome')}
      </Button>
    </div>
  );
};

export default NotFoundPage;
