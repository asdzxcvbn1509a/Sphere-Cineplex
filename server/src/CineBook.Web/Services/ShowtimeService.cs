using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>รอบฉายและผังที่นั่ง (port จาก services/showtimes.js)</summary>
public sealed class ShowtimeService(AppDbContext db, TimeProvider time)
{
    /// <summary>กันรอบฉายซ้อนเวลากันในโรงเดียวกัน (เผื่อเวลาทำความสะอาด 15 นาที)</summary>
    public const int TurnaroundMinutes = 15;

    /// <summary>ช่วงเวลาที่โรงเปิดให้จัดรอบฉาย (เวลาไทย) และความละเอียดของตัวเลือกเวลา</summary>
    private const int OpenHour = 10;
    private const int CloseHour = 24;
    private const int SlotStepMinutes = 15;

    private static ApiException ShowtimeNotFound() => ApiException.NotFound("SHOWTIME_NOT_FOUND", "ไม่พบรอบฉายนี้");

    private static ApiException InvalidDate() =>
        ApiException.BadRequest("INVALID_DATE", "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)");

    private sealed record ShowtimeRow(
        string Id,
        string MovieId,
        ShowtimeMovie Movie,
        ShowtimeTheatre Theatre,
        DateTime StartsAt,
        DateTime EndsAt,
        int BasePrice,
        ShowtimeStatus Status,
        List<ZonePrice> ZonePrices,
        int TotalSeats,
        int TakenSeats);

    /// <summary>
    /// นับเฉพาะที่นั่งที่เปิดขาย ให้ตรงกับผังที่นั่งและการจอง (ใช้แค่ที่นั่ง isActive ทั้งคู่)
    /// เดิมนับทุกที่นั่งของโรง ที่นั่งที่ผู้ดูแลปิดใช้งานจึงกลายเป็น "ว่าง" — รอบที่ขายหมดแล้วไม่ขึ้นว่าเต็ม
    /// ที่นั่งที่ถูกจองแล้วค่อยปิดใช้งานไม่นับทั้งสองฝั่ง จำนวนว่างจึงไม่เพี้ยน
    /// </summary>
    private static IQueryable<ShowtimeRow> Rows(IQueryable<Showtime> showtimes) =>
        showtimes.Select(s => new ShowtimeRow(
            s.Id,
            s.MovieId,
            new ShowtimeMovie(s.Movie.Id, s.Movie.TitleTh, s.Movie.TitleEn, s.Movie.PosterUrl, s.Movie.DurationMin),
            new ShowtimeTheatre(s.Theatre.Id, s.Theatre.Name, s.Theatre.ScreenType),
            s.StartsAt,
            s.EndsAt,
            s.BasePrice,
            s.Status,
            s.ZonePrices.ToList(),
            s.Theatre.Seats.Count(seat => seat.IsActive),
            s.BookingSeats.Count(bs => bs.Seat.IsActive)));

    private static ShowtimeResponse Shape(ShowtimeRow s) => new(
        s.Id,
        s.MovieId,
        s.Movie,
        s.Theatre,
        s.StartsAt,
        s.EndsAt,
        s.BasePrice,
        s.Status,
        Pricing.ToPriceMap(s.ZonePrices, s.BasePrice),
        s.TotalSeats,
        Math.Max(s.TotalSeats - s.TakenSeats, 0));

