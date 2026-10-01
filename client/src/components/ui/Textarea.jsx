import clsx from 'clsx';

const Textarea = ({ className, ...props }) => {
  return <textarea className={clsx('input-base min-h-24 resize-y', className)} {...props} />;
};

export default Textarea;
