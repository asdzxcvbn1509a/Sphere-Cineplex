import { AlertCircle } from 'lucide-react';
import Button from './Button.jsx';

const ErrorBlock = ({ message, onRetry, retryLabel = 'ลองใหม่' }) => {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertCircle className="text-danger" size={28} />
      <p className="text-sm text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
};

export default ErrorBlock;
