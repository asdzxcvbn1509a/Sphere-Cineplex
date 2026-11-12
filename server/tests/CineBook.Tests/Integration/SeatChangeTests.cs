using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Tests.Helpers;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Integration;

/// <summary>
/// port จาก test/integration/seat-changes.test.js — เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว (โรงทดสอบ 3 แถว × 4 ที่ ราคาฐาน 200)
/// seats[0..3] = A1–A4 ธรรมดา 200 · seats[4..7] = B1–B4 พรีเมียม 280 · seats[8..11] = C1–C4 พรีเมียม 280
/// </summary>
[Trait("Category", "Integration")]
public sealed class SeatChangeTests(ApiFactory factory) : IntegrationTest(factory)
{
    private static readonly RefundAccount RefundAccount = new("ธนาคารกสิกรไทย", "1234567890", "สมหมาย ใจดี");

    private Task<SeatChangeService.ChangeResult> Change(BookingResponse booking, User user, Seat[] seats, RefundAccount? account = null) =>
        Fx.Use<SeatChangeService, SeatChangeService.ChangeResult>(changes =>
            changes.RequestAsync(booking.Id, user.Id, seats.Select(s => s.Id).ToList(), account ?? Web.Services.RefundAccount.None));

    private async Task<SeatChangeDetailResponse> PayTopUp(string seatChangeId, User user)
    {
        var file = await Fx.MakeSlipFile();
        return await Fx.Use<SeatChangeService, SeatChangeDetailResponse>(changes =>
            changes.UploadSlipAsync(seatChangeId, Fixtures.As(user), file.Slip));
    }

    private Task<SeatChangeDetailResponse> CancelSeatChange(string seatChangeId, User user) =>
        Fx.Use<SeatChangeService, SeatChangeDetailResponse>(changes => changes.CancelAsync(seatChangeId, Fixtures.As(user)));

    private Task<BookingResponse> GetBooking(string bookingId) =>
        Fx.Use<BookingService, BookingResponse>(bookings => bookings.GetByIdAsync(bookingId));

