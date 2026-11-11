import clsx from 'clsx';
import Spinner from './Spinner.jsx';
import { useI18n } from '../../context/I18nContext.jsx';

const LoadingBlock = ({ label, className }) => {
  const { t } = useI18n();
  return (
    <div
      className={clsx('flex flex-col items-center justify-center gap-3 py-16 text-muted', className)}
    >
      <Spinner />
      <p className="text-body-2">{label ?? t('common.loading')}</p>
    </div>
  );
};

export default LoadingBlock;
