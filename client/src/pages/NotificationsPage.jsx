import { Link } from 'react-router-dom';
import { BellOff, X } from 'lucide-react';
import clsx from 'clsx';
import { useNotificationStore } from '../store/notificationStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { formatDateTime } from '../utils/format.js';

const typeTone = {
  PAYMENT_APPROVED: 'border-l-success',
  PAYMENT_REJECTED: 'border-l-danger',
  BOOKING_CANCELLED: 'border-l-muted',
  BOOKING_EXPIRED: 'border-l-muted',
  SHOWTIME_REMINDER: 'border-l-accent',
  SEATS_CHANGED: 'border-l-success',
  SEAT_CHANGE_REJECTED: 'border-l-danger',
  SEAT_CHANGE_EXPIRED: 'border-l-muted',
};

/** แจ้งเตือนที่บอกว่าตั๋วพร้อมหรือที่นั่งเปลี่ยนแล้ว พาไปหน้าตั๋ว */
const TICKET_TYPES = ['PAYMENT_APPROVED', 'SHOWTIME_REMINDER', 'SEATS_CHANGED'];

/** หน้าที่แจ้งเตือนพาไป — เรื่องส่วนต่างเปลี่ยนที่นั่งไปหน้าคำขอนั้น ที่เหลือไปหน้าชำระเงินของการจอง */
const linkFor = (item) => {
  const { bookingId, seatChangeId } = item.data ?? {};
  if (!bookingId) return null;
  if (TICKET_TYPES.includes(item.type)) return `/booking/${bookingId}/ticket`;
  if (seatChangeId) return `/booking/${bookingId}/seat-change/${seatChangeId}`;
  return `/booking/${bookingId}/payment`;
};

const NotificationsPage = () => {
  const { t, lang, pick } = useI18n();

  // ใช้ store เดียวกับกระดิ่งบน Header ตัวเลขจึงเปลี่ยนพร้อมกันทั้งสองที่
  const items = useNotificationStore((store) => store.items);
  const unreadCount = useNotificationStore((store) => store.unreadCount);
  const fetchNotifications = useNotificationStore((store) => store.fetchNotifications);
  const markAllRead = useNotificationStore((store) => store.markAllRead);
  const markRead = useNotificationStore((store) => store.markRead);
  const remove = useNotificationStore((store) => store.remove);

  // รายการอยู่ใน store — หน้านี้ดูแลแค่สถานะการโหลด
  const { loading, error, reload } = useApi(() => fetchNotifications(), [fetchNotifications]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 font-bold">{t('notifications.title')}</h1>
          {unreadCount > 0 && (
            <p className="mt-1 text-body-2 text-muted sm:text-body-1">
              {t('notifications.unreadCount', { count: unreadCount })}
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="cream" size="sm" onClick={markAllRead}>
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState icon={BellOff} title={t('notifications.empty')} />
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const unread = !item.readAt;
          const to = linkFor(item);
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={clsx('text-body-1 font-semibold', unread && 'text-accent')}>
                  {pick(item, 'title')}
                </p>
                {unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
              </div>
              <p className="mt-1 text-body-2 text-muted sm:text-body-1">{pick(item, 'body')}</p>
              <p className="mt-1.5 text-caption text-muted sm:text-body-2">{formatDateTime(item.createdAt, lang)}</p>
            </>
          );

          const className = clsx(
            // pr เว้นที่ให้ปุ่มกากบาทที่วางทับมุมขวาบน
            'card block w-full border-l-4 p-4 pr-12 text-left transition hover:border-accent sm:px-5 sm:pr-14',
            typeTone[item.type] ?? 'border-l-line',
            unread && 'bg-surface-2/60',
          );

          const body = to ? (
            <Link to={to} className={className} onClick={() => unread && markRead(item.id)}>
              {content}
            </Link>
          ) : (
            <button type="button" className={className} onClick={() => unread && markRead(item.id)}>
              {content}
            </button>
          );

          // ปุ่มลบอยู่นอกลิงก์ (ซ้อนปุ่มในลิงก์ไม่ได้) แล้ววางทับมุมขวาบนของการ์ด
          return (
            <div key={item.id} className="relative">
              {body}
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={t('notifications.delete')}
                title={t('notifications.delete')}
                className="absolute right-2 top-2 rounded-lg p-2 text-muted transition hover:bg-fg/8 hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NotificationsPage;