    private Task<BookingResponse> CancelBooking(string bookingId, User? user, RefundAccount? account = null) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, user?.Id, byAdmin: user is null, null, account ?? Web.Services.RefundAccount.None));

    private Task<BookingResponse> Approve(string paymentId, User admin) =>
        Fx.Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(paymentId, admin.Id));

    private Task<ReceiptResponse> GetReceipt(string bookingId, User requester, string? paymentId = null) =>
        Fx.Use<ReceiptService, ReceiptResponse>(receipts => receipts.GetAsync(bookingId, paymentId, Fixtures.As(requester)));

    private Task<QueueCountsResponse> QueueCounts() => Fx.Use<ReportService, QueueCountsResponse>(reports => reports.GetQueueCountsAsync());

    private Task<BookingService.CancelShowtimeResult> CancelShowtime(string showtimeId) =>
        Fx.WithScope(sp => sp.GetRequiredService<BookingService>()
            .CancelShowtimeAsync(showtimeId, null, sp.GetRequiredService<ShowtimeService>()));

    private Task<int> DeactivateSeat(string theatreId, Seat seat) =>
        Fx.Use<TheatreService, int>(theatres => theatres.UpdateSeatsAsync(theatreId, [seat.Id], null, false));

    private static List<string> LabelsOf(BookingResponse booking) => booking.Seats.Select(seat => seat.Label).ToList();

    private static List<string> Sorted(params string[] ids) => [.. ids.Order(StringComparer.Ordinal)];

    /// <summary>ที่นั่งที่การจองถือไว้จริงในตาราง BookingSeat (ไม่รวมที่นั่งที่กันไว้ให้คำขอ)</summary>
    private Task<List<string>> HeldSeatIds(string bookingId) =>
        Fx.Query(async db => (await db.BookingSeats
                .Where(bs => bs.BookingId == bookingId && bs.SeatChangeId == null)
                .Select(bs => bs.SeatId)
                .ToListAsync())
            .Order(StringComparer.Ordinal).ToList());

    private async Task<string> SeatStatus(ShowtimeResponse showtime, string label)
    {
        var map = await Fx.Use<ShowtimeService, SeatMapResponse>(showtimes => showtimes.GetSeatMapAsync(showtime.Id));
        var row = map.Rows.First(item => item.RowLabel == label[..1]);
        return row.Seats.First(seat => seat.SeatNumber == int.Parse(label[1..])).Status;
    }

    private Task<SeatChange> SeatChangeOf(string id) => Fx.Query(db => db.SeatChanges.AsNoTracking().FirstAsync(c => c.Id == id));

    /// <summary>ทำให้คำขอที่รอโอนส่วนต่างหมดเวลาด้วย job จริง</summary>
    private async Task ExpireNow(string seatChangeId)
    {
        await PassDeadline(seatChangeId);
        Assert.Equal(1, await Fx.Use<SeatChangeService, int>(changes => changes.ReleaseExpiredAsync()));
    }

    private Task PassDeadline(string seatChangeId)
    {
        var past = Fixtures.MinutesFromNow(-1);
        return Fx.Exec(db => db.SeatChanges.Where(c => c.Id == seatChangeId).ExecuteUpdateAsync(s => s.SetProperty(c => c.HoldExpiresAt, past)));
    }

    private static List<string> SnapshotIds(Booking booking) => [.. booking.SeatSnapshot.Select(seat => seat.Id).Order(StringComparer.Ordinal)];

    // ---------- ย้ายไปที่นั่งราคาเท่าเดิม ----------

    [Fact]
    public async Task ราคาเท่าเดิม_ย้ายทันที_ที่นั่งเดิมว่างให้คนอื่นจองได้_ยอดเท่าเดิม_และใบเสร็จเดิมไม่เปลี่ยน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[1]);

        var result = await Change(paid, user, [seats[0], seats[2]]);

        Assert.Equal(SeatChangeStatus.COMPLETED, result.SeatChange.Status);
        Assert.Equal(0, result.SeatChange.DiffAmount);
        Assert.Equal(["A1", "A3"], LabelsOf(result.Booking));
        Assert.Equal(400, result.Booking.TotalAmount);
        Assert.Equal(Sorted(seats[0].Id, seats[2].Id), await HeldSeatIds(paid.Id));
        Assert.Equal(1, await Fx.Query(db => db.Payments.CountAsync(p => p.BookingId == paid.Id)));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.SEATS_CHANGED));
        Assert.Equal(1, result.Booking.SeatChange.ChangesLeft);

        // ที่นั่งเดิม (A2) กลับมาว่างทันที
        Assert.Equal("AVAILABLE", await SeatStatus(showtime, "A2"));
        await Fx.Book(other, showtime, seats[1]);

        // ใบเสร็จที่ออกไปแล้วยังเป็นที่นั่งตอนจ่าย แต่บอกที่นั่งปัจจุบันไว้ให้
        var receipt = await GetReceipt(paid.Id, user);
        Assert.Equal(["A1", "A2"], ((SeatsReceiptLine)receipt.Lines[0]).Seats);
        Assert.Equal(["A1", "A3"], receipt.SeatsChangedTo!);
        Assert.Equal(paid.Payment!.ReceiptNo, receipt.ReceiptNo);
    }

    // ---------- ย้ายไปที่นั่งที่ถูกกว่า ----------

    [Fact]
    public async Task ถูกกว่า_ส่วนต่างเข้าคิวคืนเงินพร้อมบัญชีที่แจ้ง_ยอดการจองลดลง_และแจ้งยอดส่วนต่างตอนโอนคืน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[4], seats[5]);

        await Fixtures.ExpectApiError(Change(paid, user, [seats[4], seats[0]]), "REFUND_ACCOUNT_REQUIRED", 400);

        var result = await Change(paid, user, [seats[4], seats[0]], RefundAccount);
        Assert.Equal(SeatChangeStatus.COMPLETED, result.SeatChange.Status);
        Assert.Equal(-80, result.SeatChange.DiffAmount);
        Assert.Equal(480, result.Booking.TotalAmount);
        Assert.Equal(["A1", "B1"], LabelsOf(result.Booking));

        var refund = (await Fx.PaymentOfSeatChange(result.SeatChange.Id))!;
        Assert.Equal(PaymentKind.SEAT_CHANGE_REFUND, refund.Kind);
        Assert.Equal(PaymentStatus.REFUND_PENDING, refund.Status);
        Assert.Equal(80, refund.RefundAmount);
        Assert.Equal(RefundAccount.BankName, refund.RefundBankName);
        Assert.Equal(RefundAccount.AccountNo, refund.RefundAccountNo);
        Assert.Equal(RefundAccount.AccountName, refund.RefundAccountName);
        // ค่าตั๋วหลักไม่ถูกแตะ
        Assert.Equal(PaymentStatus.APPROVED, (await Fx.PaymentOf(paid.Id))!.Status);

        var queue = await Fx.Use<PaymentService, PageResult<RefundQueueItem>>(payments => payments.ListRefundsAsync(null, null, null, null));
        var item = Assert.Single(queue.Rows);
        Assert.Equal((PaymentKind.SEAT_CHANGE_REFUND, 80), (item.Kind, item.RefundAmount));
        Assert.Equal(80, (await QueueCounts()).PendingRefundAmount);

        var file = await Fx.MakeSlipFile(SlipKind.Refund);
        await Fx.Use<PaymentService>(payments => payments.CompleteRefundAsync(refund.Id, admin.Id, null, file.Slip));
        var notice = await Fx.Query(db => db.Notifications.FirstAsync(n => n.Type == NotificationType.REFUND_COMPLETED));
        Assert.Contains("80 บาท", notice.BodyTh);
    }

    // ---------- ย้ายไปที่นั่งที่แพงกว่า (โอนส่วนต่าง) ----------

    [Fact]
    public async Task แพงกว่า_ระหว่างรอโอนที่นั่งใหม่ถูกกัน_ที่นั่งเดิมยังเป็นของลูกค้า_อนุมัติแล้วย้ายจริงพร้อมใบเสร็จส่วนต่าง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[1]);

        var pending = await Change(paid, user, [seats[0], seats[4]]);
        Assert.Equal(SeatChangeStatus.PENDING_PAYMENT, pending.SeatChange.Status);
        Assert.Equal(80, pending.SeatChange.DiffAmount);
        Assert.True(pending.SeatChange.HoldSecondsLeft > 0);
        // ยังไม่ย้าย — การจองอยู่ที่นั่งเดิมครบ ยอดเท่าเดิม
        Assert.Equal(["A1", "A2"], LabelsOf(pending.Booking));
        Assert.Equal(400, pending.Booking.TotalAmount);
        Assert.Equal(pending.SeatChange.Id, pending.Booking.SeatChange.Open!.Id);
        Assert.Equal("HELD", await SeatStatus(showtime, "B1"));
        Assert.Equal("BOOKED", await SeatStatus(showtime, "A2"));
        await Fixtures.ExpectApiError(Fx.Book(other, showtime, seats[4]), "SEAT_TAKEN", 409);

        var topUp = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;
        Assert.Equal(PaymentKind.SEAT_CHANGE_TOPUP, topUp.Kind);
        Assert.Equal(PaymentStatus.AWAITING_SLIP, topUp.Status);
        Assert.Equal(80, topUp.Amount);
        Assert.False(string.IsNullOrEmpty(topUp.QrPayload));

        var uploaded = await PayTopUp(pending.SeatChange.Id, user);
        Assert.Equal(SeatChangeStatus.PENDING_VERIFICATION, uploaded.Status);
        Assert.Null(uploaded.HoldSecondsLeft);
        Assert.Equal(1, (await QueueCounts()).PendingSlips);
        var queue = await Fx.Use<PaymentService, PageResult<PaymentQueueItem>>(payments => payments.ListAsync(null, null, null, null));
        Assert.Equal(PaymentKind.SEAT_CHANGE_TOPUP, queue.Rows[0].Kind);
        Assert.Equal(["A1", "B1"], queue.Rows[0].SeatChange!.ToSeats);

        // ระหว่างที่สลิปส่วนต่างรอตรวจ ยกเลิกการจองไม่ได้ทั้งลูกค้าและผู้ดูแล
        await Fixtures.ExpectApiError(CancelBooking(paid.Id, user, RefundAccount), "SEAT_CHANGE_AWAITING_VERIFICATION", 409);
        await Fixtures.ExpectApiError(CancelBooking(paid.Id, null), "SEAT_CHANGE_AWAITING_VERIFICATION", 409);
        Assert.False((await GetBooking(paid.Id)).CanCancel);

        var approved = await Approve(topUp.Id, admin);
        Assert.Equal(["A1", "B1"], LabelsOf(approved));
        Assert.Equal(480, approved.TotalAmount);
        Assert.Equal(Sorted(seats[0].Id, seats[4].Id), await HeldSeatIds(paid.Id));
        Assert.Equal(0, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.SeatChangeId != null)));
        Assert.Equal("AVAILABLE", await SeatStatus(showtime, "A2"));

        var settled = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;
        Assert.Equal(PaymentStatus.APPROVED, settled.Status);
        Assert.Equal(Receipts.FormatReceiptNo(Receipts.ReceiptYear(settled.VerifiedAt!.Value), 2), settled.ReceiptNo);

        // ใบเสร็จค่าตั๋วยังเป็นที่นั่งเดิม · ใบเสร็จส่วนต่างบอกว่าย้ายจากไหนไปไหน
        var mainReceipt = await GetReceipt(paid.Id, user);
        Assert.Equal(["A1", "A2"], mainReceipt.Lines.Cast<SeatsReceiptLine>().SelectMany(line => line.Seats));
        var topUpReceipt = await GetReceipt(paid.Id, user, settled.Id);
        Assert.Equal(settled.ReceiptNo, topUpReceipt.ReceiptNo);
        var expected = JsonNode.Parse("""
            [{ "kind": "SEAT_CHANGE", "fromSeats": ["A1", "A2"], "toSeats": ["A1", "B1"], "quantity": 1, "unitPrice": 80, "amount": 80 }]
            """);
        var lines = JsonSerializer.SerializeToNode(topUpReceipt.Lines, JsonDefaults.Api);
        Assert.True(JsonNode.DeepEquals(expected, lines), lines!.ToJsonString());

        var notice = await Fx.Query(db => db.Notifications.FirstAsync(n => n.Type == NotificationType.SEATS_CHANGED));
        Assert.Contains(settled.ReceiptNo!, notice.BodyTh);
    }

    [Fact]
    public async Task ปฏิเสธสลิปส่วนต่าง_ได้เวลาโอนใหม่_ที่นั่งใหม่ยังถูกกันไว้_และส่งสลิปใหม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);
        await PayTopUp(pending.SeatChange.Id, user);
        var topUp = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;

        await Fx.Use<PaymentService, BookingResponse>(payments => payments.RejectAsync(topUp.Id, admin.Id, "ยอดไม่ตรง"));

        var reopened = await SeatChangeOf(pending.SeatChange.Id);
        Assert.Equal(SeatChangeStatus.PENDING_PAYMENT, reopened.Status);
        Assert.True(reopened.HoldExpiresAt > DateTime.UtcNow);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal("HELD", await SeatStatus(showtime, "B1"));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.SEAT_CHANGE_REJECTED));

        var again = await PayTopUp(pending.SeatChange.Id, user);
        Assert.Equal(SeatChangeStatus.PENDING_VERIFICATION, again.Status);
    }

    [Fact]
    public async Task ไม่โอนภายในเวลา_คำขอหมดเวลา_ปล่อยที่นั่งใหม่_ที่นั่งเดิมไม่หาย_และไม่นับโควตา()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);

        await ExpireNow(pending.SeatChange.Id);

        var expired = await SeatChangeOf(pending.SeatChange.Id);
        Assert.Equal(SeatChangeStatus.EXPIRED, expired.Status);
        Assert.NotNull(expired.ExpiredAt);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal("AVAILABLE", await SeatStatus(showtime, "B1"));
        Assert.Equal([seats[0].Id], await HeldSeatIds(paid.Id));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.SEAT_CHANGE_EXPIRED));

        var booking = await GetBooking(paid.Id);
        Assert.Equal(2, booking.SeatChange.ChangesLeft);
        Assert.True(booking.SeatChange.CanChange);
    }

    [Fact]
    public async Task ลูกค้ายกเลิกคำขอก่อนโอน_ที่นั่งใหม่ว่างทันที_ส่งสลิปแล้วยกเลิกคำขอไม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        var first = await Change(paid, user, [seats[4]]);
        var cancelled = await CancelSeatChange(first.SeatChange.Id, user);
        Assert.Equal(SeatChangeStatus.CANCELLED, cancelled.Status);
        Assert.Equal(PaymentStatus.REJECTED, cancelled.Payment!.Status);
        Assert.Equal("AVAILABLE", await SeatStatus(showtime, "B1"));

        var second = await Change(paid, user, [seats[5]]);
        await PayTopUp(second.SeatChange.Id, user);
        await Fixtures.ExpectApiError(CancelSeatChange(second.SeatChange.Id, user), "SEAT_CHANGE_AWAITING_VERIFICATION", 409);
    }

    // ---------- กติกาการเปลี่ยนที่นั่ง ----------

    [Fact]
    public async Task เปลี่ยนได้เฉพาะการจองที่จ่ายแล้วของตัวเอง_และก่อนเส้นตาย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();

        var unpaid = await Fx.Book(user, showtime, seats[0]);
        await Fixtures.ExpectApiError(Change(unpaid, user, [seats[1]]), "SEAT_CHANGE_NOT_ALLOWED", 409);

        var paid = await Fx.CreatePaidBooking(other, admin, showtime, seats[2]);
        await Fixtures.ExpectApiError(Change(paid, user, [seats[3]]), "NOT_BOOKING_OWNER", 403);

        var soon = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(20));
        var late = await Fx.CreatePaidBooking(user, admin, soon.Showtime, soon.Seats[0]);
        await Fixtures.ExpectApiError(Change(late, user, [soon.Seats[1]]), "SEAT_CHANGE_WINDOW_CLOSED", 403);
        var shaped = await GetBooking(late.Id);
        Assert.False(shaped.SeatChange.CanChange);
        Assert.Equal("WINDOW_CLOSED", shaped.SeatChange.BlockedReason);
    }

    [Fact]
    public async Task จำนวนต้องเท่าเดิม_ที่นั่งต้องเป็นของโรงนี้และเปิดใช้งาน_และต้องเปลี่ยนจริง()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var other = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[1]);

        await Fixtures.ExpectApiError(Change(paid, user, [seats[2]]), "SEAT_COUNT_MISMATCH", 400);
        await Fixtures.ExpectApiError(Change(paid, user, [seats[0], other.Seats[2]]), "INVALID_SEATS", 400);
        await Fixtures.ExpectApiError(Change(paid, user, [seats[1], seats[0]]), "NO_SEAT_CHANGE", 400);

        await DeactivateSeat(theatreId, seats[3]);
        await Fixtures.ExpectApiError(Change(paid, user, [seats[0], seats[3]]), "INVALID_SEATS", 400);
    }

    [Fact]
    public async Task ลูกค้าเปลี่ยนได้2ครั้ง_คำขอที่ยกเลิกหรือหมดเวลาไม่นับ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Change(paid, user, [seats[1]]);
        var abandoned = await Change(paid, user, [seats[4]]);
        await CancelSeatChange(abandoned.SeatChange.Id, user);
        var expired = await Change(paid, user, [seats[5]]);
        await ExpireNow(expired.SeatChange.Id);
        await Change(paid, user, [seats[2]]);

        await Fixtures.ExpectApiError(Change(paid, user, [seats[3]]), "SEAT_CHANGE_LIMIT", 409);
        var shaped = await GetBooking(paid.Id);
        Assert.Equal(0, shaped.SeatChange.ChangesLeft);
        Assert.Equal("LIMIT", shaped.SeatChange.BlockedReason);
        Assert.Equal(4, shaped.SeatChange.History.Count);
    }

    [Fact]
    public async Task มีคำขอที่รอโอนส่วนต่างค้างอยู่_ขอใหม่ไม่ได้จนกว่าจะจบ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);

        var error = await Fixtures.ExpectApiError(Change(paid, user, [seats[1]]), "SEAT_CHANGE_PENDING");
        Assert.Equal(pending.SeatChange.Id, Fixtures.DetailsOf(error)!["seatChangeId"]!.GetValue<string>());
    }

    // ---------- ทำรายการพร้อมกัน ----------

    [Fact]
    public async Task สองคนแย่งที่นั่งใหม่เดียวกัน_ได้คนเดียว_อีกคนได้SEAT_TAKENและยังอยู่ที่นั่งเดิมครบ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var alice = await Fx.CreateUser();
        var bob = await Fx.CreateUser();
        var alicePaid = await Fx.CreatePaidBooking(alice, admin, showtime, seats[0]);
        var bobPaid = await Fx.CreatePaidBooking(bob, admin, showtime, seats[1]);

        var results = await Fixtures.AllSettled(
            () => Change(alicePaid, alice, [seats[2]]),
            () => Change(bobPaid, bob, [seats[2]]));

        Assert.Single(results, r => r.Ok);
        var failure = Fixtures.AsApiError(results.First(r => !r.Ok).Error, "SEAT_TAKEN");
        Assert.Equal("""["A3"]""", Fixtures.DetailsOf(failure)!["seats"]!.ToJsonString());

        var aliceLost = !results[0].Ok;
        var loser = aliceLost ? alicePaid : bobPaid;
        var original = aliceLost ? seats[0] : seats[1];
        Assert.Equal([original.Id], await HeldSeatIds(loser.Id));
        Assert.Equal([aliceLost ? "A1" : "A2"], LabelsOf(await GetBooking(loser.Id)));
    }

    [Fact]
    public async Task สองคนสลับที่นั่งกันเองพร้อมกัน_ไม่มีที่นั่งซ้อนหรือค้าง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var alice = await Fx.CreateUser();
        var bob = await Fx.CreateUser();
        var alicePaid = await Fx.CreatePaidBooking(alice, admin, showtime, seats[0]);
        var bobPaid = await Fx.CreatePaidBooking(bob, admin, showtime, seats[1]);

        var results = await Fixtures.AllSettled(
            () => Change(alicePaid, alice, [seats[1]]),
            () => Change(bobPaid, bob, [seats[0]]));

        // PostgreSQL อาจตัดสินให้ฝั่งหนึ่งแพ้ด้วย deadlock (ผ่าน HTTP จะกลายเป็น 409 WRITE_CONFLICT) หรือชน unique ตามปกติ
        foreach (var result in results.Where(item => !item.Ok))
        {
            var mapped = ApiExceptionMiddleware.Map(result.Error!);
            Assert.True(mapped.Code is "SEAT_TAKEN" or "WRITE_CONFLICT", $"{mapped.Code}: {result.Error!.Message}");
        }
        foreach (var paid in new[] { alicePaid, bobPaid })
        {
            var booking = (await Fx.BookingOf(paid.Id))!;
            Assert.Equal(SnapshotIds(booking), await HeldSeatIds(paid.Id));
        }
        Assert.Equal(2, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.ShowtimeId == showtime.Id)));
    }

    [Fact]
    public async Task กดเปลี่ยนซ้ำพร้อมกันบนการจองเดียวกัน_สำเร็จครั้งเดียว_และไม่มีที่นั่งค้างที่ไม่มีใครจ่าย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[1]);

        var results = await Fixtures.AllSettled(
            () => Change(paid, user, [seats[2], seats[3]]),
            () => Change(paid, user, [seats[1], seats[3]]));

        Assert.Single(results, r => r.Ok);
        var failure = Fixtures.AsApiError(results.First(r => !r.Ok).Error);
        Assert.Contains(failure.Code, new[] { "BOOKING_STATE_CHANGED", "SEAT_TAKEN" });

        var booking = (await Fx.BookingOf(paid.Id))!;
        Assert.Equal(SnapshotIds(booking), await HeldSeatIds(paid.Id));
        Assert.Equal(2, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.ShowtimeId == showtime.Id)));
    }

    [Fact]
    public async Task เปลี่ยนที่นั่งพร้อมกับยกเลิกการจอง_ผลลัพธ์สอดคล้องกันเสมอ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Fixtures.AllSettled<object?>(
            async () => await Change(paid, user, [seats[1]]),
            async () => await CancelBooking(paid.Id, user, RefundAccount));

        var booking = (await Fx.BookingOf(paid.Id))!;
        if (booking.Status == BookingStatus.CANCELLED)
        {
            Assert.Equal(0, await Fx.CountHeldSeats(paid.Id));
            Assert.Equal(200, (await Fx.PaymentOf(paid.Id))!.RefundAmount);
        }
        else
        {
            Assert.Equal(SnapshotIds(booking), await HeldSeatIds(paid.Id));
        }
    }

    // ---------- ยกเลิกการจองที่เคยเปลี่ยนที่นั่ง ----------

    [Fact]
    public async Task ยกเลิกหลังอัปเกรด_คืนยอดสุทธิในรายการเดียว_และใบเสร็จทั้งสองใบขึ้นตรารอคืนเงิน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);
        await PayTopUp(pending.SeatChange.Id, user);
        var topUp = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;
        await Approve(topUp.Id, admin);

        await CancelBooking(paid.Id, user, RefundAccount);

        var main = (await Fx.PaymentOf(paid.Id))!;
        Assert.Equal(PaymentStatus.REFUND_PENDING, main.Status);
        Assert.Equal(280, main.RefundAmount);
        Assert.Equal(PaymentStatus.APPROVED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal(1, (await Fx.Use<PaymentService, PageResult<RefundQueueItem>>(payments =>
            payments.ListRefundsAsync(null, null, null, null))).Total);
        Assert.Equal(280, (await QueueCounts()).PendingRefundAmount);

        var topUpReceipt = await GetReceipt(paid.Id, user, topUp.Id);
        Assert.Equal(new ReceiptRefund(PaymentStatus.REFUND_PENDING, null), topUpReceipt.Refund);
    }

    [Fact]
    public async Task ยกเลิกหลังดาวน์เกรด_คืนยอดสุทธิหักส่วนที่คืนไปแล้ว_รวมกันเท่ากับที่จ่ายมาพอดี()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[4]);
        await Change(paid, user, [seats[0]], RefundAccount);

        await CancelBooking(paid.Id, user, RefundAccount);

        Assert.Equal(200, (await Fx.PaymentOf(paid.Id))!.RefundAmount);
        Assert.Equal(280, (await QueueCounts()).PendingRefundAmount);
    }

    [Fact]
    public async Task ยกเลิกระหว่างรอโอนส่วนต่าง_ปิดคำขอและคืนที่นั่งที่กันไว้ด้วย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);

        await CancelBooking(paid.Id, user, RefundAccount);

        Assert.Equal(SeatChangeStatus.CANCELLED, (await SeatChangeOf(pending.SeatChange.Id)).Status);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal(0, await Fx.CountHeldSeats(paid.Id));
        Assert.Equal(200, (await Fx.PaymentOf(paid.Id))!.RefundAmount);
    }

    // ---------- ยกเลิกทั้งรอบฉาย ----------

    [Fact]
    public async Task มีสลิปส่วนต่างรอตรวจ_ยกเลิกรอบไม่ได้_ตรวจเสร็จแล้วยกเลิกได้และคืนยอดสุทธิ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);
        await PayTopUp(pending.SeatChange.Id, user);

        await Fixtures.ExpectApiError(CancelShowtime(showtime.Id), "SHOWTIME_HAS_PENDING_SLIPS", 409);

        var topUp = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;
        await Approve(topUp.Id, admin);
        var result = await CancelShowtime(showtime.Id);

        Assert.Equal(1, result.RefundsQueued);
        Assert.Equal(280, (await Fx.PaymentOf(paid.Id))!.RefundAmount);
    }

    [Fact]
    public async Task คำขอที่ยังรอโอนส่วนต่างถูกปิดไปพร้อมรอบ_และที่นั่งที่กันไว้ถูกคืน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);

        await CancelShowtime(showtime.Id);

        Assert.Equal(SeatChangeStatus.CANCELLED, (await SeatChangeOf(pending.SeatChange.Id)).Status);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal(0, await Fx.Query(db => db.BookingSeats.CountAsync(bs => bs.ShowtimeId == showtime.Id)));
        Assert.Equal(200, (await Fx.PaymentOf(paid.Id))!.RefundAmount);
    }

    // ---------- ผู้ดูแลย้ายที่นั่งแทนลูกค้า ----------

    private Task<SeatChangeService.ChangeResult> AdminChange(BookingResponse booking, User admin, Seat[] seats, string? reason = null) =>
        Fx.Use<SeatChangeService, SeatChangeService.ChangeResult>(changes =>
            changes.AdminChangeAsync(booking.Id, admin.Id, seats.Select(s => s.Id).ToList(), reason));

    [Fact]
    public async Task ผู้ดูแลย้ายได้เฉพาะโซนเดิม_ไม่ติดเส้นตาย_ไม่นับโควตา_และลูกค้าได้แจ้งเตือนพร้อมเหตุผล()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(20));
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[4]);

        await Fixtures.ExpectApiError(AdminChange(paid, admin, [seats[0], seats[1]]), "SEAT_ZONE_MISMATCH", 400);

        var result = await AdminChange(paid, admin, [seats[1], seats[4]], "ที่นั่ง A1 ชำรุด");

        Assert.Equal(SeatChangeStatus.COMPLETED, result.SeatChange.Status);
        Assert.True(result.SeatChange.ByAdmin);
        Assert.Equal(0, result.SeatChange.DiffAmount);
        Assert.Equal(["A2", "B1"], LabelsOf(result.Booking));
        Assert.Equal(2, result.Booking.SeatChange.ChangesLeft);
        var notice = await Fx.Query(db => db.Notifications.FirstAsync(n => n.Type == NotificationType.SEATS_CHANGED));
        Assert.Contains("ที่นั่ง A1 ชำรุด", notice.BodyTh);
    }

    [Fact]
    public async Task ปิดใช้งานที่นั่งชำรุดก่อนแล้วค่อยย้าย_ผังไม่มีที่นั่งนั้น_และย้ายลูกค้าออกได้()
    {
        var (showtime, _, theatreId, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[1]);
        await DeactivateSeat(theatreId, seats[0]);

        // หน้าย้ายที่นั่งสร้างผังจาก GetSeatMapAsync — A1 ไม่อยู่ในผัง จึงเริ่มเลือกไว้แค่ A2 แล้วให้เลือกที่แทนให้ครบ
        var map = await Fx.Use<ShowtimeService, SeatMapResponse>(showtimes => showtimes.GetSeatMapAsync(showtime.Id));
        Assert.DoesNotContain(map.Rows.SelectMany(row => row.Seats), seat => seat.Id == seats[0].Id);

        var result = await AdminChange(paid, admin, [seats[1], seats[2]], "ที่นั่ง A1 ชำรุด");

        Assert.Equal(SeatChangeStatus.COMPLETED, result.SeatChange.Status);
        Assert.Equal(0, result.SeatChange.DiffAmount);
        Assert.Equal(["A2", "A3"], LabelsOf(result.Booking));
        Assert.Equal(Sorted(seats[1].Id, seats[2].Id), await HeldSeatIds(paid.Id));
    }

    // ---------- สลิปส่วนต่างหลังหมดเวลา ----------

    [Fact]
    public async Task คำขอหมดเวลาแล้ว_ส่งสลิปส่วนต่างไม่ได้_ที่นั่งใหม่ว่าง_และที่นั่งเดิมของการจองไม่เปลี่ยน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);
        await ExpireNow(pending.SeatChange.Id);

        var detail = await Fx.Use<SeatChangeService, SeatChangeDetailResponse>(changes =>
            changes.GetAsync(pending.SeatChange.Id, Fixtures.As(user)));
        Assert.False(detail.CanUploadSlip);

        var file = await Fx.MakeSlipFile();
        await Fixtures.ExpectApiError(
            Fx.Use<SeatChangeService, SeatChangeDetailResponse>(changes => changes.UploadSlipAsync(pending.SeatChange.Id, Fixtures.As(user), file.Slip)),
            "HOLD_EXPIRED",
            409);
        Assert.False(Fixtures.FileExists(file.Path));
        Assert.Equal(SeatChangeStatus.EXPIRED, (await SeatChangeOf(pending.SeatChange.Id)).Status);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
        Assert.Equal("AVAILABLE", await SeatStatus(showtime, "B1"));
        Assert.Equal(["A1"], LabelsOf(await GetBooking(paid.Id)));
        Assert.Equal(0, (await QueueCounts()).PendingSlips);
    }

    [Fact]
    public async Task ส่งสลิปส่วนต่างพร้อมกับที่jobกำลังปิดคำขอ_ชนะได้ฝั่งเดียว_และที่นั่งเดิมไม่ถูกแตะ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ — บางรอบ job ปิดคำขอก่อน บางรอบสลิปเข้าก่อน
        for (var i = 0; i < 4; i += 1)
        {
            var user = await Fx.CreateUser();
            var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[i]);
            var pending = await Change(paid, user, [seats[4 + i]]);
            await PassDeadline(pending.SeatChange.Id);

            var results = await Fixtures.AllSettled<object?>(
                async () => await Fx.Use<SeatChangeService, int>(changes => changes.ReleaseExpiredAsync()),
                async () => await PayTopUp(pending.SeatChange.Id, user));
            var upload = results[1];

            var current = await SeatChangeOf(pending.SeatChange.Id);
            if (upload.Ok)
            {
                Assert.Equal(SeatChangeStatus.PENDING_VERIFICATION, current.Status);
                Assert.Equal("HELD", await SeatStatus(showtime, $"B{i + 1}"));
            }
            else
            {
                Fixtures.AsApiError(upload.Error, "HOLD_EXPIRED", 409);
                Assert.Equal(SeatChangeStatus.EXPIRED, current.Status);
                Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!.Status);
                Assert.Equal("AVAILABLE", await SeatStatus(showtime, $"B{i + 1}"));
            }
            Assert.Equal([seats[i].Id], await HeldSeatIds(paid.Id));
        }
    }

    // ---------- HTTP ----------

    [Fact]
    public async Task HTTP_POSTเปลี่ยนที่นั่ง_201ย้ายสำเร็จ_409ที่นั่งถูกจอง_401ไม่มีtoken()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await Fx.Book(other, showtime, seats[2]);

        Task<HttpResponseMessage> Post(User? account, Seat seat) =>
            Client(account is null ? null : TokenFor(account))
                .PostAsync($"/api/bookings/{paid.Id}/seat-changes", JsonBody(new { seatIds = new[] { seat.Id } }));

        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(null, seats[1])).StatusCode);

        var taken = await Post(user, seats[2]);
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        Assert.Equal("SEAT_TAKEN", await ErrorCode(taken));

        var moved = await Post(user, seats[1]);
        Assert.Equal(HttpStatusCode.Created, moved.StatusCode);
        var body = await Json(moved);
        Assert.Equal("COMPLETED", body["seatChange"]!["status"]!.GetValue<string>());
        Assert.Equal(["A2"], body["booking"]!["seats"]!.AsArray().Select(seat => seat!["label"]!.GetValue<string>()));
    }

    [Fact]
    public async Task HTTP_GETคำขอเปลี่ยนที่นั่งและสลิปส่วนต่าง_เจ้าของและผู้ดูแลเปิดได้_คนอื่นได้403()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var pending = await Change(paid, user, [seats[4]]);
        await PayTopUp(pending.SeatChange.Id, user);
        var topUp = (await Fx.PaymentOfSeatChange(pending.SeatChange.Id))!;

        var own = await Client(TokenFor(user)).GetAsync($"/api/seat-changes/{pending.SeatChange.Id}");
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        var seatChange = (await Json(own))["seatChange"]!;
        Assert.Equal(80, seatChange["payment"]!["amount"]!.GetValue<int>());
        Assert.True(seatChange["payment"]!["hasSlip"]!.GetValue<bool>());

        var stranger = await Client(TokenFor(other)).GetAsync($"/api/seat-changes/{pending.SeatChange.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, stranger.StatusCode);

        var slipUrl = $"/api/payments/{paid.Id}/slip?payment={topUp.Id}";
        var asAdmin = await Client(TokenFor(admin)).GetAsync(slipUrl);
        Assert.Equal(HttpStatusCode.OK, asAdmin.StatusCode);
        Assert.Equal("image/png", asAdmin.Content.Headers.ContentType?.MediaType);
        Assert.True(asAdmin.Headers.CacheControl is { Private: true, NoStore: true });
        Assert.Equal(HttpStatusCode.Forbidden, (await Client(TokenFor(other)).GetAsync(slipUrl)).StatusCode);
    }
}