    /// <summary>
    /// includeCancelled ใช้ฝั่งผู้ดูแล — รอบที่ยกเลิกแล้วต้องยังเห็นในตาราง ไม่งั้นรอบจะหายไปเฉย ๆ
    /// จนไม่รู้ว่าถูกยกเลิกหรือถูกลบ ส่วนหน้าลูกค้าเห็นเฉพาะรอบที่ยังขายอยู่
    /// </summary>
    public async Task<List<ShowtimeResponse>> ListAsync(
        string? movieId, string? theatreId, string? date, bool includePast = false, bool includeCancelled = false)
    {
        var query = db.Showtimes.AsNoTracking();
        if (!includeCancelled) query = query.Where(s => s.Status == ShowtimeStatus.SCHEDULED);
        if (movieId is not null) query = query.Where(s => s.MovieId == movieId);
        if (theatreId is not null) query = query.Where(s => s.TheatreId == theatreId);

        var now = time.UtcNowMs();
        if (date is not null)
        {
            var range = BangkokTime.DayRange(date) ?? throw InvalidDate();
            // ในวันนี้ ไม่ต้องแสดงรอบที่เริ่มฉายไปแล้ว
            var from = includePast ? range.Start : (range.Start > now ? range.Start : now);
            query = query.Where(s => s.StartsAt >= from && s.StartsAt < range.End);
        }
        else if (!includePast)
        {
            query = query.Where(s => s.StartsAt >= now);
        }

        // หลายโรงมักเริ่มเวลาเดียวกัน — SQL ไม่รับประกันลำดับของค่าที่เท่ากัน ถ้าไม่เรียงต่อด้วยชื่อโรง
        // การ์ดโรงในหน้าหนัง (จัดกลุ่มตามลำดับที่เจอ) จะสลับที่กันไปมาระหว่างการโหลดแต่ละครั้ง
        var rows = await Rows(query.OrderBy(s => s.StartsAt).ThenBy(s => s.Theatre.Name)).ToListAsync();
        return rows.Select(Shape).ToList();
    }

    public async Task<ShowtimeResponse> GetByIdAsync(string id)
    {
        var row = await Rows(db.Showtimes.AsNoTracking().Where(s => s.Id == id)).FirstOrDefaultAsync() ?? throw ShowtimeNotFound();
        return Shape(row);
    }

    /// <summary>
    /// ผังที่นั่งของรอบฉาย
    /// ทุกแถวใน BookingSeat = ที่นั่งที่ยังถูกยึดอยู่จริง (การจองที่ยกเลิก/หมดอายุจะถูกลบทิ้ง)
    /// จึงแยกได้แค่ว่าเป็น BOOKED (จ่ายแล้ว) หรือ HELD (กำลังรอชำระ/รอตรวจสลิป
    /// รวมที่นั่งใหม่ที่กันไว้ให้คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง แม้การจองนั้นจะจ่ายแล้วก็ตาม)
    /// </summary>
    public async Task<SeatMapResponse> GetSeatMapAsync(string showtimeId)
    {
        var showtime = await db.Showtimes.AsNoTracking()
            .Where(s => s.Id == showtimeId)
            .Select(s => new
            {
                s.Id,
                s.StartsAt,
                s.EndsAt,
                s.BasePrice,
                s.TheatreId,
                Movie = new ShowtimeMovie(s.Movie.Id, s.Movie.TitleTh, s.Movie.TitleEn, s.Movie.PosterUrl, s.Movie.DurationMin),
                Theatre = new ShowtimeTheatre(s.Theatre.Id, s.Theatre.Name, s.Theatre.ScreenType),
                ZonePrices = s.ZonePrices.ToList(),
            })
            .FirstOrDefaultAsync() ?? throw ShowtimeNotFound();

        var seats = await db.Seats.AsNoTracking()
            .Where(seat => seat.IsActive && seat.TheatreId == showtime.TheatreId)
            .OrderBy(seat => seat.RowLabel).ThenBy(seat => seat.SeatNumber)
            .ToListAsync();
        var occupied = await db.BookingSeats.AsNoTracking()
            .Where(bs => bs.ShowtimeId == showtimeId)
            .Select(bs => new { bs.SeatId, bs.SeatChangeId, bs.Booking.Status })
            .ToListAsync();

        var statusBySeatId = new Dictionary<string, string>();
        foreach (var row in occupied)
        {
            statusBySeatId[row.SeatId] = row.Status == BookingStatus.PAID && row.SeatChangeId is null ? "BOOKED" : "HELD";
        }

        var prices = Pricing.ToPriceMap(showtime.ZonePrices, showtime.BasePrice);
        var rows = seats
            .GroupBy(seat => seat.RowLabel)
            .Select(g => new SeatMapRow(
                g.Key,
                g.Select(seat => new SeatMapSeat(
                    seat.Id,
                    seat.SeatNumber,
                    seat.Zone,
                    prices[seat.Zone],
                    statusBySeatId.GetValueOrDefault(seat.Id, "AVAILABLE"))).ToList()))
            .ToList();

        return new SeatMapResponse(
            new SeatMapShowtime(showtime.Id, showtime.StartsAt, showtime.EndsAt, showtime.BasePrice, showtime.Movie, showtime.Theatre),
            prices,
            rows,
            // นับจากที่นั่งในผังที่ยังไม่มีใครยึด — statusBySeatId อาจมีที่นั่งที่จองแล้วค่อยปิดใช้งาน ซึ่งไม่อยู่ในผัง
            new SeatMapStats(seats.Count, seats.Count(seat => !statusBySeatId.ContainsKey(seat.Id))));
    }

