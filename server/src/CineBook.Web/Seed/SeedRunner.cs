using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static CineBook.Web.Seed.SeedTime;

namespace CineBook.Web.Seed;

/// <summary>
/// ข้อมูลตัวอย่างของระบบ (port จาก prisma/seed.js) — ล้างทุกตารางแล้วสร้างใหม่ทั้งหมด
/// เรียกด้วย <c>dotnet run --project src/CineBook.Web -- seed</c>
///
/// 1. แคตตาล็อก: ผู้ใช้ หนัง โรง ที่นั่ง และรอบฉายย้อนหลัง HistoryDays วันถึงล่วงหน้า DaysAhead วัน (SeedCatalog, SeedSchedule)
/// 2. ประวัติการขายที่จบแล้ว เขียนลงฐานตรงพร้อมเวลาย้อนหลัง (SeedSales)
/// 3. สถานการณ์ที่ยังเดินอยู่ เรียก service ตัวจริง (SeedScenarios)
/// รูปสลิปตัวอย่างเก็บลงที่เก็บสลิปเดียวกับ API (ดิสก์ หรือ Azure Blob ถ้าตั้ง AZURE_STORAGE_CONNECTION_STRING)
/// </summary>
public static class SeedRunner
{
    /// <summary>
    /// รหัสผ่านของบัญชีตัวอย่าง — Password123 เขียนอยู่ใน README ใช้ได้แค่ตอนพัฒนา
    /// seed เว็บที่เปิดให้คนนอกเข้าได้ต้องตั้ง SEED_PASSWORD ไม่งั้นใครก็ล็อกอินเป็นผู้ดูแลได้ (ดู DEPLOY.md)
    /// </summary>
    private const string DemoPassword = "Password123";

