using System.Net;
using CineBook.Tests.Helpers;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/admin-bookings.test.js และ overview.test.js</summary>
[Trait("Category", "Integration")]
public sealed class AdminBookingTests(ApiFactory factory) : IntegrationTest(factory)
{
    private static readonly RefundAccount RefundAccount = new("ธนาคารกสิกรไทย", "1234567890", "สมหมาย ใจดี");

    private Task<PageResult<BookingResponse>> ListAll(
        BookingStatus? status = null, IEnumerable<string>? displayStatuses = null, string? q = null, int? pageSize = null) =>
        Fx.Use<BookingService, PageResult<BookingResponse>>(bookings =>
            bookings.ListAllAsync(status, displayStatuses?.ToList(), null, q, null, pageSize));

    private static List<string> IdsOf(PageResult<BookingResponse> result) =>
        [.. result.Rows.Select(item => item.Id).Order(StringComparer.Ordinal)];

    private static List<string> Sorted(IEnumerable<string> ids) => [.. ids.Order(StringComparer.Ordinal)];

    private Task<SeatChangeService.ChangeResult> RequestChange(BookingResponse booking, User user, Seat seat, RefundAccount? account = null) =>
        Fx.Use<SeatChangeService, SeatChangeService.ChangeResult>(changes =>
            changes.RequestAsync(booking.Id, user.Id, [seat.Id], account ?? Web.Services.RefundAccount.None));