    // ---------- ฝั่ง Admin ----------

    public async Task AssertNoOverlapAsync(string theatreId, DateTime startsAt, DateTime endsAt, string? excludeId = null)
    {
        var buffer = TimeSpan.FromMinutes(TurnaroundMinutes);
        var upper = endsAt + buffer;
        var lower = startsAt - buffer;
        var query = db.Showtimes.AsNoTracking()
            .Where(s => s.TheatreId == theatreId && s.Status == ShowtimeStatus.SCHEDULED && s.StartsAt < upper && s.EndsAt > lower);
        if (excludeId is not null) query = query.Where(s => s.Id != excludeId);
        var clash = await query.Select(s => new { s.Id, s.StartsAt, s.EndsAt, s.Movie.TitleTh }).FirstOrDefaultAsync();

        if (clash is not null)
        {
            throw ApiException.Conflict(
                "SHOWTIME_OVERLAP",
                $"รอบนี้ชนกับรอบของเรื่อง \"{clash.TitleTh}\" ในโรงเดียวกัน (ต้องเว้นอย่างน้อย {TurnaroundMinutes} นาที)",
                new { conflictingShowtimeId = clash.Id, startsAt = clash.StartsAt, endsAt = clash.EndsAt });
        }
    }

    /// <summary>
    /// คำนวณว่าโรงนี้ในวันนี้ มีรอบไหนจองเวลาไว้แล้วบ้าง และเหลือช่วงไหนที่ลงรอบใหม่ได้
    /// ใช้กฎเดียวกับ AssertNoOverlapAsync (เว้นอย่างน้อย TurnaroundMinutes ทั้งหัวและท้าย)
    /// ให้ server เป็นคนคิด เพื่อไม่ให้ client ต้องเขียนกฎซ้ำแล้วหลุดจากกันภายหลัง
    /// </summary>
    public async Task<AvailabilityResponse> GetAvailabilityAsync(string theatreId, string date, string movieId, string? excludeId)
    {
        var range = BangkokTime.DayRange(date) ?? throw InvalidDate();
        var windowStart = range.Start.AddHours(OpenHour);
        var windowEnd = range.Start.AddHours(CloseHour);

        var movie = await db.Movies.AsNoTracking().FirstOrDefaultAsync(m => m.Id == movieId)
            ?? throw ApiException.NotFound("MOVIE_NOT_FOUND", "ไม่พบภาพยนตร์เรื่องนี้");

        var buffer = TimeSpan.FromMinutes(TurnaroundMinutes);
        var upper = windowEnd + buffer;
        var lower = windowStart - buffer;
        // เอาเฉพาะรอบที่คาบเกี่ยวกับช่วงเวลาทำการของวันนั้นจริง ๆ (เผื่อ buffer หัวท้าย)
        // ถ้าดึงกว้างกว่านี้ รอบของเมื่อวานจะติดมาแสดงในรายการทั้งที่ไม่ได้ชนกับช่องเวลาที่เสนอ
        var query = db.Showtimes.AsNoTracking()
            .Where(s => s.TheatreId == theatreId && s.Status == ShowtimeStatus.SCHEDULED && s.StartsAt < upper && s.EndsAt > lower);
        if (excludeId is not null) query = query.Where(s => s.Id != excludeId);
        var showtimes = await query
            .OrderBy(s => s.StartsAt)
            .Select(s => new AvailabilityBusy(s.Id, s.StartsAt, s.EndsAt, new AvailabilityMovie(s.Movie.TitleTh, s.Movie.TitleEn)))
            .ToListAsync();

        var duration = TimeSpan.FromMinutes(movie.DurationMin);
        bool ConflictsAt(DateTime start)
        {
            var end = start + duration;
            return showtimes.Any(s => s.StartsAt < end + buffer && s.EndsAt > start - buffer);
        }

        var notBefore = time.UtcNowMs();
        var freeSlots = new List<string>();
        for (var t = windowStart; t + duration <= windowEnd; t = t.AddMinutes(SlotStepMinutes))
        {
            if (t < notBefore) continue;
            if (!ConflictsAt(t)) freeSlots.Add(JsonDefaults.FormatIso(t));
        }

        return new AvailabilityResponse(TurnaroundMinutes, movie.DurationMin, SlotStepMinutes, showtimes, freeSlots);
    }

