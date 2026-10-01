import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const Spinner = ({ className, size = 22 }) => {
  return <Loader2 className={clsx('animate-spin text-accent', className)} size={size} />;
};

export default Spinner;
