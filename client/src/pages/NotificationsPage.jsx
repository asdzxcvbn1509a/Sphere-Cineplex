import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../api/client.js';
import { useNotificationStore } from '../store/notificationStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import { formatDateTime } from '../utils/format.js';

const typeTone = {
  PAYMENT_APPROVED: 'border-l-success',
  PAYMENT_REJECTED: 'border-l-danger',
  BOOKING_CANCELLED: 'border-l-muted',
  BOOKING_EXPIRED: 'border-l-muted',
  SHOWTIME_REMINDER: 'border-l-accent',
};

const NotificationsPage = () => {
  const { t, lang, pick } = useI18n();
  const [state, setState] = useState({ loading: true, error: null });

  // ใช้ store เดียวกับกระดิ่งบน Header ตัวเลขจึงเปลี่ยนพร้อมกันทั้งสองที่
  const items = useNotificationStore((store) => store.items);
  const unreadCount = useNotificationStore((store) => store.unreadCount);
  const fetchNotifications = useNotificationStore((store) => store.fetchNotifications);
  const markAllRead = useNotificationStore((store) => store.markAllRead);
  const markRead = useNotificationStore((store) => store.markRead);

  const load = useCallback(() => {
    setState({ loading: true, error: null });
    fetchNotifications()
      .then(() => setState({ loading: false, error: null }))
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  }, [fetchNotifications]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{t('notifications.title')}</h1>
          {unreadCount > 0 && (
            <p className="mt-1 text-sm text-muted sm:text-base">
              {t('notifications.unreadCount', { count: unreadCount })}
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            <CheckCheck size={14} /> {t('notifications.markAllRead')}
          </Button>
        )}
      </div>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && items.length === 0 && (
        <EmptyState icon={BellOff} title={t('notifications.empty')} />
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const unread = !item.readAt;
          const bookingId = item.data?.bookingId;
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={clsx('font-semibold sm:text-lg', unread && 'text-accent')}>
                  {pick(item, 'title')}
                </p>
                {unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
              </div>
              <p className="mt-1 text-sm text-muted sm:text-base">{pick(item, 'body')}</p>
              <p className="mt-1.5 text-xs text-muted sm:text-sm">{formatDateTime(item.createdAt, lang)}</p>
            </>
          );

          const className = clsx(
            'card block border-l-4 p-4 text-left transition hover:border-accent/40 sm:px-5',
            typeTone[item.type] ?? 'border-l-line',
            unread && 'bg-surface-2/60',
          );

          return bookingId ? (
            <Link
              key={item.id}
              to={`/booking/${bookingId}/${item.type === 'PAYMENT_APPROVED' || item.type === 'SHOWTIME_REMINDER' ? 'ticket' : 'payment'}`}
              className={className}
              onClick={() => unread && markRead(item.id)}
            >
              {content}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              className={className}
              onClick={() => unread && markRead(item.id)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default NotificationsPage;