    /// <summary>โรงที่ผู้ดูแลปิดไว้ (ปิดซ่อม เลิกใช้) ต้องรับรอบใหม่ไม่ได้ — ทางเลือกแทนการลบโรงที่มีประวัติการจอง</summary>
    private async Task<Theatre> FindActiveTheatreAsync(string theatreId)
    {
        var theatre = await db.Theatres.AsNoTracking().FirstOrDefaultAsync(t => t.Id == theatreId)
            ?? throw ApiException.NotFound("THEATRE_NOT_FOUND", "ไม่พบโรงภาพยนตร์นี้");
        if (!theatre.IsActive)
        {
            throw ApiException.BadRequest("THEATRE_INACTIVE", $"โรง \"{theatre.Name}\" ปิดใช้งานอยู่ ลงรอบฉายใหม่ไม่ได้");
        }
        return theatre;
    }

    public async Task<ShowtimeResponse> CreateAsync(string movieId, string theatreId, DateTime startsAt, int basePrice)
    {
        var movie = await db.Movies.AsNoTracking().FirstOrDefaultAsync(m => m.Id == movieId)
            ?? throw ApiException.NotFound("MOVIE_NOT_FOUND", "ไม่พบภาพยนตร์เรื่องนี้");

        await FindActiveTheatreAsync(theatreId);

        var start = Clock.TruncateToMs(startsAt);
        var end = start.AddMinutes(movie.DurationMin);
        await AssertNoOverlapAsync(theatreId, start, end);

        var showtime = new Showtime
        {
            MovieId = movieId,
            TheatreId = theatreId,
            StartsAt = start,
            EndsAt = end,
            BasePrice = basePrice,
        };
        showtime.ZonePrices = Pricing.BuildZonePrices(basePrice)
            .Select(zp => new ZonePrice { ShowtimeId = showtime.Id, Zone = zp.Zone, Price = zp.Price })
            .ToList();
        db.Showtimes.Add(showtime);
        await db.SaveChangesAsync();
        return await GetByIdAsync(showtime.Id);
    }

