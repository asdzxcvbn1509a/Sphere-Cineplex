using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Helpers;

/// <summary>รอบฉายพร้อมใช้ — ที่นั่งเรียงตามแถวแล้วเลขที่ (A1, A2, …)</summary>
public sealed record ShowtimeFixture(ShowtimeResponse Showtime, Movie Movie, string TheatreId, List<Seat> Seats);

/// <summary>สลิปที่เก็บลงที่เก็บแล้ว — Path ไว้ให้เทสต์เช็กว่าไฟล์ยังอยู่หรือถูกลบ ส่วน service ใช้แค่ Slip (ชื่อไฟล์)</summary>
public sealed record SlipFixture(string Path, StoredSlip Slip)
{
    public string FileName => Slip.FileName;
}

/// <summary>
/// ข้อมูลทดสอบ (port จาก test/helpers/fixtures.js) — สร้างผ่าน service ตัวจริงเมื่อเป็นไปได้
/// แต่ละเมธอดเปิด scope ของตัวเอง เรียกพร้อมกันจากหลายงานได้
/// </summary>
public sealed class Fixtures(ApiFactory factory)
{
    private static int _counter;

    private static int Next() => Interlocked.Increment(ref _counter);

    public static DateTime MinutesFromNow(double minutes) =>
        CineBook.Web.Infrastructure.Clock.TruncateToMs(DateTime.UtcNow.AddMinutes(minutes));

    public async Task<T> WithScope<T>(Func<IServiceProvider, Task<T>> action)
    {
        using var scope = factory.Services.CreateScope();
        return await action(scope.ServiceProvider);
    }

    public async Task WithScope(Func<IServiceProvider, Task> action)
    {
        using var scope = factory.Services.CreateScope();
        await action(scope.ServiceProvider);
    }

    /// <summary>เรียก service หนึ่งครั้งใน scope ใหม่ (DbContext ใหม่) — ใช้ยิงพร้อมกันได้</summary>
    public Task<T> Use<TService, T>(Func<TService, Task<T>> action) where TService : notnull =>
        WithScope(sp => action(sp.GetRequiredService<TService>()));

    public Task Use<TService>(Func<TService, Task> action) where TService : notnull =>
        WithScope(sp => action(sp.GetRequiredService<TService>()));

    /// <summary>ผู้ใช้ทดสอบ — passwordHash ใส่ค่าหลอก เคสที่ต้องล็อกอินจริงให้ส่งรหัสผ่านมา</summary>
    public Task<User> CreateUser(Role role = Role.USER, string? name = null, string? password = null) =>
        WithScope(async sp =>
        {
            var n = Next();
            var user = new User
            {
                Email = $"user{n}@test.local",
                Phone = $"08{n:D8}",
                PasswordHash = password is null ? "not-a-real-hash" : sp.GetRequiredService<PasswordHasher>().Hash(password),
                Name = name ?? $"ผู้ใช้ทดสอบ {n}",
                Role = role,
            };
            var db = sp.GetRequiredService<AppDbContext>();
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user;
        });

    public Task<User> CreateAdmin(string? name = null, string? password = null) => CreateUser(Role.ADMIN, name, password);

    /// <summary>ผู้ใช้ในรูปที่ service รับเป็นผู้ขอ (requester) — แบบ req.user เดิม</summary>
    public static CurrentUser As(User user) => new(user.Id, user.Phone, user.Name, user.Email, user.Role);

    public Task<Movie> CreateMovie(int durationMin = 120) =>
        WithScope(async sp =>
        {
            var n = Next();
            var movie = new Movie
            {
                TitleTh = $"หนังทดสอบ {n}",
                TitleEn = $"Test Movie {n}",
                PosterUrl = "https://example.com/poster.jpg",
                DurationMin = durationMin,
                ReleaseDate = MinutesFromNow(0),
            };
            var db = sp.GetRequiredService<AppDbContext>();
            db.Movies.Add(movie);
            await db.SaveChangesAsync();
            return movie;
        });

