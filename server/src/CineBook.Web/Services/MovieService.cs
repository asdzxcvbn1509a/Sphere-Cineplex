using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Requests;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>ภาพยนตร์ (port จาก services/movies.js)</summary>
public sealed class MovieService(AppDbContext db, TimeProvider time)
{
    private static ApiException MovieNotFound() => ApiException.NotFound("MOVIE_NOT_FOUND", "ไม่พบภาพยนตร์เรื่องนี้");

    public async Task<List<MovieResponse>> ListAsync(MovieStatus? status, string? q, bool includeArchived = false)
    {
        var query = db.Movies.AsNoTracking();
        if (status is not null) query = query.Where(m => m.Status == status);
        else if (!includeArchived) query = query.Where(m => m.Status != MovieStatus.ARCHIVED);

        if (!string.IsNullOrEmpty(q))
        {
            var pattern = Like.Contains(q);
            query = query.Where(m => EF.Functions.ILike(m.TitleTh, pattern, Like.Escape) || EF.Functions.ILike(m.TitleEn, pattern, Like.Escape));
        }

        // status เรียงตามลำดับ enum ในฐาน (กำลังฉาย → เร็ว ๆ นี้ → เก็บเข้าคลัง)
        var movies = await query.OrderBy(m => m.Status).ThenByDescending(m => m.ReleaseDate).ToListAsync();
        return movies.Select(MovieResponse.From).ToList();
    }

