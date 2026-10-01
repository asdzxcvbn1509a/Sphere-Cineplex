import clsx from 'clsx';

const Select = ({ className, children, ...props }) => {
  return (
    <select className={clsx('input-base', className)} {...props}>
      {children}
    </select>
  );
};

export default Select;