    /// <summary>โรงเล็ก 3 แถว × 4 ที่ (แถว A ธรรมดา, B–C พรีเมียม) = 12 ที่นั่ง</summary>
    public Task<TheatreDetailResponse> CreateSmallTheatre(int rowsCount = 3, int colsCount = 4) =>
        Use<TheatreService, TheatreDetailResponse>(theatres => theatres.CreateAsync($"โรงทดสอบ {Next()}", "2D", rowsCount, colsCount));

    /// <summary>
    /// รอบฉายพร้อมใช้ — ค่าเริ่มต้นคือพรุ่งนี้ (เลยกติกายกเลิกล่วงหน้า 3 ชั่วโมงไปไกล)
    /// ส่ง movie/theatre เดิมมาได้เมื่อต้องการหลายรอบในโรงเดียวกัน (ต้องเว้นเวลาไม่ให้ชนกันเอง)
    /// </summary>
    public async Task<ShowtimeFixture> CreateShowtimeFixture(
        DateTime? startsAt = null, Movie? movie = null, string? theatreId = null, int basePrice = 200)
    {
        var theMovie = movie ?? await CreateMovie();
        var theTheatreId = theatreId ?? (await CreateSmallTheatre()).Id;
        var showtime = await Use<ShowtimeService, ShowtimeResponse>(showtimes =>
            showtimes.CreateAsync(theMovie.Id, theTheatreId, startsAt ?? MinutesFromNow(24 * 60), basePrice));
        var seats = await WithScope(sp => sp.GetRequiredService<AppDbContext>().Seats.AsNoTracking()
            .Where(s => s.TheatreId == theTheatreId)
            .OrderBy(s => s.RowLabel).ThenBy(s => s.SeatNumber)
            .ToListAsync());
        return new ShowtimeFixture(showtime, theMovie, theTheatreId, seats);
    }

    public Task<BookingResponse> Book(User user, ShowtimeResponse showtime, params Seat[] seats) =>
        Use<BookingService, BookingResponse>(bookings => bookings.CreateAsync(user.Id, showtime.Id, seats.Select(s => s.Id).ToList()));

    // PNG 1×1 จริง ๆ — ผ่านการตรวจ magic bytes ได้
    public static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