    /// <summary>รายละเอียดหนัง + วันที่ที่ยังมีรอบฉายให้เลือก (ตามเวลาไทย)</summary>
    public async Task<MovieDetailResponse> GetByIdAsync(string id)
    {
        var movie = await db.Movies.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id) ?? throw MovieNotFound();
        var now = time.UtcNowMs();
        var starts = await db.Showtimes.AsNoTracking()
            .Where(s => s.MovieId == id && s.Status == ShowtimeStatus.SCHEDULED && s.StartsAt >= now)
            .OrderBy(s => s.StartsAt)
            .Select(s => s.StartsAt)
            .ToListAsync();
        var m = MovieResponse.From(movie);
        return new MovieDetailResponse(
            m.Id, m.TitleTh, m.TitleEn, m.SynopsisTh, m.SynopsisEn, m.PosterUrl, m.BackdropUrl, m.DurationMin,
            m.Rating, m.Genres, m.ReleaseDate, m.Status, m.CreatedAt, m.UpdatedAt,
            starts.Select(BangkokTime.DateKey).Distinct().ToList());
    }

    public async Task<MovieResponse> CreateAsync(MovieRequest body)
    {
        var movie = new Movie
        {
            TitleTh = body.TitleTh!,
            TitleEn = body.TitleEn!,
            SynopsisTh = body.SynopsisTh ?? "",
            SynopsisEn = body.SynopsisEn ?? "",
            PosterUrl = body.PosterUrl!,
            // backdropUrl ที่ส่งมาเป็นสตริงว่าง ให้เก็บเป็น null แทน
            BackdropUrl = string.IsNullOrEmpty(body.BackdropUrl) ? null : body.BackdropUrl,
            DurationMin = body.DurationMin!.Value,
            Rating = body.Rating ?? "G",
            Genres = body.Genres ?? [],
            ReleaseDate = body.ReleaseDate!.Value,
            Status = body.StatusValue ?? MovieStatus.NOW_SHOWING,
        };
        db.Movies.Add(movie);
        await db.SaveChangesAsync();
        return MovieResponse.From(movie);
    }

    /// <summary>แก้เฉพาะช่องที่ส่งมา</summary>
    public async Task<MovieResponse> UpdateAsync(string id, MovieRequest body)
    {
        var movie = await db.Movies.FirstOrDefaultAsync(m => m.Id == id) ?? throw MovieNotFound();
        if (body.TitleTh is not null) movie.TitleTh = body.TitleTh;
        if (body.TitleEn is not null) movie.TitleEn = body.TitleEn;
        if (body.SynopsisTh is not null) movie.SynopsisTh = body.SynopsisTh;
        if (body.SynopsisEn is not null) movie.SynopsisEn = body.SynopsisEn;
        if (body.PosterUrl is not null) movie.PosterUrl = body.PosterUrl;
        if (body.BackdropUrl is not null) movie.BackdropUrl = body.BackdropUrl.Length == 0 ? null : body.BackdropUrl;
        if (body.DurationMin is not null) movie.DurationMin = body.DurationMin.Value;
        if (body.Rating is not null) movie.Rating = body.Rating;
        if (body.Genres is not null) movie.Genres = body.Genres;
        if (body.ReleaseDate is not null) movie.ReleaseDate = body.ReleaseDate.Value;
        if (body.StatusValue is not null) movie.Status = body.StatusValue.Value;
        db.Entry(movie).Property(m => m.UpdatedAt).CurrentValue = time.UtcNowMs();
        await db.SaveChangesAsync();
        return MovieResponse.From(movie);
    }

    public sealed record DeleteResult(bool Deleted, int BookingCount, int ShowtimeCount);

    /// <summary>
    /// ลบหนัง — มีการจองแล้วต้องยืนยัน (force) และลบถาวรได้แค่เมื่อทุกอย่างจบแล้ว
    /// เดิมพอมีการจองแล้วจะเปลี่ยนเป็น ARCHIVED ให้เงียบ ๆ แทนการลบ ผลคือผู้ดูแลกดลบเท่าไหร่ก็ไม่มีอะไรเกิดขึ้น
    /// ตอนนี้บอกไปตรง ๆ ว่าลบไม่ได้เพราะอะไร แล้วให้เลือกเองว่าจะเก็บเข้าคลังหรือลบถาวร
    /// </summary>
    public async Task<DeleteResult> DeleteAsync(string id, bool force)
    {
        if (!await db.Movies.AnyAsync(m => m.Id == id)) throw MovieNotFound();

        var bookingCount = await db.Bookings.CountAsync(b => b.Showtime.MovieId == id);
        var showtimeCount = await db.Showtimes.CountAsync(s => s.MovieId == id);

        if (bookingCount > 0 && !force)
        {
            throw ApiException.Conflict(
                "MOVIE_HAS_BOOKINGS",
                $"เรื่องนี้มีการจองอยู่ {bookingCount} รายการ ถ้าลบถาวรประวัติการจองของลูกค้าจะหายไปด้วย",
                new { bookingCount, showtimeCount });
        }

        if (bookingCount > 0)
        {
            // ใบเสร็จที่ออกไปแล้วเป็นเอกสารการเงิน ลบหนังทีเดียวใบเสร็จหายตามไปด้วย (cascade) และเลขที่ใบเสร็จจะขาดช่วง
            // จึงลบถาวรไม่ได้ตลอดไปแม้คืนเงินครบแล้ว — เช็กก่อนเงื่อนไขอื่นเพราะเป็นเหตุที่แก้ไม่ได้
            var receiptCount = await db.Payments.CountAsync(p => p.ReceiptNo != null && p.Booking.Showtime.MovieId == id);
            if (receiptCount > 0)
            {
                throw ApiException.Conflict(
                    "MOVIE_HAS_RECEIPTS",
                    $"ลบถาวรไม่ได้ — เรื่องนี้ออกใบเสร็จไปแล้ว {receiptCount} ใบ ซึ่งต้องเก็บไว้เป็นหลักฐานทางการเงิน กรุณาเก็บเข้าคลังแทน",
                    new { receiptCount });
            }

            // ลบถาวรได้แค่เมื่อทุกอย่างจบแล้ว — ยังมีตั๋วรอบที่ยังไม่ฉาย สลิปรอตรวจ หรือเงินรอโอนคืน
            // ลบไปตอนนี้ลูกค้าจะเสียตั๋ว/เงินโดยไม่มีอะไรเหลือให้ตามเรื่องได้เลย
            var now = time.UtcNowMs();
            BookingStatus[] active = [BookingStatus.PENDING_PAYMENT, BookingStatus.PENDING_VERIFICATION, BookingStatus.PAID];
            PaymentStatus[] open = [PaymentStatus.PENDING_VERIFICATION, PaymentStatus.REFUND_PENDING];
            var activeBookings = await db.Bookings.CountAsync(b =>
                active.Contains(b.Status) && b.Showtime.MovieId == id && b.Showtime.EndsAt > now);
            var openPayments = await db.Payments.CountAsync(p => open.Contains(p.Status) && p.Booking.Showtime.MovieId == id);
            if (activeBookings > 0 || openPayments > 0)
            {
                throw ApiException.Conflict(
                    "MOVIE_HAS_OPEN_BOOKINGS",
                    $"ยังลบถาวรไม่ได้ — มีการจองที่ยังไม่จบ {activeBookings} รายการ และสลิปรอตรวจ/เงินรอโอนคืน {openPayments} รายการ " +
                    "ยกเลิกรอบฉายและคืนเงินให้เสร็จก่อน หรือเก็บเข้าคลังแทน",
                    new { activeBookings, openPayments });
            }
        }

        // ลบแล้วรอบฉาย การจอง ที่นั่งที่จอง และรายการชำระเงินจะถูกลบตามไปด้วย (cascade ใน schema)
        await db.Movies.Where(m => m.Id == id).ExecuteDeleteAsync();
        return new DeleteResult(true, bookingCount, showtimeCount);
    }
}