    /// <summary>
    /// แก้รอบฉาย — ย้ายเวลา/โรง และ/หรือเปลี่ยนราคา
    /// การยกเลิกรอบไม่ได้ทำผ่านที่นี่ ต้องใช้ BookingService.CancelShowtimeAsync ซึ่งปิดการจองและเข้าคิวคืนเงินให้ด้วย
    /// </summary>
    public async Task<ShowtimeResponse> UpdateAsync(string id, string? theatreIdInput, DateTime? startsAtInput, int? basePrice)
    {
        var existing = await db.Showtimes.Include(s => s.Movie).FirstOrDefaultAsync(s => s.Id == id) ?? throw ShowtimeNotFound();
        if (existing.Status == ShowtimeStatus.CANCELLED)
        {
            throw ApiException.Conflict("SHOWTIME_ALREADY_CANCELLED", "รอบนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้");
        }

        var theatreId = theatreIdInput ?? existing.TheatreId;
        var start = startsAtInput is { } input ? Clock.TruncateToMs(input) : existing.StartsAt;
        var end = start.AddMinutes(existing.Movie.DurationMin);

        // หน้าแก้รอบส่งเวลาและโรงมาทุกครั้งแม้ไม่ได้แตะ จึงต้องดูว่า "ค่าเปลี่ยนจริง" ไม่ใช่แค่ "มีส่งมา"
        // ไม่งั้นรอบที่มีคนจองแล้วจะแก้ราคาไม่ได้เลย ทั้งที่ไม่ได้ย้ายเวลาหรือโรง
        var theatreChanged = theatreId != existing.TheatreId;
        var moving = theatreChanged || start != existing.StartsAt;

        if (moving)
        {
            var bookedCount = await db.BookingSeats.CountAsync(bs => bs.ShowtimeId == id);
            if (bookedCount > 0)
            {
                throw ApiException.Conflict(
                    "SHOWTIME_HAS_BOOKINGS",
                    "รอบนี้มีการจองแล้ว ไม่สามารถย้ายเวลา/โรงได้ (ยกเลิกรอบแทนหากจำเป็น)");
            }
            if (theatreChanged) await FindActiveTheatreAsync(theatreId);
            await AssertNoOverlapAsync(theatreId, start, end, id);
        }

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            if (basePrice is not null)
            {
                await db.ZonePrices.Where(zp => zp.ShowtimeId == id).ExecuteDeleteAsync();
                db.ZonePrices.AddRange(Pricing.BuildZonePrices(basePrice.Value)
                    .Select(zp => new ZonePrice { ShowtimeId = id, Zone = zp.Zone, Price = zp.Price }));
                existing.BasePrice = basePrice.Value;
            }
            if (moving)
            {
                existing.TheatreId = theatreId;
                existing.StartsAt = start;
                existing.EndsAt = end;
            }
            db.Entry(existing).Property(s => s.UpdatedAt).CurrentValue = time.UtcNowMs();
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }

        return await GetByIdAsync(id);
    }

    /// <summary>
    /// ลบรอบได้เฉพาะรอบที่ไม่เคยมีใครจองเลย
    ///
    /// นับทุกการจองที่เคยมี ไม่ใช่แค่ที่นั่งที่ยังถูกยึด — การจองที่ยกเลิกแล้วไม่มี BookingSeat เหลือ
    /// แต่ยังผูกกับรายการชำระเงินและคิวคืนเงินอยู่ ลบรอบทีเดียวทุกอย่างถูก cascade หายตามไปเงียบ ๆ
    /// (ลูกค้าที่รอเงินคืนจะไม่ได้เงิน และไม่เหลือหลักฐานว่าเคยจ่าย) รอบที่ไม่ใช้แล้วให้ "ยกเลิกรอบ" แทน
    /// </summary>
    public async Task DeleteAsync(string id)
    {
        var bookingCount = await db.Bookings.CountAsync(b => b.ShowtimeId == id);
        if (bookingCount > 0)
        {
            throw ApiException.Conflict(
                "SHOWTIME_HAS_BOOKINGS",
                "รอบนี้มีประวัติการจอง ลบไม่ได้เพราะประวัติและรายการคืนเงินจะหายไปด้วย — ใช้ \"ยกเลิกรอบ\" แทน",
                new { bookingCount });
        }
        var deleted = await db.Showtimes.Where(s => s.Id == id).ExecuteDeleteAsync();
        if (deleted == 0) throw ApiException.NotFound();
    }
}
