import { useState } from 'react';
import { BadgeCheck, History, RefreshCw } from 'lucide-react';
import { listRefunds } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useAdminQueueStore } from '../../store/adminQueueStore.js';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import QueueList from '../../components/admin/QueueList.jsx';
import RefundWorkspace from '../../components/admin/RefundWorkspace.jsx';
import { QUEUE_GRID, QUEUE_PAGE } from '../../components/admin/queueLayout.js';
import { usePagedApi } from '../../hooks/useApi.js';
import usePolling from '../../hooks/usePolling.js';
import useQueueSelection from '../../hooks/useQueueSelection.js';

const TABS = ['REFUND_PENDING', 'REFUNDED'];

/** ลำดับเริ่มต้นของแต่ละแท็บ — รอคืน: ค้างนานสุดก่อน (ใครรอก่อนได้ก่อน) · คืนแล้ว: ล่าสุดก่อน */
const DEFAULT_SORT = { REFUND_PENDING: 'oldest', REFUNDED: 'newest' };

/** แถวในแผงรายการ — เวลาท้ายแถว: รอคืน = รอมานานเท่าไหร่ · คืนแล้ว = โอนคืนไปเมื่อไหร่ · ยอดคือยอดที่ต้องโอนจริง */
const rowOf = (item) => ({
  code: item.booking.code,
  at: item.status === 'REFUNDED' ? item.refundedAt : item.refundDueAt,
  name: item.booking.user.name,
  amount: item.refundAmount,
});

/**
 * คิวคืนเงิน — รายการ · สลิป · รายละเอียด แบบเดียวกับหน้าตรวจสลิป
 * ระบบไม่ได้ตัดเงินเอง ผู้ดูแลโอนคืนผ่านแอปธนาคาร แล้วแนบสลิปที่นี่เป็นหลักฐานที่ลูกค้าเปิดดูได้
 */
const AdminRefundsPage = () => {
  const { t } = useI18n();
  const [tab, setTab] = useState('REFUND_PENDING');
  const [sort, setSort] = useState(DEFAULT_SORT.REFUND_PENDING);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const refreshCounts = useAdminQueueStore((state) => state.refresh);

  // บันทึกคืนเงินใบสุดท้ายของหน้าแล้ว usePagedApi พาไปหน้าสุดท้ายที่ยังมีรายการเอง
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listRefunds(tab, { page, sort });
      // เช่นเดียวกับคิวตรวจสลิป กดบันทึกคืนเงินแล้วป้ายบนเมนูต้องลดลงเลย
      refreshCounts();
      // ติดแท็บไปกับข้อมูล — ระหว่างสลับแท็บ ข้อมูลที่ค้างอยู่ยังเป็นของแท็บเดิม
      return { items: body.refunds, total: body.total, pageSize: body.pageSize, status: tab };
    },
    { page, setPage },
    [tab, page, sort, refreshCounts],
  );

  // ข้อมูลของแท็บเดิมไม่นับ — ไม่งั้นรายการรอคืนจะโผล่พร้อมปุ่มยืนยันโอนคืนใต้แท็บคืนแล้วชั่วขณะ
  const current = data?.status === tab ? data : null;
  const refunds = current?.items ?? [];

  // ใบที่เลือก (ตกไปใบแรกเองเมื่อใบเดิมหายจากคิว) และการไปใบถัดไปหลังบันทึกการคืน
  const { selected, select, moveOnFrom, panelRef } = useQueueSelection(refunds);

  // โหลดครั้งแรก สลับแท็บ หรือกำลังถอยไปหน้าที่ยังมีรายการ — ยังไม่มีอะไรให้ทำ
  // ส่วนสลับลำดับ/เปลี่ยนหน้าตอนมีรายการอยู่แล้ว คงพื้นที่ทำงานไว้แค่หรี่รายการลง หน้าจะได้ไม่กระพริบทั้งหน้า
  const showSpinner = loading && refunds.length === 0;

  // มีการยกเลิกเข้ามาระหว่างเปิดหน้าอยู่ได้ตลอด จึงรีเฟรชคิวเองเป็นระยะ — ตัวเลขเวลาที่รอในรายการก็ขยับตามรอบนี้
  usePolling(() => reload({ silent: true }), 20000, tab === 'REFUND_PENDING');

  const refresh = async () => {
    setRefreshing(true);
    await reload({ silent: true });
    setRefreshing(false);
  };

  const changeTab = (next) => {
    setTab(next);
    setSort(DEFAULT_SORT[next]);
    setPage(1);
  };

  const toggleSort = () => {
    setSort((value) => (value === 'oldest' ? 'newest' : 'oldest'));
    setPage(1);
  };

  const completed = async (item) => {
    moveOnFrom(item);
    await reload({ silent: true });
  };

  return (
    <div className={QUEUE_PAGE}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="text-h1 font-bold">{t('admin.refunds')}</h1>
        <Tabs
          items={TABS.map((item) => ({ value: item, label: t(`admin.refundPage.tab${item}`) }))}
          value={tab}
          onChange={changeTab}
          // แถบครีมทองขอบทอง แท็บที่เลือกพื้นดำตัวขาว
          className="border border-gold-50 bg-gold-20"
          activeClassName="bg-cocoa-100 text-cream-10"
        />
        {/* แท็บรอคืนรีเฟรชเองทุก 20 วินาทีอยู่แล้ว ปุ่มนี้ไว้ดึงทันที (เช่น ลูกค้าเพิ่งโทรมาแจ้งว่ายกเลิก) */}
        <Button variant="secondary" size="sm" className="ml-auto" loading={refreshing} onClick={refresh}>
          {!refreshing && <RefreshCw size={14} />}
          {t('common.refresh')}
        </Button>
      </div>

      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}
      {showSpinner && <LoadingBlock label={t('common.loading')} />}

      {current && !showSpinner && (
        <div className={QUEUE_GRID}>
          <QueueList
            label={t(`admin.refundPage.tab${tab}`)}
            sortLabel={t(sort === 'oldest' ? 'admin.refundPage.sortOldest' : 'admin.refundPage.sortNewest')}
            onToggleSort={toggleSort}
            items={refunds}
            rowOf={rowOf}
            selectedId={selected?.id}
            onSelect={select}
            loading={loading}
            page={page}
            pageSize={current.pageSize}
            total={current.total}
            onPageChange={setPage}
          />

          {selected ? (
            <RefundWorkspace
              key={selected.id}
              item={selected}
              panelRef={panelRef}
              onCompleted={completed}
              onChanged={() => reload({ silent: true })}
            />
          ) : (
            // ไม่มีรายการ: แผงสลิปกับรายละเอียดรวมเป็นแผงเดียว
            <EmptyState
              compact
              icon={tab === 'REFUND_PENDING' ? BadgeCheck : History}
              title={t(tab === 'REFUND_PENDING' ? 'admin.refundPage.empty' : 'admin.refundPage.emptyDone')}
              className="justify-center md:col-span-2 xl:min-h-0"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default AdminRefundsPage;
