import { Link } from 'react-router-dom';
import { useI18n } from '../../context/I18nContext.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';

const MovieCard = ({ movie }) => {
  const { t, pick, genre } = useI18n();

  return (
    // ขอบการ์ดทองหม่น ชี้แล้วเป็นทองเต็มตาม DS
    <Link
      to={`/movies/${movie.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-card-line bg-surface transition hover:border-accent"
    >
      <div className="relative aspect-2/3 overflow-hidden bg-surface-2">
        <img
          src={movie.posterUrl}
          alt={pick(movie, 'title')}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        {/* ป้ายสถานะตัวเดียวกับหน้าอื่น — พื้นทึบอ่านออกบนโปสเตอร์ทุกสี */}
        {movie.status === 'COMING_SOON' && (
          <StatusBadge
            status="COMING_SOON"
            label={t('home.comingSoon')}
            className="absolute left-2 top-2"
          />
        )}
      </div>

      {/* แถบข้อมูลพื้นทองเข้มให้การ์ดเด่นจากพื้นหน้า ตัวอักษรครีมอ่านออกบนพื้นนี้ */}
      <div className="flex flex-1 flex-col gap-1 bg-gold-90 p-3">
        <h3 className="line-clamp-2 text-body-1 font-semibold text-cream-10 group-hover:text-gold-30">
          {pick(movie, 'title')}
        </h3>
        <p className="text-body-2 text-cream-30">
          {movie.durationMin} {t('movie.minutesUnit')}
        </p>
        <p className="mt-auto line-clamp-1 text-body-2 text-cream-30">{movie.genres?.map(genre).join(' · ')}</p>
      </div>
    </Link>
  );
};

export default MovieCard;
