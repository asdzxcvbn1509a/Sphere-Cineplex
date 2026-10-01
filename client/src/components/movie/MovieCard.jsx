import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useI18n } from '../../context/I18nContext.jsx';

const MovieCard = ({ movie }) => {
  const { t, pick } = useI18n();

  return (
    <Link
      to={`/movies/${movie.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-accent/50"
    >
      <div className="relative aspect-2/3 overflow-hidden bg-surface-2">
        <img
          src={movie.posterUrl}
          alt={pick(movie, 'title')}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        {movie.status === 'COMING_SOON' && (
          <span className="absolute left-2 top-2 rounded-full bg-info/90 px-2.5 py-0.5 text-xs font-semibold text-ink">
            {t('home.comingSoon')}
          </span>
        )}
        <span className="absolute right-2 top-2 rounded-md bg-ink/80 px-1.5 py-0.5 text-[11px] font-bold text-accent">
          {movie.rating}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-line bg-surface-2 p-3">
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-accent">
          {pick(movie, 'title')}
        </h3>
        <p className="flex items-center gap-1 text-xs text-muted">
          <Clock size={12} />
          {movie.durationMin} {t('movie.minutesUnit')}
        </p>
        <p className="mt-auto line-clamp-1 text-xs text-muted">{movie.genres?.join(' · ')}</p>
      </div>
    </Link>
  );
};

export default MovieCard;