    /// <summary>
    /// เลียนแบบสิ่งที่ตัวรับไฟล์ส่งต่อให้ service: ไฟล์ถูกเก็บลงที่เก็บแล้ว (เทสต์ใช้ดิสก์) + ชื่อไฟล์
    /// </summary>
    public async Task<SlipFixture> MakeSlipFile(SlipKind kind = SlipKind.Payment, byte[]? content = null, string ext = ".png")
    {
        var config = factory.Config;
        var dir = kind == SlipKind.Refund ? config.RefundSlipDir : config.PaymentSlipDir;
        Directory.CreateDirectory(dir);
        var fileName = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Codes.FileId()}{ext}";
        var path = System.IO.Path.Combine(dir, fileName);
        await File.WriteAllBytesAsync(path, content ?? TinyPng);
        return new SlipFixture(path, new StoredSlip(fileName, kind));
    }

    public static bool FileExists(string path) => File.Exists(path);

    /// <summary>ส่งสลิปให้การจอง (สถานะ → PENDING_VERIFICATION)</summary>
    public async Task<PaymentPageResponse> SubmitSlip(BookingResponse booking, User user)
    {
        var file = await MakeSlipFile();
        return await Use<PaymentService, PaymentPageResponse>(payments => payments.UploadSlipAsync(booking.Id, user.Id, file.Slip));
    }

    /// <summary>จองแล้วจ่ายจนเป็น PAID — คืนการจองล่าสุด</summary>
    public async Task<BookingResponse> CreatePaidBooking(User user, User admin, ShowtimeResponse showtime, params Seat[] seats)
    {
        var booking = await Book(user, showtime, seats);
        await SubmitSlip(booking, user);
        var payment = await PaymentOf(booking.Id);
        return await Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(payment!.Id, admin.Id));
    }

    /// <summary>ใบชำระเงินหลัก (ค่าตั๋วตอนจอง) — รายการส่วนต่างจากการเปลี่ยนที่นั่งใช้ PaymentOfSeatChange</summary>
    public Task<Payment?> PaymentOf(string bookingId) =>
        WithScope(sp => sp.GetRequiredService<AppDbContext>().Payments.AsNoTracking().FirstOrDefaultAsync(p => p.MainBookingId == bookingId));

    /// <summary>รายการเงินส่วนต่างของคำขอเปลี่ยนที่นั่ง (โอนเพิ่มหรือคืน)</summary>
    public Task<Payment?> PaymentOfSeatChange(string seatChangeId) =>
        WithScope(sp => sp.GetRequiredService<AppDbContext>().Payments.AsNoTracking().FirstOrDefaultAsync(p => p.SeatChangeId == seatChangeId));

    public Task<Booking?> BookingOf(string bookingId) =>
        WithScope(sp => sp.GetRequiredService<AppDbContext>().Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == bookingId));

    /// <summary>คำสั่งอ่าน/เขียนฐานข้อมูลตรง ๆ ใน scope ใหม่ (แทน prisma.x.count/update ในเทสต์เดิม)</summary>
    public Task<T> Query<T>(Func<AppDbContext, Task<T>> action) =>
        WithScope(sp => action(sp.GetRequiredService<AppDbContext>()));

    public Task Exec(Func<AppDbContext, Task> action) =>
        WithScope(sp => action(sp.GetRequiredService<AppDbContext>()));

    public Task<int> CountNotifications(NotificationType type) =>
        Query(db => db.Notifications.CountAsync(n => n.Type == type));

    public Task<int> CountHeldSeats(string bookingId) =>
        Query(db => db.BookingSeats.CountAsync(bs => bs.BookingId == bookingId));

    /// <summary>ตรวจว่างานล้มด้วย ApiException รหัสที่คาดไว้ (คู่กับ Assert.ThrowsAnyAsync เดิม)</summary>
    public static async Task<ApiException> ExpectApiError(Task task, string code, int? status = null)
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => task);
        Assert.Equal(code, error.Code);
        if (status is not null) Assert.Equal(status, error.Status);
        return error;
    }

    /// <summary>ตรวจ error ที่ได้จาก Task.WhenAll แบบ allSettled — คืน ApiException ตัวนั้น</summary>
    public static ApiException AsApiError(Exception? error, string? code = null, int? status = null)
    {
        var api = Assert.IsType<ApiException>(error);
        if (code is not null) Assert.Equal(code, api.Code);
        if (status is not null) Assert.Equal(status, api.Status);
        return api;
    }

    /// <summary>details ของ ApiException ในรูป JSON ที่ส่งออกจริง (camelCase)</summary>
    public static JsonNode? DetailsOf(ApiException error) =>
        error.Details is null ? null : JsonSerializer.SerializeToNode(error.Details, JsonDefaults.Api);

    /// <summary>ผลของงานที่ยิงพร้อมกัน — แบบ Promise.allSettled</summary>
    public sealed record Settled<T>(T? Value, Exception? Error)
    {
        public bool Ok => Error is null;
    }

    public static async Task<List<Settled<T>>> AllSettled<T>(params Func<Task<T>>[] tasks)
    {
        async Task<Settled<T>> Run(Func<Task<T>> task)
        {
            try
            {
                return new Settled<T>(await task(), null);
            }
            catch (Exception error)
            {
                return new Settled<T>(default, error);
            }
        }

        // เริ่มทุกงานก่อนแล้วค่อยรอ ให้ชนกันจริง (Task.Run กันงานแรกวิ่งจนจบก่อนงานที่สองจะเริ่ม)
        return [.. await Task.WhenAll(tasks.Select(task => Task.Run(() => Run(task))))];
    }
}
