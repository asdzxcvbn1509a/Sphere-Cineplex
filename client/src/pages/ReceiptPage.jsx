import { useEffect } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Clapperboard, Printer, Ticket } from 'lucide-react';
import clsx from 'clsx';
import { getReceipt } from '../api/bookings.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useAuthUser } from '../store/authStore.js';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { formatDate, formatDateTime, formatMoney } from '../utils/format.js';

/** เอกสารการเงินแสดงทศนิยม 2 ตำแหน่งเสมอ (560.00) แม้ระบบเก็บเงินเป็นบาทเต็ม */
const MONEY = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

const LABEL = 'text-[11px] uppercase tracking-wide text-neutral-500';

const ReceiptPage = () => {
  const { bookingId } = useParams();
  const location = useLocation();
  // ?payment= = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง (ไม่มี = ใบเสร็จค่าตั๋วตอนจอง)
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get('payment');
  const { t, lang, pick } = useI18n();
  const user = useAuthUser();
  const { data: receipt, loading, error } = useApi(
    () => getReceipt(bookingId, paymentId).then(({ data }) => data.receipt),
    [bookingId, paymentId],
  );

  // "บันทึกเป็น PDF" ของเบราว์เซอร์ตั้งชื่อไฟล์ตาม title ของหน้า — ใช้เลขที่ใบเสร็จ ไฟล์จะได้ไม่ชื่อซ้ำกันทุกใบ
  useEffect(() => {
    if (!receipt) return undefined;
    const previous = document.title;
    document.title = receipt.receiptNo;
    return () => {
      document.title = previous;
    };
  }, [receipt]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <ErrorBlock message={error} />
      </div>
    );
  }

  const { issuer, showtime, refund } = receipt;
  const money = (amount) => formatMoney(amount, lang, MONEY);

  // ผู้ดูแลเปิดจากตารางการจอง (ลิงก์ส่ง state.from มา) — กลับไปหน้าเดิมพร้อมตัวกรองที่ค้างไว้ แม้เป็นใบเสร็จของตัวเอง
  // เปิด URL ตรง ๆ: ใบเสร็จของลูกค้า → หน้าจัดการการจอง · ใบเสร็จของตัวเอง (ผู้ดูแลก็จองตั๋วได้) → การจองของฉันตามปกติ
  const from = location.state?.from;
  const crumbs =
    user?.role === 'ADMIN' && (from || receipt.booking.userId !== user.id)
      ? [
          { label: t('nav.admin'), to: '/admin' },
          { label: t('admin.bookings'), to: from ? `${from.pathname}${from.search ?? ''}` : '/admin/bookings' },
        ]
      : [
          { label: t('nav.home'), to: '/' },
          { label: t('nav.myBookings'), to: '/my-bookings' },
        ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Breadcrumb items={[...crumbs, { label: t('receipt.title') }]} />
        <div className="flex flex-wrap gap-2">
          {receipt.booking.status === 'PAID' && (
            <Button as={Link} to={`/booking/${receipt.booking.id}/ticket`} variant="secondary" size="sm">
              <Ticket size={14} /> {t('receipt.viewTicket')}
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()}>
            <Printer size={14} /> {t('receipt.print')}
          </Button>
        </div>
      </div>

      {/*
        เอกสารพื้นขาวบนธีมมืด แบบเดียวกับการ์ด E-Ticket — ตอนพิมพ์หรือบันทึก PDF ได้หน้าตาตรงกับที่เห็น
        ไม่ใช้สีพื้นหลังสื่อความหมาย (ตราประทับใช้เส้นขอบกับสีตัวอักษร) เพราะเบราว์เซอร์ไม่พิมพ์สีพื้นหลังโดยปริยาย
      */}
      <article className="overflow-hidden rounded-3xl bg-white p-6 text-neutral-900 shadow-2xl sm:p-10 print:rounded-none print:p-0 print:shadow-none">
        <header className="flex flex-col gap-6 border-b border-neutral-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-lg font-bold">
              <Clapperboard size={20} className="text-accent-dark" /> {issuer.name}
            </p>
            {issuer.address && (
              <p className="mt-1 max-w-xs whitespace-pre-line text-sm text-neutral-500">{issuer.address}</p>
            )}
          </div>
          <div className="sm:text-right">
            <h1 className="text-2xl font-black tracking-tight">{t('receipt.title')}</h1>
            {/* หัวรองเป็นอีกภาษาหนึ่ง — ถ่างตัวอักษรได้เฉพาะ "RECEIPT" ภาษาไทยถ่างแล้วสระ/วรรณยุกต์ลอยแยกจากพยัญชนะ */}
            <p className={clsx('text-xs text-neutral-400', lang === 'th' && 'uppercase tracking-[0.2em]')}>
              {t('receipt.subtitle')}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm sm:justify-end">
              <dt className="text-neutral-500">{t('receipt.no')}</dt>
              <dd className="font-mono font-semibold">{receipt.receiptNo}</dd>
              <dt className="text-neutral-500">{t('receipt.date')}</dt>
              <dd className="font-semibold">{formatDateTime(receipt.issuedAt, lang)}</dd>
            </dl>
          </div>
        </header>

        {/* ยกเลิกหลังจ่ายแล้ว — ใบเสร็จยังอยู่เป็นหลักฐานว่ารับเงินมาจริง แต่ต้องเห็นชัดว่าเงินก้อนนี้คืน/กำลังคืนแล้ว */}
        {refund && (
          <div className="mt-6 flex justify-center sm:justify-end">
            <div className="-rotate-3 rounded-lg border-[3px] border-red-600 px-4 py-2 text-center text-red-600">
              <p className="font-black uppercase tracking-wider">{t(`receipt.stamp${refund.status}`)}</p>
              {refund.refundedAt && (
                <p className="text-xs font-semibold">
                  {t('receipt.refundedOn', { at: formatDate(refund.refundedAt, lang) })}
                </p>
              )}
            </div>
          </div>
        )}

        <section className="grid gap-5 py-6 text-sm sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className={LABEL}>{t('receipt.receivedFrom')}</p>
              <p className="font-semibold">{receipt.customer.name}</p>
            </div>
            <div>
              <p className={LABEL}>{t('receipt.bookingCode')}</p>
              <p className="font-mono font-semibold">{receipt.booking.code}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className={LABEL}>{t('receipt.movie')}</p>
              <p className="font-semibold">{pick(showtime.movie, 'title')}</p>
            </div>
            <div>
              <p className={LABEL}>{t('receipt.showtime')}</p>
              <p className="font-semibold">{formatDateTime(showtime.startsAt, lang)}</p>
              <p className="text-neutral-500">{showtime.theatre.name}</p>
            </div>
          </div>
        </section>

        {/*
          จอแคบเหลือแค่ รายการ | จำนวนเงิน แล้วย้าย "จำนวน × ราคาต่อหน่วย" ไปไว้ใต้ชื่อรายการ
          ยอดเงินของทุกบรรทัดจึงเห็นได้โดยไม่ต้องเลื่อนตารางไปด้านข้าง (กระดาษ A4 กว้างพอ ได้ตารางเต็มเสมอ)
        */}
        <table className="w-full text-sm">
          <thead className="border-y border-neutral-300 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="hidden py-2 pr-3 font-medium sm:table-cell">#</th>
              <th className="py-2 pr-3 font-medium">{t('receipt.description')}</th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">{t('receipt.qty')}</th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">
                {t('receipt.unitPrice')}
              </th>
              <th className="py-2 text-right font-medium">{t('receipt.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, index) => (
              <tr key={`${line.kind}-${line.zone}-${line.unitPrice}`} className="border-b border-neutral-200 align-top">
                <td className="hidden py-3 pr-3 text-neutral-500 sm:table-cell">{index + 1}</td>
                <td className="py-3 pr-3">
                  {/* ใบเสร็จส่วนต่างเปลี่ยนที่นั่งมีบรรทัดเดียว บอกว่าย้ายจากที่นั่งไหนไปไหน */}
                  {line.kind === 'SEAT_CHANGE' ? (
                    <>
                      <p className="font-semibold">{t('receipt.seatChangeLine')}</p>
                      <p className="text-xs text-neutral-500">
                        {line.fromSeats.join(', ')} → {line.toSeats.join(', ')}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">
                        {t('receipt.seatLine', { zone: t(`seats.zone${line.zone}`) })}
                      </p>
                      <p className="text-xs text-neutral-500">{line.seats.join(', ')}</p>
                    </>
                  )}
                  <p className="text-xs text-neutral-500 tabular-nums sm:hidden">
                    {line.quantity} × {money(line.unitPrice)}
                  </p>
                </td>
                <td className="hidden py-3 pr-3 text-right tabular-nums sm:table-cell">{line.quantity}</td>
                <td className="hidden py-3 pr-3 text-right tabular-nums sm:table-cell">
                  {money(line.unitPrice)}
                </td>
                <td className="py-3 text-right font-semibold tabular-nums">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1 text-right">
          <p className="flex items-baseline gap-4">
            <span className="text-sm text-neutral-500">{t('receipt.total')}</span>
            <span className="text-2xl font-black tabular-nums">
              {money(receipt.totalAmount)} {t('common.baht')}
            </span>
          </p>
          <p className="text-sm text-neutral-600">({pick(receipt, 'amountText')})</p>
        </div>

        {/* เปลี่ยนที่นั่งหลังออกใบเสร็จ — ใบเสร็จคงที่นั่งตอนจ่าย แต่บอกไว้ คนถือใบเสร็จจะได้ไม่งงว่าทำไมไม่ตรงตั๋ว */}
        {receipt.seatsChangedTo && (
          <p className="mt-4 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600">
            {t('receipt.seatsChangedTo', { seats: receipt.seatsChangedTo.join(', ') })}
          </p>
        )}

        <section className="mt-6 grid gap-4 border-t border-neutral-200 pt-6 text-sm sm:grid-cols-2">
          <div>
            <p className={LABEL}>{t('receipt.paymentMethod')}</p>
            <p className="font-semibold">{t(`receipt.method${receipt.payment.method}`)}</p>
          </div>
          <div>
            <p className={LABEL}>{t('receipt.reference')}</p>
            <p className="font-mono font-semibold">{receipt.payment.reference}</p>
          </div>
        </section>

        <p className="mt-8 text-center text-xs text-neutral-400">{t('receipt.electronicNote')}</p>
      </article>
    </div>
  );
};

export default ReceiptPage;
