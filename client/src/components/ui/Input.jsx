import clsx from 'clsx';

const Input = ({ className, ...props }) => {
  return <input className={clsx('input-base', className)} {...props} />;
};

export default Input;
