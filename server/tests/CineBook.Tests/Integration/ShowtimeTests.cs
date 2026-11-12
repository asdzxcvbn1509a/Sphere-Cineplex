using CineBook.Tests.Helpers;
using CineBook.Web.Jobs;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Requests;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/showtimes.test.js</summary>
[Trait("Category", "Integration")]
public sealed class ShowtimeTests(ApiFactory factory) : IntegrationTest(factory)
{
    private Task<BookingService.CancelShowtimeResult> CancelShowtime(string showtimeId, string? reason = null) =>
        Fx.WithScope(sp => sp.GetRequiredService<BookingService>()
            .CancelShowtimeAsync(showtimeId, reason, sp.GetRequiredService<ShowtimeService>()));

    private Task<BookingResponse> CancelBooking(string bookingId, User? user = null) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, user?.Id, byAdmin: user is null, null, RefundAccount.None));

    private Task<BookingResponse> UpdateRefundAccount(string bookingId, User user, string bankName, string accountNo, string? accountName = null) =>
        Fx.Use<BookingService, BookingResponse>(bookings => bookings.UpdateRefundAccountAsync(bookingId, user.Id, bankName, accountNo, accountName));

    private Task<int> SendReminders() => Fx.Use<ShowtimeReminders, int>(reminders => reminders.SendAsync());

    private Task<int> DeactivateSeats(string theatreId, params Seat[] seats) =>
        Fx.Use<TheatreService, int>(theatres => theatres.UpdateSeatsAsync(theatreId, seats.Select(s => s.Id).ToList(), null, false));

    private Task<ShowtimeResponse> GetShowtime(string id) => Fx.Use<ShowtimeService, ShowtimeResponse>(showtimes => showtimes.GetByIdAsync(id));

    private Task<SeatMapResponse> GetSeatMap(string id) => Fx.Use<ShowtimeService, SeatMapResponse>(showtimes => showtimes.GetSeatMapAsync(id));

    // ---------- ยกเลิกทั้งรอบ ----------

    [Fact]
    public async Task ยกเลิกทั้งรอบ_ใบที่จ่ายแล้วเข้าคิวคืนเงิน_ใบที่รอจ่ายถูกปิด_ที่นั่งถูกคืน_และทุกคนได้แจ้งเตือน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var paidUser = await Fx.CreateUser();
        var pendingUser = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(paidUser, admin, showtime, seats[0], seats[1]);
        var pending = await Fx.Book(pendingUser, showtime, seats[2]);

        var result = await CancelShowtime(showtime.Id, "เครื่องฉายเสีย");

        Assert.Equal(2, result.CancelledBookings);
        Assert.Equal(1, result.RefundsQueued);
        Assert.Equal(ShowtimeStatus.CANCELLED, result.Showtime.Status);

        Assert.Equal(BookingStatus.CANCELLED, (await Fx.BookingOf(paid.Id))!.Status);
        Assert.Equal(BookingStatus.CANCELLED, (await Fx.BookingOf(pending.Id))!.Status);
        Assert.Contains("เครื่องฉายเสีย", (await Fx.BookingOf(paid.Id))!.CancelReason);
        Assert.Equal(0, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.ShowtimeId == showtime.Id)));

        var paidPayment = (await Fx.PaymentOf(paid.Id))!;
        Assert.Equal(PaymentStatus.REFUND_PENDING, paidPayment.Status);
        Assert.NotNull(paidPayment.RefundDueAt);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOf(pending.Id))!.Status);

        var notes = await Fx.Query(db => db.Notifications.Where(n => n.Type == NotificationType.SHOWTIME_CANCELLED).ToListAsync());
        Assert.Equal(2, notes.Count);
        Assert.Contains("แจ้งบัญชีรับเงินคืน", notes.Single(n => n.UserId == paidUser.Id).BodyTh);
        Assert.DoesNotContain("แจ้งบัญชีรับเงินคืน", notes.Single(n => n.UserId == pendingUser.Id).BodyTh);
    }

    [Fact]
    public async Task ยังมีสลิปรอตรวจ_ไม่ยกเลิกให้_และไม่แตะอะไรเลย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);

        await Fixtures.ExpectApiError(CancelShowtime(showtime.Id), "SHOWTIME_HAS_PENDING_SLIPS", 409);
        Assert.Equal(ShowtimeStatus.SCHEDULED, await Fx.Query(db => db.Showtimes.Where(s => s.Id == showtime.Id).Select(s => s.Status).FirstAsync()));
        Assert.Equal(BookingStatus.PENDING_VERIFICATION, (await Fx.BookingOf(booking.Id))!.Status);
    }

    [Fact]
    public async Task รอบที่ยกเลิกแล้วกดซ้ำไม่ได้_และจองเพิ่มไม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        await CancelShowtime(showtime.Id);

        await Fixtures.ExpectApiError(CancelShowtime(showtime.Id), "SHOWTIME_ALREADY_CANCELLED", 409);
        await Fixtures.ExpectApiError(Fx.Book(user, showtime, seats[0]), "SHOWTIME_CANCELLED", 400);
    }

    [Fact]
    public async Task รอบที่ฉายจบไปแล้วยกเลิกย้อนหลังไม่ได้()
    {
        var (showtime, _, _, _) = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(-180));
        await Fixtures.ExpectApiError(CancelShowtime(showtime.Id), "SHOWTIME_ENDED", 409);
    }

    [Fact]
    public async Task ไม่ส่งใกล้ถึงเวลาฉายให้รอบที่ถูกยกเลิก()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(45));
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        // ข้อมูลเก่าที่ยกเลิกผ่าน PATCH แบบเดิม
        await Fx.Exec(db => db.Showtimes.Where(s => s.Id == showtime.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, ShowtimeStatus.CANCELLED)));

        Assert.Equal(0, await SendReminders());
    }

    // ---------- ลูกค้าแจ้งบัญชีรับเงินคืนเอง ----------

    [Fact]
    public async Task ใบที่รอคืนเงินแจ้งบัญชีได้_คนอื่นแก้ไม่ได้_และใบที่ไม่ได้รอคืนเงินแจ้งไม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var owner = await Fx.CreateUser();
        var stranger = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(owner, admin, showtime, seats[0]);
        var unpaid = await Fx.Book(owner, showtime, seats[1]);

        await Fixtures.ExpectApiError(UpdateRefundAccount(paid.Id, owner, "กสิกรไทย", "1234567890"), "REFUND_NOT_PENDING", 409);

        await CancelBooking(paid.Id);
        await Fixtures.ExpectApiError(UpdateRefundAccount(paid.Id, stranger, "กสิกรไทย", "1234567890"), "NOT_BOOKING_OWNER", 403);

        var updated = await UpdateRefundAccount(paid.Id, owner, " กสิกรไทย ", "1234567890", "  วรรณกร จิตณา  ");
        Assert.Equal("กสิกรไทย", updated.Payment!.RefundBankName);
        Assert.Equal("1234567890", updated.Payment.RefundAccountNo);
        Assert.Equal("วรรณกร จิตณา", updated.Payment.RefundAccountName);

        // client รุ่นก่อนไม่ส่งชื่อมา — เปลี่ยนบัญชีได้ตามเดิม และชื่อของบัญชีเก่าไม่ติดมากับบัญชีใหม่
        var withoutName = await UpdateRefundAccount(paid.Id, owner, "ไทยพาณิชย์", "9876543210");
        Assert.Equal("ไทยพาณิชย์", withoutName.Payment!.RefundBankName);
        Assert.Null(withoutName.Payment.RefundAccountName);

        await Fixtures.ExpectApiError(UpdateRefundAccount(unpaid.Id, owner, "กสิกรไทย", "1234567890"), "REFUND_NOT_PENDING", 409);
    }

    // ---------- ด่านกันลบข้อมูลที่ยังผูกกับเงิน ----------

    [Fact]
    public async Task ลบรอบที่การจองถูกยกเลิกหมดแล้วไม่ได้_คิวคืนเงินต้องไม่หาย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await CancelBooking(paid.Id);

        await Fixtures.ExpectApiError(Fx.Use<ShowtimeService>(showtimes => showtimes.DeleteAsync(showtime.Id)), "SHOWTIME_HAS_BOOKINGS", 409);
        Assert.Equal(PaymentStatus.REFUND_PENDING, (await Fx.PaymentOf(paid.Id))!.Status);
    }

    [Fact]
    public async Task รอบที่ไม่เคยมีการจองลบได้ตามปกติ()
    {
        var (showtime, _, _, _) = await Fx.CreateShowtimeFixture();
        await Fx.Use<ShowtimeService>(showtimes => showtimes.DeleteAsync(showtime.Id));
        Assert.Equal(0, await Fx.Query(db => db.Showtimes.CountAsync(s => s.Id == showtime.Id)));
    }

    [Fact]
    public async Task ลบโรงที่เคยมีการจองแม้ยกเลิกไปแล้วไม่ได้()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await CancelBooking(booking.Id, user);

        await Fixtures.ExpectApiError(Fx.Use<TheatreService>(theatres => theatres.DeleteAsync(theatreId)), "THEATRE_HAS_BOOKINGS", 409);
    }

    [Fact]
    public async Task ลบหนังถาวรไม่ได้ถ้ายังมีการจองค้าง_แต่ลบได้เมื่อจบแล้วและไม่เคยออกใบเสร็จ()
    {
        var (showtime, movie, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var pending = await Fx.Book(user, showtime, seats[0]);

        Task<MovieService.DeleteResult> DeleteMovie() =>
            Fx.Use<MovieService, MovieService.DeleteResult>(movies => movies.DeleteAsync(movie.Id, force: true));
        await Fixtures.ExpectApiError(DeleteMovie(), "MOVIE_HAS_OPEN_BOOKINGS", 409);

        // ยกเลิกแล้ว ไม่มีอะไรค้างและไม่มีใบเสร็จ → ผู้ดูแลยืนยันลบถาวรได้
        await CancelBooking(pending.Id, user);
        Assert.True((await DeleteMovie()).Deleted);
    }

    [Fact]
    public async Task ลบหนังที่ออกใบเสร็จไปแล้วถาวรไม่ได้_แม้คืนเงินครบแล้ว()
    {
        var (showtime, movie, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await CancelBooking(paid.Id);
        await Fx.Exec(db => db.Payments.Where(p => p.MainBookingId == paid.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Status, PaymentStatus.REFUNDED)));

        // ใบเสร็จต้องอยู่เป็นหลักฐาน
        await Fixtures.ExpectApiError(
            Fx.Use<MovieService, MovieService.DeleteResult>(movies => movies.DeleteAsync(movie.Id, force: true)), "MOVIE_HAS_RECEIPTS", 409);
        Assert.Equal(1, await Fx.Query(db => db.Movies.CountAsync(m => m.Id == movie.Id)));
    }

    // ---------- แก้ไขรอบฉาย ----------

    [Fact]
    public async Task แก้ราคารอบที่มีคนจองแล้วได้_แม้หน้าเว็บส่งเวลาและโรงเดิมมาด้วย()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        await Fx.Book(user, showtime, seats[0]);

        var updated = await Fx.Use<ShowtimeService, ShowtimeResponse>(showtimes =>
            showtimes.UpdateAsync(showtime.Id, theatreId, showtime.StartsAt, 250));
        Assert.Equal(250, updated.BasePrice);
        Assert.Equal(250, updated.Prices[SeatZone.NORMAL]);
    }

    [Fact]
    public async Task ย้ายเวลารอบที่มีคนจองแล้วยังไม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        await Fx.Book(user, showtime, seats[0]);

        await Fixtures.ExpectApiError(
            Fx.Use<ShowtimeService, ShowtimeResponse>(showtimes => showtimes.UpdateAsync(showtime.Id, null, showtime.StartsAt.AddHours(1), null)),
            "SHOWTIME_HAS_BOOKINGS",
            409);
    }

    [Fact]
    public async Task โรงที่ปิดใช้งานลงรอบใหม่ไม่ได้()
    {
        var movie = await Fx.CreateMovie();
        var theatre = await Fx.CreateSmallTheatre();
        await Fx.Use<TheatreService, TheatreDetailResponse>(theatres =>
            theatres.UpdateAsync(theatre.Id, new UpdateTheatreRequest { IsActive = false }));

        await Fixtures.ExpectApiError(
            Fx.Use<ShowtimeService, ShowtimeResponse>(showtimes =>
                showtimes.CreateAsync(movie.Id, theatre.Id, Fixtures.MinutesFromNow(24 * 60), 200)),
            "THEATRE_INACTIVE",
            400);
    }

    // ---------- ที่นั่งที่ปิดใช้งาน ----------

    [Fact]
    public async Task ที่นั่งที่ปิดใช้งานไม่นับเป็นที่ว่าง_จองที่นั่งที่เปิดขายครบแล้วรอบต้องเต็ม_ทั้งรายการรอบ_ผังที่นั่ง_และรายงาน()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var first = await Fx.CreateUser();
        var second = await Fx.CreateUser();
        // ปิด C3–C4 เหลือที่นั่งที่เปิดขาย 10 จาก 12
        await DeactivateSeats(theatreId, seats[10], seats[11]);

        var listed = await GetShowtime(showtime.Id);
        Assert.Equal(10, listed.TotalSeats);
        Assert.Equal(10, listed.AvailableSeats);

        await Fx.Book(first, showtime, [.. seats.Take(5)]);
        await Fx.Book(second, showtime, [.. seats.Skip(5).Take(5)]);

        // หน้าเรื่องตัดสิน "เต็มแล้ว" จาก availableSeats === 0
        Assert.Equal(0, (await GetShowtime(showtime.Id)).AvailableSeats);
        Assert.Equal(new SeatMapStats(10, 0), (await GetSeatMap(showtime.Id)).Stats);
        var occupancy = (await Fx.Use<ReportService, List<OccupancyRow>>(reports => reports.GetOccupancyReportAsync(null, null)))[0];
        Assert.Equal(10, occupancy.TotalSeats);
        Assert.Equal(10, occupancy.SoldSeats);
        Assert.Equal(100, occupancy.Occupancy);
    }

    [Fact]
    public async Task ที่นั่งที่จองแล้วค่อยปิดใช้งาน_จำนวนว่างในรายการรอบเท่ากับในผังที่นั่ง()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        await Fx.Book(user, showtime, seats[0]);
        await DeactivateSeats(theatreId, seats[0]);

        Assert.Equal(11, (await GetShowtime(showtime.Id)).AvailableSeats);
        Assert.Equal(new SeatMapStats(11, 11), (await GetSeatMap(showtime.Id)).Stats);
    }

    // ---------- แจ้งเตือนก่อนฉาย ----------

    [Fact]
    public async Task jobสองตัวทำงานพร้อมกัน_ลูกค้าได้แจ้งเตือนครั้งเดียว()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(45));
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        var results = await Fixtures.AllSettled(SendReminders, SendReminders);

        Assert.All(results, r => Assert.True(r.Ok, r.Error?.ToString()));
        Assert.Equal(1, results.Sum(r => r.Value));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.SHOWTIME_REMINDER));
    }
}
