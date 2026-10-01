import clsx from 'clsx';
import Spinner from './Spinner.jsx';

const LoadingBlock = ({ label = 'กำลังโหลด...', className }) => {
  return (
    <div
      className={clsx('flex flex-col items-center justify-center gap-3 py-16 text-muted', className)}
    >
      <Spinner />
      <p className="text-sm">{label}</p>
    </div>
  );
};

export default LoadingBlock;