    private Task<BookingResponse> CancelBooking(string bookingId, User? user = null) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, user?.Id, byAdmin: user is null, null, Web.Services.RefundAccount.None));

    private async Task CompleteRefund(string paymentId, User admin)
    {
        var file = await Fx.MakeSlipFile(SlipKind.Refund);
        await Fx.Use<PaymentService>(payments => payments.CompleteRefundAsync(paymentId, admin.Id, null, file.Slip));
    }

    private sealed record EveryStatus(Dictionary<string, List<string>> Expected, BookingResponse DiffRefunded, BookingResponse CancelledRefunded);

    /// <summary>
    /// การจองอย่างน้อยหนึ่งใบต่อหนึ่งป้าย ทำผ่าน service จริงทั้งหมด
    /// คืน Expected = { ป้ายที่ควรได้: [bookingId...] } · คืนเงินสำเร็จมีสองใบ: คืนส่วนต่าง (ยัง PAID) กับยกเลิกแล้วคืน
    /// โรง 3 แถว × 10 ที่: A1–A10 ธรรมดา 200 · B1–B10 พรีเมียม 280 — ลูกค้าคนละบัญชีทุกใบ ไม่ชนเพดานกักที่นั่งต่อคน
    /// </summary>
    private async Task<EveryStatus> BuildEveryStatus()
    {
        var theatre = await Fx.CreateSmallTheatre(rowsCount: 3, colsCount: 10);
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture(theatreId: theatre.Id);
        var admin = await Fx.CreateAdmin();
        Seat A(int number) => seats[number - 1];
        Seat B(int number) => seats[9 + number];

        var expected = BookingDisplayStatus.All.ToDictionary(status => status, _ => new List<string>());
        void Add(string status, BookingResponse booking) => expected[status].Add(booking.Id);
        async Task<(User User, BookingResponse Booking)> PaidOn(Seat seat)
        {
            var user = await Fx.CreateUser();
            return (user, await Fx.CreatePaidBooking(user, admin, showtime, seat));
        }

        Add("PENDING_PAYMENT", await Fx.Book(await Fx.CreateUser(), showtime, A(1)));

        {
            var user = await Fx.CreateUser();
            var booking = await Fx.Book(user, showtime, A(2));
            await Fx.SubmitSlip(booking, user);
            Add("PENDING_VERIFICATION", booking);
        }

        Add("PAID", (await PaidOn(A(3))).Booking);

        // ขอย้ายไปที่แพงกว่า — ยังไม่โอนส่วนต่าง
        {
            var (user, booking) = await PaidOn(A(4));
            await RequestChange(booking, user, B(1));
            Add("TOPUP_PENDING_PAYMENT", booking);
        }

        // โอนส่วนต่างแล้ว สลิปรอผู้ดูแลตรวจ
        {
            var (user, booking) = await PaidOn(A(5));
            var change = await RequestChange(booking, user, B(2));
            var file = await Fx.MakeSlipFile();
            await Fx.Use<SeatChangeService, SeatChangeDetailResponse>(changes =>
                changes.UploadSlipAsync(change.SeatChange.Id, Fixtures.As(user), file.Slip));
            Add("TOPUP_PENDING_VERIFICATION", booking);
        }

        // ย้ายไปที่ถูกกว่า — ส่วนต่างรอโอนคืน แล้วอีกใบโอนคืนไปแล้ว (การจองยังใช้ได้ทั้งคู่)
        async Task<(BookingResponse Booking, Payment Refund)> MoveCheaper(Seat from, Seat to)
        {
            var (user, booking) = await PaidOn(from);
            var change = await RequestChange(booking, user, to, RefundAccount);
            return (booking, (await Fx.PaymentOfSeatChange(change.SeatChange.Id))!);
        }
        Add("DIFF_REFUND_PENDING", (await MoveCheaper(B(3), A(6))).Booking);
        var diffRefunded = await MoveCheaper(B(4), A(7));
        await CompleteRefund(diffRefunded.Refund.Id, admin);
        Add("REFUNDED", diffRefunded.Booking);

        // ผู้ดูแลยกเลิกใบที่จ่ายแล้ว — รอโอนคืน แล้วอีกใบโอนคืนไปแล้ว
        {
            var (_, booking) = await PaidOn(A(8));
            await CancelBooking(booking.Id);
            Add("CANCELLED_REFUND_PENDING", booking);
        }
        var cancelledRefunded = (await PaidOn(A(9))).Booking;
        await CancelBooking(cancelledRefunded.Id);
        await CompleteRefund((await Fx.PaymentOf(cancelledRefunded.Id))!.Id, admin);
        Add("REFUNDED", cancelledRefunded);

        // ลูกค้ายกเลิกเองก่อนจ่าย — ไม่มีเงินค้าง
        {
            var user = await Fx.CreateUser();
            var booking = await Fx.Book(user, showtime, A(10));
            await CancelBooking(booking.Id, user);
            Add("CANCELLED", booking);
        }

        // หมดเวลาชำระด้วย job จริง
        {
            var booking = await Fx.Book(await Fx.CreateUser(), showtime, B(5));
            var past = Fixtures.MinutesFromNow(-1);
            await Fx.Exec(db => db.Bookings.Where(b => b.Id == booking.Id).ExecuteUpdateAsync(s => s.SetProperty(b => b.HoldExpiresAt, past)));
            Assert.Equal(1, await Fx.Use<BookingService, int>(bookings => bookings.ReleaseExpiredHoldsAsync()));
            Add("EXPIRED", booking);
        }

        return new EveryStatus(expected, diffRefunded.Booking, cancelledRefunded);
    }

    [Fact]
    public async Task ทุกใบได้ป้ายตามเรื่องเงินที่ค้างจริง_และกรองแต่ละป้ายได้ใบชุดเดียวกับที่ป้ายบอก()
    {
        var (expected, diffRefunded, cancelledRefunded) = await BuildEveryStatus();
        // ทุกป้ายมีตัวอย่าง — เพิ่มป้ายใหม่แล้วลืมสร้างข้อมูลทดสอบ เทสต์นี้จะเตือน
        foreach (var status in BookingDisplayStatus.All) Assert.True(expected[status].Count > 0, $"ไม่มีตัวอย่างของ {status}");

        var all = await ListAll(pageSize: 100);
        var labelOf = all.Rows.ToDictionary(item => item.Id, item => item.DisplayStatus);
        foreach (var (status, ids) in expected)
        {
            foreach (var id in ids) Assert.True(labelOf[id] == status, $"การจอง {id} ควรได้ป้าย {status} แต่ได้ {labelOf[id]}");
        }
        Assert.Equal(expected.Values.Sum(ids => ids.Count), all.Total);

        // เงื่อนไขกรองในฐานข้อมูลต้องตรงกับป้ายที่คิดจากแถว — ได้ครบทุกใบของป้ายนั้น และไม่มีใบป้ายอื่นปน
        foreach (var status in BookingDisplayStatus.All)
        {
            var filtered = await ListAll(displayStatuses: [status], pageSize: 100);
            Assert.Equal(Sorted(expected[status]), IdsOf(filtered));
            Assert.Equal(expected[status].Count, filtered.Total);
            Assert.All(filtered.Rows, item => Assert.Equal(status, item.DisplayStatus));
        }

        // หลายป้ายในคำขอเดียว (กลุ่ม "รอดำเนินการ" ของตัวกรองหน้าการจอง) — ได้ใบของทุกป้ายรวมกันพอดี
        string[] inProgress = ["PENDING_VERIFICATION", "TOPUP_PENDING_VERIFICATION", "DIFF_REFUND_PENDING", "CANCELLED_REFUND_PENDING"];
        var grouped = await ListAll(displayStatuses: inProgress, pageSize: 100);
        Assert.Equal(Sorted(inProgress.SelectMany(status => expected[status])), IdsOf(grouped));
        Assert.All(grouped.Rows, item => Assert.Contains(item.DisplayStatus, inProgress));

        // status เดิมยังหมายถึงสถานะของการจอง — ใบที่จ่ายแล้วทุกใบ ไม่ว่าป้ายจะเป็นอะไร
        var paidIds = expected["PAID"]
            .Concat(expected["TOPUP_PENDING_PAYMENT"])
            .Concat(expected["TOPUP_PENDING_VERIFICATION"])
            .Concat(expected["DIFF_REFUND_PENDING"])
            .Append(diffRefunded.Id);
        Assert.Equal(Sorted(paidIds), IdsOf(await ListAll(status: BookingStatus.PAID, pageSize: 100)));

        // ใช้คู่กับตัวกรองอื่นได้ (AND) — คำค้นที่มี OR ของตัวเองต้องไม่ไปลบล้างเงื่อนไขของป้าย
        Assert.Equal([diffRefunded.Id], IdsOf(await ListAll(displayStatuses: ["REFUNDED"], q: diffRefunded.Code)));
        Assert.Equal(0, (await ListAll(displayStatuses: ["PAID"], q: diffRefunded.Code)).Total);
        Assert.Equal([diffRefunded.Id], IdsOf(await ListAll(displayStatuses: ["PAID", "REFUNDED"], q: diffRefunded.Code)));
        Assert.Equal([cancelledRefunded.Id], IdsOf(await ListAll(status: BookingStatus.CANCELLED, displayStatuses: ["REFUNDED"])));
    }

    [Fact]
    public async Task HTTP_displayStatusที่ไม่รู้จักได้422_หลายค่าคั่นด้วยจุลภาคได้_ป้ายติดมากับทุกแถว()
    {
        var admin = await Fx.CreateAdmin();
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var booking = await Fx.Book(await Fx.CreateUser(), showtime, seats[0]);
        Task<HttpResponseMessage> Get(string query) => Client(TokenFor(admin)).GetAsync($"/api/admin/bookings?{query}");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Get("displayStatus=NOPE")).StatusCode);

        var res = await Get("displayStatus=PENDING_PAYMENT");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await Json(res);
        Assert.Equal(
            [(booking.Id, "PENDING_PAYMENT")],
            body["bookings"]!.AsArray().Select(item => (item!["id"]!.GetValue<string>(), item["displayStatus"]!.GetValue<string>())));
        Assert.Equal(0, (await Json(await Get("displayStatus=PAID")))["total"]!.GetValue<int>());

        // กลุ่มในตัวกรอง — ตรงป้ายใดป้ายหนึ่งก็ได้ แต่มีค่าที่ไม่รู้จักแม้ตัวเดียวทั้งคำขอได้ 422
        var grouped = await Json(await Get("displayStatus=PAID,PENDING_PAYMENT"));
        Assert.Equal([booking.Id], grouped["bookings"]!.AsArray().Select(item => item!["id"]!.GetValue<string>()));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Get("displayStatus=PAID,NOPE")).StatusCode);
    }

    // ---------- ภาพรวมของผู้ดูแล (overview.test.js) ----------

    [Fact]
    public async Task ภาพรวม_รายได้เมื่อวานนับตั้งแต่เที่ยงคืนถึงเวลาเดียวกับตอนนี้เท่านั้น()
    {
        // เวลาตายตัว 12:00 น. เวลาไทย — ไม่อิงนาฬิกาจริง เทสต์จะไม่พังเมื่อรันใกล้เที่ยงคืน
        var now = Bangkok("2026-03-10T12:00:00");
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();

        // ยอดไม่ซ้ำกันทุกใบ ผลรวมจึงบอกได้ว่านับใบไหนไปบ้าง
        (Seat[] Seats, DateTime PaidAt)[] cases =
        [
            ([seats[0]], Bangkok("2026-03-10T09:00:00")), // วันนี้ · 200
            ([seats[1], seats[2]], Bangkok("2026-03-09T11:59:00")), // เมื่อวานก่อนเวลาตัด · 400
            ([seats[4]], Bangkok("2026-03-09T12:00:00")), // เมื่อวานตรงเวลาตัดพอดี ไม่นับ · 280
            ([seats[5], seats[6]], Bangkok("2026-03-08T23:59:00")), // เมื่อวานซืน · 560
        ];
        // จองทีละใบ — ผู้ใช้คนเดียวมีการจองที่ยังไม่จ่ายของรอบเดียวกันค้างพร้อมกันไม่ได้
        foreach (var item in cases)
        {
            var paid = await Fx.CreatePaidBooking(user, admin, showtime, item.Seats);
            await Fx.Exec(db => db.Bookings.Where(b => b.Id == paid.Id).ExecuteUpdateAsync(s => s.SetProperty(b => b.PaidAt, item.PaidAt)));
        }

        var overview = await Fx.Use<ReportService, OverviewResponse>(reports => reports.GetOverviewAsync(now));
        Assert.Equal("2026-03-10", overview.Date);
        Assert.Equal(now, overview.GeneratedAt);
        Assert.Equal(200, overview.RevenueToday);
        Assert.Equal(1, overview.BookingsToday);
        Assert.Equal(400, overview.RevenueYesterday);
    }

    [Fact]
    public async Task ภาพรวม_แถวคืนเงินบอกชนิดรายการ_คืนส่วนต่างเปลี่ยนที่นั่ง_กับยกเลิกการจองที่จ่ายแล้ว()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();

        // ย้ายจาก B1+B2 (พรีเมียม) ไป B1+A1 — ถูกลง 80 บาท ส่วนต่างเข้าคิวคืนเงิน
        var moved = await Fx.CreatePaidBooking(user, admin, showtime, seats[4], seats[5]);
        await Fx.Use<SeatChangeService, SeatChangeService.ChangeResult>(changes =>
            changes.RequestAsync(moved.Id, user.Id, [seats[4].Id, seats[0].Id], new RefundAccount("ธนาคารกสิกรไทย", "1234567890", null)));

        // จ่ายแล้วถูกผู้ดูแลยกเลิก — ค่าตั๋วทั้งใบเข้าคิวคืนเงิน
        var cancelled = await Fx.CreatePaidBooking(user, admin, showtime, seats[8]);
        await CancelBooking(cancelled.Id);

        var overview = await Fx.Use<ReportService, OverviewResponse>(reports => reports.GetOverviewAsync());
        // เรียงก่อนเทียบ — สองใบอาจอัปเดตในมิลลิวินาทีเดียวกัน ลำดับตาม updatedAt จึงไม่แน่นอน
        Assert.Equal(
            new[]
            {
                (moved.Code, PaymentKind.SEAT_CHANGE_REFUND, 80, PaymentStatus.REFUND_PENDING),
                (cancelled.Code, PaymentKind.BOOKING, 280, PaymentStatus.REFUND_PENDING),
            }.OrderBy(row => row.Item1, StringComparer.Ordinal),
            overview.RecentRefunds.Select(row => (row.Code, row.Kind, row.Amount, row.Status)).OrderBy(row => row.Code, StringComparer.Ordinal));
        // ยังไม่มีรายได้เมื่อวาน — ได้ 0 ไม่ใช่ null หน้าเว็บจะซ่อน % เทียบเอง
        Assert.Equal(0, overview.RevenueYesterday);
    }

    /// <summary>เวลาไทย (UTC+7) → UTC</summary>
    private static DateTime Bangkok(string local) =>
        DateTime.SpecifyKind(DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture).AddHours(-7), DateTimeKind.Utc);
}
