import { useEffect, useMemo, useState } from 'react';
import { Search, Film } from 'lucide-react';
import { apiError } from '../api/client.js';
import { listMovies } from '../api/movies.js';
import { useI18n } from '../context/I18nContext.jsx';
import MovieCard from '../components/movie/MovieCard.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ErrorBlock from '../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../components/ui/LoadingBlock.jsx';

const gridClass = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6 lg:gap-5';

const HomePage = () => {
  const { t } = useI18n();
  const [movies, setMovies] = useState([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: true, error: null });

  const load = () => {
    setState({ loading: true, error: null });
    listMovies()
      .then(({ data }) => {
        setMovies(data.movies);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error: apiError(error).message }));
  };

  useEffect(load, []);

  // ผลสำรวจ: 18 จาก 30 คนเริ่มต้นด้วยการค้นหา "ชื่อเรื่อง" จึงกรองที่ฝั่ง client ให้ผลขึ้นทันทีที่พิมพ์
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return movies;
    return movies.filter(
      (movie) =>
        movie.titleTh.toLowerCase().includes(keyword) ||
        movie.titleEn.toLowerCase().includes(keyword),
    );
  }, [movies, query]);

  const nowShowing = filtered.filter((movie) => movie.status === 'NOW_SHOWING');
  const comingSoon = filtered.filter((movie) => movie.status === 'COMING_SOON');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      {/* มือถือย่อ hero ลง โปสเตอร์แถวแรกจะโผล่ขึ้นมาในจอแรกเลย */}
      <section className="mb-6 overflow-hidden rounded-3xl border border-line bg-linear-to-br from-surface via-surface to-accent/10 px-5 py-8 sm:mb-8 sm:px-10 sm:py-14">
        <h1 className="text-2xl font-bold leading-tight sm:text-4xl">{t('home.heroTitle')}</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted sm:text-base">{t('home.heroSubtitle')}</p>

        <div className="relative mt-6 max-w-2xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('home.searchPlaceholder')}
            className="input-base py-3.5 pl-11 text-base"
          />
        </div>
      </section>

      {state.loading && <LoadingBlock label={t('common.loading')} />}
      {state.error && <ErrorBlock message={state.error} onRetry={load} retryLabel={t('common.retry')} />}

      {!state.loading && !state.error && (
        <>
          {filtered.length === 0 && (
            <EmptyState icon={Film} title={t('home.noResults')} description={query} />
          )}

          {nowShowing.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold">{t('home.nowShowing')}</h2>
              <div className={gridClass}>
                {nowShowing.map((movie) => (
                  <MovieCard key={movie.id} movie={movie} />
                ))}
              </div>
            </section>
          )}

          {comingSoon.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">{t('home.comingSoon')}</h2>
              <div className={gridClass}>
                {comingSoon.map((movie) => (
                  <MovieCard key={movie.id} movie={movie} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default HomePage;
