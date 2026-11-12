using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using static CineBook.Web.Seed.SeedTime;

namespace CineBook.Web.Seed;

/// <summary>ตารางรอบฉายของ seed (port จาก prisma/seed/schedule.js)</summary>
public static class SeedSchedule
{
    /// <summary>มีรอบย้อนหลังกี่วัน (หน้ารายงานเปิดมาที่ 7 วันล่าสุด จึงเผื่อไว้ให้เลื่อนดูได้อีกนิด) และล่วงหน้ากี่วัน (รวมวันนี้)</summary>
    public const int HistoryDays = 10;
    public const int DaysAhead = 7;

    /// <summary>รอบสุดท้ายต้องจบภายในเที่ยงคืน — ช่วงเดียวกับที่หน้าลงรอบของผู้ดูแลเสนอให้ (GetAvailabilityAsync)</summary>
    private const int CloseHour = 24;

    /// <summary>ชั่วโมงตามเวลาไทยของเวลานั้น</summary>
    public static int BangkokHour(long ms) => BangkokTime.Hour(At(ms));

    /// <summary>วันในสัปดาห์ตามเวลาไทย (0 = อาทิตย์)</summary>
    public static int BangkokWeekday(long ms) => (int)BangkokTime.ToBangkok(At(ms)).DayOfWeek;

    /// <summary>คีย์วันที่ (YYYY-MM-DD ตามเวลาไทย) ที่ห่างจากวันนี้ offset วัน</summary>
    public static string DayKeyFrom(long now, int offset) => BangkokTime.DateKey(At(now + offset * Day));

    /// <summary>
    /// ราคาตั้งต้นของรอบ — เสาร์อาทิตย์ +20 · วันธรรมดารอบก่อนบ่ายโมง −20
    /// ราคาต่อโซนสร้างจากค่านี้ด้วย Pricing.BuildZonePrices แบบเดียวกับตอนผู้ดูแลลงรอบเอง
    /// </summary>
    public static int ShowtimePrice(SeedTheatre theatre, long startsAt)
    {
        var weekday = BangkokWeekday(startsAt);
        if (weekday is 0 or 6) return theatre.Data.BasePrice + 20;
        if (BangkokHour(startsAt) < 13) return theatre.Data.BasePrice - 20;
        return theatre.Data.BasePrice;
    }

    /// <summary>
    /// หนังเรื่องนี้มีรอบในวันที่ day (นับจากวันนี้) ได้ไหม — เข้าฉายแล้วและยังไม่เลิกฉาย
    /// หนัง "เร็ว ๆ นี้" ไม่มีรอบเลย เพราะหน้าเว็บยังไม่เปิดขายบัตรเรื่องที่สถานะเป็น COMING_SOON
    /// </summary>
    private static bool ShowingOn(SeedMovie movie, int day)
    {
        if (movie.Data.Status == MovieStatus.COMING_SOON) return false;
        return movie.Data.ReleaseInDays <= day && (movie.Data.LastShowInDays ?? int.MaxValue) >= day;
    }

    /// <summary>
    /// จัดตารางรอบของทุกโรง ตั้งแต่ HistoryDays วันก่อนถึง DaysAhead วันข้างหน้า
    /// แต่ละโรงเริ่มรอบแรกตาม OpensAt แล้วต่อรอบถัดไปหลังรอบก่อนจบ + เวลาทำความสะอาด (TurnaroundMinutes) + ช่วงพักสุ่ม
    /// กติกาเดียวกับ AssertNoOverlapAsync จึงไม่มีรอบไหนชนกัน และเวลาเริ่มไม่ซ้ำกันทุกวัน
    /// </summary>
    public static List<SeedShowtime> Build(IReadOnlyList<SeedMovie> movies, IReadOnlyList<SeedTheatre> theatres, SeedRandom random, long now)
    {
        var shows = new List<SeedShowtime>();

        for (var day = -HistoryDays; day < DaysAhead; day += 1)
        {
            var start = Ms(BangkokTime.DayRange(DayKeyFrom(now, day))!.Value.Start);
            var closeMs = start + CloseHour * 60 * Minute;

            foreach (var theatre in theatres)
            {
                if (theatre.Data.ClosedFromDay is { } closedFrom && day >= closedFrom) continue;
                var eligible = movies.Where(movie => movie.Data.Formats.Contains(theatre.ScreenType) && ShowingOn(movie, day)).ToList();
                if (eligible.Count == 0) continue;

                var (openHour, openMinute) = theatre.Data.OpensAt;
                var cursor = start + (openHour * 60 + openMinute) * Minute;
                SeedMovie? previous = null;

                while (true)
                {
                    // ปัดเวลาเริ่มเป็นทุก 5 นาที ให้ดูเป็นตารางรอบจริง
                    var startMs = (cursor + 5 * Minute - 1) / (5 * Minute) * 5 * Minute;
                    var fits = eligible.Where(movie => startMs + movie.Data.DurationMin * Minute <= closeMs).ToList();
                    if (fits.Count == 0) break;
                    // ไม่ฉายเรื่องเดิมติดกันสองรอบในโรงเดียว ถ้ายังมีเรื่องอื่นให้เลือก
                    var pool = fits.Count > 1 ? fits.Where(movie => movie != previous).ToList() : fits;
                    var movie = random.Weighted(pool, item => item.Data.Popularity)!;

                    var endsAt = startMs + movie.Data.DurationMin * Minute;
                    shows.Add(new SeedShowtime
                    {
                        Movie = movie,
                        Theatre = theatre,
                        StartsAt = startMs,
                        EndsAt = endsAt,
                        BasePrice = ShowtimePrice(theatre, startMs),
                    });

                    previous = movie;
                    cursor = endsAt + (ShowtimeService.TurnaroundMinutes + random.Int(2, 8) * 5) * Minute;
                }
            }
        }

        return shows;
    }
}
