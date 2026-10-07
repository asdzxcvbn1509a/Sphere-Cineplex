import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Clock, Sofa } from 'lucide-react';
import clsx from 'clsx';
import { getMovie } from '../api/movies.js';
import { listShowtimes } from '../api/showtimes.js';
import { useI18n } from '../context/I18nContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';
import useApi from '../hooks/useApi.js';
import { bangkokDateKey, buildDateStrip, formatDate, formatMoney, formatTime, formatWeekday } from '../utils/format.js';

const MovieDetailPage = () => {
  const { movieId } = useParams();
  const { t, lang, pick } = useI18n();
  const [selectedDate, setSelectedDate] = useState(null);

  const dateStrip = buildDateStrip(7);
  const todayKey = bangkokDateKey();

  // ขอพร้อมกันในรอบเดียว — เดิมรอรายละเอียดหนังเสร็จก่อนค่อยขอรอบของวันแรก แล้วขอใหม่ทุกครั้งที่กดเปลี่ยนวัน
  const { data, loading, error, reload } = useApi(async () => {
    const [movieRes, showtimesRes] = await Promise.all([getMovie(movieId), listShowtimes({ movieId })]);
    // เลือกวันแรกที่มีรอบฉายให้อัตโนมัติ ผู้ใช้จะได้เห็นรอบทันทีโดยไม่ต้องกดอะไรก่อน
    setSelectedDate(movieRes.data.movie.availableDates?.[0] ?? todayKey);
    return { movie: movieRes.data.movie, showtimes: showtimesRes.data.showtimes };
  }, [movieId, todayKey]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />
      </div>
    );
  }

  // รอบที่ยังไม่เริ่มของทุกวัน — กดเปลี่ยนวันแค่กรองในเครื่อง ไม่ต้องรอโหลดใหม่
  const { movie, showtimes } = data;

  // ตัดรอบที่เริ่มไปแล้วระหว่างเปิดหน้าค้างไว้ด้วย (เดิมได้จากการโหลดใหม่ทุกครั้งที่กดวัน)
  const now = Date.now();
  const showtimesOfDay = showtimes.filter(
    (showtime) =>
      bangkokDateKey(showtime.startsAt) === selectedDate && new Date(showtime.startsAt).getTime() > now,
  );

  const byTheatre = showtimesOfDay.reduce((groups, showtime) => {
    const key = showtime.theatre.id;
    if (!groups[key]) groups[key] = { theatre: showtime.theatre, items: [] };
    groups[key].items.push(showtime);
    return groups;
  }, {});

  const dateLabel = (key, offset) => {
    if (offset === 0) return t('common.today');
    if (offset === 1) return t('common.tomorrow');
    return formatWeekday(`${key}T12:00:00+07:00`, lang);
  };

  return (
    <div>
      <div className="relative">
        {movie.backdropUrl && (
          <div className="absolute inset-0 h-64 overflow-hidden sm:h-80">
            <img src={movie.backdropUrl} alt="" className="h-full w-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-linear-to-b from-ink/40 to-ink" />
          </div>
        )}

        <div className="relative mx-auto max-w-6xl px-4 pb-6 pt-6">
          <Breadcrumb
            className="mb-5"
            items={[{ label: t('nav.home'), to: '/' }, { label: pick(movie, 'title') }]}
          />

          {/*
            มือถือ: โปสเตอร์เล็กข้างชื่อเรื่อง เรื่องย่อเต็มความกว้างด้านล่าง — เลื่อนถึงแถบเลือกวันได้เร็วขึ้น
            จอใหญ่: โปสเตอร์คอลัมน์ซ้ายสูงสองแถว ชื่อเรื่องกับเรื่องย่ออยู่คอลัมน์ขวาแบบเดิม
          */}
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-5 sm:grid-cols-[14.5rem_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-10 sm:gap-y-6">
            <img
              src={movie.posterUrl}
              alt={pick(movie, 'title')}
              className="w-full self-start rounded-xl border border-line object-cover shadow-2xl sm:row-span-2 sm:rounded-2xl"
            />
            <div className="min-w-0 self-center sm:self-start">
              <h1 className="text-xl font-bold sm:text-4xl">{pick(movie, 'title')}</h1>
              <p className="mt-1 text-sm text-muted sm:text-base">
                {lang === 'th' ? movie.titleEn : movie.titleTh}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:mt-4">
                <span className="rounded-md border border-accent/40 px-2 py-1 font-bold text-accent">
                  {movie.rating}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-muted">
                  <Clock size={12} /> {movie.durationMin} {t('movie.minutesUnit')}
                </span>
                {movie.genres?.map((genre) => (
                  <span key={genre} className="rounded-md bg-surface-2 px-2 py-1 text-muted">
                    {genre}
                  </span>
                ))}
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 sm:col-start-2">
              <h2 className="text-sm font-semibold text-muted">{t('movie.synopsis')}</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg/90">
                {pick(movie, 'synopsis')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-14">
        {movie.status === 'COMING_SOON' ? (
          <div className="card mt-4 px-6 py-8 text-center text-sm text-muted">
            {t('movie.comingSoonNotice')}
          </div>
        ) : (
          <>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <CalendarDays size={18} className="text-accent" /> {t('movie.selectDate')}
            </h2>

            {/* แถบเลือกวันแบบเลื่อนแนวนอน — แก้ pain point "ดูรอบของวันถัด ๆ ไปไม่สะดวก" */}
            <div className="-mx-4 mb-7 flex gap-2 overflow-x-auto px-4 pb-2">
              {dateStrip.map(({ key, offset }) => {
                const hasShowtimes = movie.availableDates?.includes(key);
                const active = selectedDate === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!hasShowtimes}
                    onClick={() => setSelectedDate(key)}
                    className={clsx(
                      'flex min-w-18 shrink-0 flex-col items-center rounded-xl border px-3 py-2.5 transition',
                      active
                        ? 'border-accent bg-accent text-ink'
                        : 'border-line bg-surface text-fg hover:border-accent/50',
                      !hasShowtimes && 'cursor-not-allowed opacity-35 hover:border-line',
                    )}
                  >
                    <span className="text-[11px] font-medium">{dateLabel(key, offset)}</span>
                    <span className="text-lg font-bold leading-tight">{Number(key.slice(8, 10))}</span>
                    <span className="text-[10px] opacity-80">
                      {formatDate(`${key}T12:00:00+07:00`, lang, { day: undefined, year: undefined, month: 'short' })}
                    </span>
                  </button>
                );
              })}
            </div>

            <h2 className="mb-3 text-lg font-semibold">{t('movie.showtimes')}</h2>

            {showtimesOfDay.length === 0 && (
              <div className="card px-6 py-10 text-center text-sm text-muted">
                {t('movie.noShowtimes')}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {Object.values(byTheatre).map(({ theatre, items }) => (
                <div key={theatre.id} className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-semibold">{theatre.name}</h3>
                    <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                      {theatre.screenType}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {items.map((showtime) => {
                      const soldOut = showtime.availableSeats === 0;
                      return (
                        <Link
                          key={showtime.id}
                          to={soldOut ? '#' : `/showtimes/${showtime.id}/seats`}
                          onClick={(event) => soldOut && event.preventDefault()}
                          className={clsx(
                            'flex min-w-24 flex-col items-center rounded-xl border px-3 py-2 transition',
                            soldOut
                              ? 'cursor-not-allowed border-line bg-surface-2/50 opacity-45'
                              : 'border-line bg-surface-2 hover:border-accent hover:text-accent',
                          )}
                        >
                          <span className="text-base font-bold">
                            {formatTime(showtime.startsAt, lang)}
                          </span>
                          <span className="text-[11px] text-muted">
                            {soldOut
                              ? t('movie.soldOut')
                              : t('movie.seatsLeft', { count: showtime.availableSeats })}
                          </span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-accent">
                            <Sofa size={10} /> {t('movie.from')} {formatMoney(showtime.prices.NORMAL, lang)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MovieDetailPage;
