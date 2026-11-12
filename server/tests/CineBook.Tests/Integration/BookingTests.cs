using CineBook.Tests.Helpers;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/bookings.test.js และ holds.test.js</summary>
[Trait("Category", "Integration")]
public sealed class BookingTests(ApiFactory factory) : IntegrationTest(factory)
{
    private Task<BookingResponse> CreateBooking(User user, ShowtimeResponse showtime, params Seat[] seats) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CreateAsync(user.Id, showtime.Id, seats.Select(s => s.Id).ToList()));

    // ---------- สร้างการจอง ----------

    [Fact]
    public async Task สองคนกดจองที่นั่งเดียวกันพร้อมกัน_ได้คนเดียว_อีกคนได้SEAT_TAKENพร้อมชื่อที่นั่ง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var alice = await Fx.CreateUser();
        var bob = await Fx.CreateUser();

        var results = await Fixtures.AllSettled(
            () => CreateBooking(alice, showtime, seats[0], seats[1]),
            () => CreateBooking(bob, showtime, seats[0], seats[1]));

        Assert.Single(results, r => r.Ok);
        var error = Fixtures.AsApiError(Assert.Single(results, r => !r.Ok).Error, "SEAT_TAKEN");
        Assert.Equal("""["A1","A2"]""", Fixtures.DetailsOf(error)!["seats"]!.ToJsonString());
        Assert.Equal(2, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.ShowtimeId == showtime.Id)));
    }

    [Fact]
    public async Task จองชุดที่นั่งซ้อนกันโดยเลือกคนละลำดับพร้อมกัน_ได้SEAT_TAKENไม่ใช่deadlock()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();

        for (var i = 0; i + 1 < 10; i += 2)
        {
            // คนใหม่ทุกรอบ — คนเดิมจองรอบเดิมซ้ำขณะยังมีใบรอชำระอยู่จะติดนโยบายกักที่นั่งแทน
            var alice = await Fx.CreateUser();
            var bob = await Fx.CreateUser();
            var (x, y) = (seats[i], seats[i + 1]);
            var results = await Fixtures.AllSettled(
                () => CreateBooking(alice, showtime, x, y),
                () => CreateBooking(bob, showtime, y, x));
            var failed = Assert.Single(results, r => !r.Ok);
            Fixtures.AsApiError(failed.Error, "SEAT_TAKEN");
        }
    }

    [Fact]
    public async Task ที่นั่งของโรงอื่นใช้จองรอบนี้ไม่ได้()
    {
        var (showtime, _, _, _) = await Fx.CreateShowtimeFixture();
        var other = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();

        await Fixtures.ExpectApiError(CreateBooking(user, showtime, other.Seats[0]), "INVALID_SEATS", 400);
    }

    // ---------- หมดเวลาชำระเงิน ----------

    [Fact]
    public async Task jobปล่อยที่นั่งของการจองที่เลยเวลา_และแจ้งเตือนลูกค้า()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0], seats[1]);
        var past = Fixtures.MinutesFromNow(-1);
        await Fx.Exec(db => db.Bookings.Where(b => b.Id == booking.Id).ExecuteUpdateAsync(s => s.SetProperty(b => b.HoldExpiresAt, past)));

        Assert.Equal(1, await Fx.Use<BookingService, int>(bookings => bookings.ReleaseExpiredHoldsAsync()));
        Assert.Equal(BookingStatus.EXPIRED, (await Fx.BookingOf(booking.Id))!.Status);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOf(booking.Id))!.Status);
        Assert.Equal(0, await Fx.CountHeldSeats(booking.Id));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.BOOKING_EXPIRED));
    }

    [Fact]
    public async Task jobที่ถือรายการเก่ามา_ต้องไม่ทับการจองที่เพิ่งส่งสลิป()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);

        // เหมือน job ที่ดึงรายการไว้ก่อนลูกค้าส่งสลิป แล้วเพิ่งวนมาถึงใบนี้ (เวลาใน job ผ่านกำหนดไปแล้ว)
        var expired = await Fx.Use<BookingService, bool>(bookings =>
            bookings.ExpireAsync(booking.Id, booking.Code, user.Id, Fixtures.MinutesFromNow(60)));

        Assert.False(expired);
        Assert.Equal(BookingStatus.PENDING_VERIFICATION, (await Fx.BookingOf(booking.Id))!.Status);
        Assert.Equal(PaymentStatus.PENDING_VERIFICATION, (await Fx.PaymentOf(booking.Id))!.Status);
        Assert.Equal(1, await Fx.CountHeldSeats(booking.Id));
        Assert.Equal(0, await Fx.CountNotifications(NotificationType.BOOKING_EXPIRED));
    }

    // ---------- ยกเลิกการจอง ----------

    [Fact]
    public async Task กดยกเลิกซ้ำพร้อมกัน_ยกเลิกครั้งเดียว_แจ้งเตือนใบเดียว()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);

        Task<BookingResponse> Cancel() => Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(booking.Id, user.Id, byAdmin: false, null, RefundAccount.None));
        var results = await Fixtures.AllSettled(Cancel, Cancel);

        Assert.Single(results, r => r.Ok);
        var failure = Fixtures.AsApiError(Assert.Single(results, r => !r.Ok).Error);
        Assert.Contains(failure.Code, new[] { "ALREADY_CLOSED", "BOOKING_STATE_CHANGED" });
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.BOOKING_CANCELLED));
    }

    // ---------- นโยบายกักที่นั่ง (holds.test.js) ----------

    [Fact]
    public async Task มีใบรอชำระของรอบเดียวกันอยู่แล้ว_ให้ไปจ่ายใบเดิมก่อน_พร้อมบอกรหัสและที่นั่งเดิม()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var first = await Fx.Book(user, showtime, seats[0], seats[1]);

        var error = await Fixtures.ExpectApiError(CreateBooking(user, showtime, seats[2]), "PENDING_BOOKING_EXISTS");
        var details = Fixtures.DetailsOf(error)!;
        Assert.Equal(first.Id, details["bookingId"]!.GetValue<string>());
        Assert.Equal("""["A1","A2"]""", details["seats"]!.ToJsonString());
    }

    [Fact]
    public async Task ใบเดิมส่งสลิปแล้ว_จองเพิ่มในรอบเดียวกันได้ตามปกติ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var first = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(first, user);

        var second = await Fx.Book(user, showtime, seats[1]);
        Assert.Equal(BookingStatus.PENDING_PAYMENT, second.Status);
    }

    [Fact]
    public async Task ถือที่นั่งค้างได้ไม่เกินเพดาน_รวมทุกรอบ()
    {
        var user = await Fx.CreateUser();
        var fixtures = new List<ShowtimeFixture>();
        foreach (var day in new[] { 1, 2, 3, 4 })
        {
            fixtures.Add(await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(day * 24 * 60)));
        }
        foreach (var fixture in fixtures.Take(3)) await Fx.Book(user, fixture.Showtime, fixture.Seats[0]);

        var fourth = fixtures[3];
        await Fixtures.ExpectApiError(Fx.Book(user, fourth.Showtime, fourth.Seats[0]), "TOO_MANY_PENDING_BOOKINGS", 409);
    }
}