    public static async Task RunAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        try
        {
            await SeedAsync(sp);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"❌ seed ล้มเหลว: {ex}");
            Environment.ExitCode = 1;
        }
    }

    private static async Task SeedAsync(IServiceProvider sp)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        var config = sp.GetRequiredService<AppConfig>();

        var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
        if (pending.Count > 0)
        {
            if (!config.DbMigrateOnStart)
            {
                throw new InvalidOperationException(
                    "ฐานข้อมูลยังไม่ได้ migrate — รัน dotnet ef database update หรือตั้ง DB_MIGRATE_ON_START=true ก่อน seed");
            }
            await db.Database.MigrateAsync();
        }

        Console.WriteLine("🌱 เริ่ม seed ข้อมูล...");
        var now = NowMs();
        var random = new SeedRandom();
        await ResetAsync(db);

        var seedPassword = Environment.GetEnvironmentVariable("SEED_PASSWORD") is { Length: > 0 } custom ? custom : null;
        var (admins, users) = await SeedUsersAsync(db, sp.GetRequiredService<PasswordHasher>(), seedPassword ?? DemoPassword, now);
        var movies = await SeedMoviesAsync(db, now);
        var theatres = await SeedTheatresAsync(db);
        var showtimes = await SeedShowtimesAsync(db, movies, theatres, random, now);

        var world = new SeedWorld
        {
            Now = now,
            Random = random,
            Admin = admins["admin"],
            Staff = admins["staff"],
            Users = users,
            Bookers = users.Values.Where(user => user.Activity > 0).ToList(),
            Showtimes = showtimes,
            Inventory = theatres.ToDictionary(theatre => theatre.Id, theatre => SeedSeating.BuildInventory(theatre.Seats)),
        };

        var slips = new SeedSlips(sp.GetRequiredService<ISlipStorage>());
        var targets = SeedScenarios.ChooseTargets(world);
        var pinned = await new SeedSales(world, db, config, slips).RunAsync(SeedScenarios.PinsFor(world, targets), targets);
        var scenarios = new SeedScenarios(
            world,
            db,
            slips,
            sp.GetRequiredService<BookingService>(),
            sp.GetRequiredService<PaymentService>(),
            sp.GetRequiredService<SeatChangeService>(),
            sp.GetRequiredService<ShowtimeService>());
        var notes = await scenarios.RunAsync(targets, pinned);

        await PrintSummaryAsync(db, config, slips, now, notes);

        Console.WriteLine("\n✅ seed เสร็จสมบูรณ์");
        Console.WriteLine("   ผู้ดูแลระบบ : admin@cinebook.test (หรือเบอร์ 0800000000) · staff@cinebook.test");
        Console.WriteLine("   ผู้ใช้ทั่วไป : somchai@example.test (หรือเบอร์ 0891234567) — มีการจองครบทุกแท็บ");
        Console.WriteLine($"   ลูกค้าอื่น ๆ : {SeedCatalog.Customers.Length - 1} บัญชี @example.test (ดูรายชื่อใน Seed/SeedCatalog.cs)");
        // รหัสที่ตั้งเองไม่พิมพ์ออกมา — กันไปค้างอยู่ใน log หรือประวัติเทอร์มินัล
        Console.WriteLine($"   รหัสผ่านทุกบัญชี : {(seedPassword is null ? DemoPassword : "(ตามค่า SEED_PASSWORD)")}");
        Console.WriteLine($"   ⏱  การจองที่ยังรอชำระจะหมดเวลาภายใน {config.SeatHoldMinutes} นาทีหลังเปิด API ตามกติกาจริง\n");
        if (SlipsOnWrongMachine(config))
        {
            Console.WriteLine("   ⚠  ฐานข้อมูลไม่ได้อยู่บนเครื่องนี้ แต่ไม่ได้ตั้ง AZURE_STORAGE_CONNECTION_STRING — รูปสลิปตัวอย่างถูกเขียนลงดิสก์ของเครื่องนี้");
            Console.WriteLine("      เว็บที่ใช้ฐานนี้จะเปิดรูปสลิปไม่ได้ ให้ตั้ง AZURE_STORAGE_CONNECTION_STRING แล้ว seed ใหม่ (ดู DEPLOY.md)\n");
        }
    }

    /// <summary>ลบตามลำดับความสัมพันธ์ เพื่อให้รัน seed ซ้ำได้เสมอ</summary>
    private static async Task ResetAsync(AppDbContext db)
    {
        await db.Notifications.ExecuteDeleteAsync();
        await db.BookingSeats.ExecuteDeleteAsync();
        await db.Payments.ExecuteDeleteAsync();
        await db.SeatChanges.ExecuteDeleteAsync();
        // ตัวนับเลขใบเสร็จเริ่มใหม่ด้วย ใบตัวอย่างจะได้เริ่มที่ 000001
        await db.ReceiptCounters.ExecuteDeleteAsync();
        await db.Bookings.ExecuteDeleteAsync();
        await db.ZonePrices.ExecuteDeleteAsync();
        await db.Showtimes.ExecuteDeleteAsync();
        await db.Seats.ExecuteDeleteAsync();
        await db.Theatres.ExecuteDeleteAsync();
        await db.Movies.ExecuteDeleteAsync();
        await db.RefreshTokens.ExecuteDeleteAsync();
        await db.PasswordResetTokens.ExecuteDeleteAsync();
        await db.Users.ExecuteDeleteAsync();
    }

    private static async Task<(Dictionary<string, User> Admins, Dictionary<string, SeedUser> Users)> SeedUsersAsync(
        AppDbContext db, PasswordHasher hasher, string password, long now)
    {
        // hash ครั้งเดียวแล้วใช้ร่วมกัน — bcrypt ตั้งใจให้ช้า ทำซ้ำทุกบัญชีจะหน่วง seed โดยไม่จำเป็น
        var passwordHash = hasher.Hash(password);
        User Create(SeedPerson person, Role role)
        {
            var joinedAt = At(now - person.JoinedDaysAgo * Day);
            var user = new User
            {
                Email = person.Email,
                Phone = person.Phone,
                Name = person.Name,
                Role = role,
                PasswordHash = passwordHash,
                CreatedAt = joinedAt,
                UpdatedAt = joinedAt,
            };
            db.Users.Add(user);
            return user;
        }

        var admins = SeedCatalog.Admins.ToDictionary(admin => admin.Key, admin => Create(admin, Role.ADMIN));
        var users = new Dictionary<string, SeedUser>();
        foreach (var customer in SeedCatalog.Customers) users[customer.Key] = new SeedUser(Create(customer, Role.USER), customer.Activity);
        await db.SaveChangesAsync();
        return (admins, users);
    }

    private static async Task<List<SeedMovie>> SeedMoviesAsync(AppDbContext db, long now)
    {
        var movies = new List<SeedMovie>();
        foreach (var data in SeedCatalog.Movies)
        {
            var releaseDate = DateTime.SpecifyKind(
                DateTime.ParseExact(SeedSchedule.DayKeyFrom(now, data.ReleaseInDays), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                DateTimeKind.Utc);
            var movie = new Movie
            {
                TitleTh = data.TitleTh,
                TitleEn = data.TitleEn,
                SynopsisTh = data.SynopsisTh,
                SynopsisEn = data.SynopsisEn,
                PosterUrl = data.PosterUrl,
                BackdropUrl = data.BackdropUrl,
                DurationMin = data.DurationMin,
                Rating = data.Rating,
                Genres = [.. data.Genres],
                Status = data.Status,
                ReleaseDate = releaseDate,
            };
            db.Movies.Add(movie);
            movies.Add(new SeedMovie(movie, data));
        }
        await db.SaveChangesAsync();
        return movies;
    }

    private static async Task<List<SeedTheatre>> SeedTheatresAsync(AppDbContext db)
    {
        var theatres = new List<SeedTheatre>();
        foreach (var data in SeedCatalog.Theatres)
        {
            var theatre = new Theatre
            {
                Name = data.Name,
                ScreenType = data.ScreenType,
                RowsCount = data.RowsCount,
                ColsCount = data.ColsCount,
                IsActive = data.IsActive,
            };
            var broken = new HashSet<string>(data.BrokenSeats ?? []);
            // เรียงตามที่สร้าง (แถวแล้วเลขที่) — ลำดับแถวในผังมีผลกับลำดับการสุ่มที่นั่ง
            var seats = TheatreService.BuildSeatGrid(data.RowsCount, data.ColsCount)
                .Select(seat => new Seat
                {
                    TheatreId = theatre.Id,
                    RowLabel = seat.RowLabel,
                    SeatNumber = seat.SeatNumber,
                    Zone = seat.Zone,
                    IsActive = !broken.Contains(Seats.SeatLabel(seat.RowLabel, seat.SeatNumber)),
                })
                .ToList();
            db.Theatres.Add(theatre);
            db.Seats.AddRange(seats);
            theatres.Add(new SeedTheatre(theatre, data, seats));
        }
        await db.SaveChangesAsync();
        return theatres;
    }

    private static async Task<List<SeedShowtime>> SeedShowtimesAsync(
        AppDbContext db, List<SeedMovie> movies, List<SeedTheatre> theatres, SeedRandom random, long now)
    {
        var schedule = SeedSchedule.Build(movies, theatres, random, now);
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        foreach (var show in schedule)
        {
            var showtime = new Showtime
            {
                MovieId = show.Movie.Id,
                TheatreId = show.Theatre.Id,
                StartsAt = At(show.StartsAt),
                EndsAt = At(show.EndsAt),
                BasePrice = show.BasePrice,
            };
            db.Showtimes.Add(showtime);
            show.Id = showtime.Id;
            show.ZonePrices = Pricing.BuildZonePrices(show.BasePrice);
            show.PriceMap = Pricing.ToPriceMap(show.ZonePrices, show.BasePrice);
            db.ZonePrices.AddRange(show.ZonePrices.Select(zp => new ZonePrice { ShowtimeId = showtime.Id, Zone = zp.Zone, Price = zp.Price }));
        }
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync();
        db.ChangeTracker.AutoDetectChangesEnabled = true;
        db.ChangeTracker.Clear();
        return schedule;
    }

    private static string FormatCounts<TKey>(IEnumerable<(TKey Key, int Count)> counts) =>
        string.Join(" · ", counts.Select(item => $"{item.Key} {item.Count}"));

    private static async Task PrintSummaryAsync(AppDbContext db, AppConfig config, SeedSlips slips, long nowMs, List<string> notes)
    {
        var now = At(nowMs);
        var users = await db.Users.GroupBy(u => u.Role).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var movies = await db.Movies.GroupBy(m => m.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var theatresActive = await db.Theatres.CountAsync(t => t.IsActive);
        var theatresInactive = await db.Theatres.CountAsync(t => !t.IsActive);
        var shown = await db.Showtimes.CountAsync(s => s.StartsAt <= now);
        var upcoming = await db.Showtimes.CountAsync(s => s.StartsAt > now);
        var cancelled = await db.Showtimes.CountAsync(s => s.Status == ShowtimeStatus.CANCELLED);
        var bookings = await db.Bookings.GroupBy(b => b.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var payments = await db.Payments.GroupBy(p => p.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var seatChanges = await db.SeatChanges.GroupBy(c => c.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var pendingSlips = await db.Payments.CountAsync(PaymentService.PendingSlip);
        var notifications = await db.Notifications.CountAsync();
        var unread = await db.Notifications.CountAsync(n => n.ReadAt == null);
        var (paymentSlips, refundSlips) = slips.Counts;
        var storage = config.IsBlobStorageConfigured
            ? $"Azure Blob container \"{config.AzureSlipContainer}\""
            : Path.GetRelativePath(config.ServerRoot, config.SlipDir);

        Console.WriteLine($"   ✓ ผู้ใช้: {FormatCounts(users.Select(u => (u.Key, u.Count)))}");
        Console.WriteLine($"   ✓ ภาพยนตร์: {FormatCounts(movies.Select(m => (m.Key, m.Count)))}");
        Console.WriteLine($"   ✓ โรง: เปิด {theatresActive} · ปิดใช้งาน {theatresInactive}");
        Console.WriteLine($"   ✓ รอบฉาย: ฉายไปแล้ว {shown} · กำลังจะฉาย {upcoming} · ถูกยกเลิก {cancelled} " +
            $"(ย้อนหลัง {SeedSchedule.HistoryDays} วัน ถึงล่วงหน้า {SeedSchedule.DaysAhead} วัน)");
        Console.WriteLine($"   ✓ การจอง: {FormatCounts(bookings.Select(b => (b.Key, b.Count)))}");
        Console.WriteLine($"   ✓ รายการเงิน: {FormatCounts(payments.Select(p => (p.Key, p.Count)))} (สลิปรอตรวจในคิว {pendingSlips})");
        Console.WriteLine($"   ✓ คำขอเปลี่ยนที่นั่ง: {FormatCounts(seatChanges.Select(c => (c.Key, c.Count)))}");
        Console.WriteLine($"   ✓ แจ้งเตือน {notifications} รายการ (ยังไม่อ่าน {unread})");
        Console.WriteLine($"   ✓ รูปสลิปตัวอย่าง: โอนเข้า {paymentSlips} · โอนคืน {refundSlips} → {storage}");
        foreach (var note in notes) Console.WriteLine($"   • {note}");
    }

    private static readonly HashSet<string> LocalHosts = new(StringComparer.OrdinalIgnoreCase) { "localhost", "127.0.0.1", "::1", "[::1]" };

    /// <summary>
    /// ฐานข้อมูลอยู่เครื่องอื่น (เช่น seed เว็บจริงตาม DEPLOY.md) แต่ไม่ได้ตั้ง Azure Blob — รูปสลิปตัวอย่างจึงไปอยู่ในดิสก์
    /// ของเครื่องที่รัน seed ซึ่ง API บนเซิร์ฟเวอร์มองไม่เห็น ผู้ดูแลจะเจอแต่ "ไม่มีรูปสลิป" ทุกใบ
    /// </summary>
    private static bool SlipsOnWrongMachine(AppConfig config)
    {
        if (config.IsBlobStorageConfigured) return false;
        try
        {
            var host = new NpgsqlConnectionStringBuilder(DatabaseUrl.ToNpgsql(config.DatabaseUrl)).Host ?? "";
            return !host.Split(',').All(LocalHosts.Contains);
        }
        catch (Exception)
        {
            return false;
        }
    }
}
