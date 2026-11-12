using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Tests.Helpers;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/receipts.test.js</summary>
[Trait("Category", "Integration")]
public sealed class ReceiptTests(ApiFactory factory) : IntegrationTest(factory)
{
    /// <summary>เลขที่ใบเสร็จที่ควรได้ — ปีคิดจากเวลาที่จ่ายจริง เทสต์จะได้ไม่พังตอนรันคร่อมเที่ยงคืนวันขึ้นปีใหม่</summary>
    private static string ReceiptNoFor(DateTime paidAt, long sequence) =>
        Receipts.FormatReceiptNo(Receipts.ReceiptYear(paidAt), sequence);

    private async Task<BookingResponse> Approve(BookingResponse booking, User admin)
    {
        var payment = (await Fx.PaymentOf(booking.Id))!;
        return await Fx.Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(payment.Id, admin.Id));
    }

    private Task<ReceiptResponse> GetReceipt(string bookingId, User requester) =>
        Fx.Use<ReceiptService, ReceiptResponse>(receipts => receipts.GetAsync(bookingId, null, Fixtures.As(requester)));

    private Task<BookingResponse> AdminCancel(string bookingId) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, null, byAdmin: true, null, RefundAccount.None));

    // ---------- ออกเลขที่ใบเสร็จตอนอนุมัติสลิป ----------

    [Fact]
    public async Task ได้เลขเรียงกันตามลำดับการอนุมัติ_เก็บชื่อผู้จ่ายไว้_และแจ้งเตือนบอกเลขที่ใบเสร็จ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();

        var first = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        var second = await Fx.CreatePaidBooking(user, admin, showtime, seats[1]);

        Assert.Equal(ReceiptNoFor(first.PaidAt!.Value, 1), first.Payment!.ReceiptNo);
        Assert.Equal(ReceiptNoFor(second.PaidAt!.Value, 2), second.Payment!.ReceiptNo);
        Assert.Equal(user.Name, (await Fx.PaymentOf(first.Id))!.ReceiptName);

        var year = Receipts.ReceiptYear(second.PaidAt!.Value);
        Assert.Equal(2, await Fx.Query(db => db.ReceiptCounters.Where(c => c.Year == year).Select(c => c.LastNo).FirstAsync()));

        var bodies = await Fx.Query(db => db.Notifications
            .Where(n => n.Type == NotificationType.PAYMENT_APPROVED).Select(n => n.BodyTh).ToListAsync());
        Assert.Contains(bodies, body => body.Contains(first.Payment.ReceiptNo!));
        Assert.Contains(bodies, body => body.Contains(second.Payment.ReceiptNo!));
    }

    [Fact]
    public async Task อนุมัติหลายใบพร้อมกัน_เลขไม่ซ้ำ_ไม่ข้าม()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();

        var bookings = new List<BookingResponse>();
        for (var index = 0; index < 5; index += 1)
        {
            var user = await Fx.CreateUser();
            var booking = await Fx.Book(user, showtime, seats[index]);
            await Fx.SubmitSlip(booking, user);
            bookings.Add(booking);
        }
        await Task.WhenAll(bookings.Select(booking => Task.Run(() => Approve(booking, admin))));

        var paidAt = (await Fx.BookingOf(bookings[0].Id))!.PaidAt!.Value;
        var numbers = (await Fx.Query(db => db.Payments.Select(p => p.ReceiptNo).ToListAsync()))
            .Order(StringComparer.Ordinal)
            .ToList();
        Assert.Equal(new long[] { 1, 2, 3, 4, 5 }.Select(sequence => ReceiptNoFor(paidAt, sequence)), numbers);
    }

    [Fact]
    public async Task transactionที่ล้มหลังออกเลข_เลขนั้นถูกคืน_ใบถัดไปได้เลขเดิม()
    {
        var at = DateTime.UtcNow;
        await Fx.WithScope(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            await using var tx = await db.Database.BeginTransactionAsync();
            await ReceiptService.IssueReceiptNoAsync(db, at);
            await tx.RollbackAsync();
        });

        Assert.Equal(ReceiptNoFor(at, 1), await Fx.Query(db => ReceiptService.IssueReceiptNoAsync(db, at)));
    }

    [Fact]
    public async Task ผู้ดูแลสองคนกดอนุมัติใบเดียวกันพร้อมกัน_ได้ใบเสร็จใบเดียว_ตัวนับไม่กระโดด()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var adminA = await Fx.CreateAdmin();
        var adminB = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);
        var payment = (await Fx.PaymentOf(booking.Id))!;

        var results = await Fixtures.AllSettled(
            () => Fx.Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(payment.Id, adminA.Id)),
            () => Fx.Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(payment.Id, adminB.Id)));
        Assert.Single(results, r => r.Ok);

        var paidAt = (await Fx.BookingOf(booking.Id))!.PaidAt!.Value;
        Assert.Equal(ReceiptNoFor(paidAt, 1), (await Fx.PaymentOf(booking.Id))!.ReceiptNo);
        Assert.Equal(1, await Fx.Query(db => db.ReceiptCounters.Select(c => c.LastNo).FirstAsync()));
    }

    [Fact]
    public async Task สลิปที่ถูกปฏิเสธไม่มีใบเสร็จ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);
        var payment = (await Fx.PaymentOf(booking.Id))!;

        await Fx.Use<PaymentService, BookingResponse>(payments => payments.RejectAsync(payment.Id, admin.Id, "ยอดไม่ตรง"));

        Assert.Null((await Fx.PaymentOf(booking.Id))!.ReceiptNo);
        await Fixtures.ExpectApiError(GetReceipt(booking.Id, user), "RECEIPT_NOT_READY", 403);
    }

    // ---------- เปิดดูใบเสร็จ ----------

    [Fact]
    public async Task เจ้าของเปิดดูได้_แยกรายการตามโซน_ยอดรวมและจำนวนเงินเป็นตัวอักษรถูกต้อง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        // A1 = ธรรมดา 200 · B1, B2 = พรีเมียม 280 (ราคาฐาน 200 ของ fixture)
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0], seats[4], seats[5]);

        var receipt = await GetReceipt(paid.Id, user);

        Assert.Equal(paid.Payment!.ReceiptNo, receipt.ReceiptNo);
        Assert.Equal(paid.PaidAt, receipt.IssuedAt);
        var expectedLines = JsonNode.Parse("""
            [
              { "kind": "SEATS", "zone": "NORMAL", "unitPrice": 200, "quantity": 1, "amount": 200, "seats": ["A1"] },
              { "kind": "SEATS", "zone": "PREMIUM", "unitPrice": 280, "quantity": 2, "amount": 560, "seats": ["B1", "B2"] }
            ]
            """);
        var lines = JsonSerializer.SerializeToNode(receipt.Lines, JsonDefaults.Api);
        Assert.True(JsonNode.DeepEquals(expectedLines, lines), lines!.ToJsonString());
        Assert.Equal(760, receipt.TotalAmount);
        Assert.Equal(BahtText.Thai(760), receipt.AmountTextTh);
        Assert.Equal(Factory.Config.ReceiptIssuerName, receipt.Issuer.Name);
        Assert.Equal(user.Name, receipt.Customer.Name);
        Assert.Equal(paid.Code, receipt.Booking.Code);
        Assert.Equal(user.Id, receipt.Booking.UserId);
        Assert.Equal(paid.Payment.Reference, receipt.Payment.Reference);
        Assert.Null(receipt.Refund);
    }

    [Fact]
    public async Task ผู้ใช้เปลี่ยนชื่อหลังจ่ายเงิน_ใบเสร็จที่ออกไปแล้วยังเป็นชื่อตอนจ่าย()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Fx.Use<AuthService, UserResponse>(auth => auth.UpdateProfileAsync(user.Id, "ชื่อใหม่หลังจ่ายเงิน", null, null));

        Assert.Equal(user.Name, (await GetReceipt(paid.Id, user)).Customer.Name);
    }

    [Fact]
    public async Task คนอื่นเปิดไม่ได้_ผู้ดูแลเปิดได้ทุกใบ_ใบที่ยังไม่จ่ายยังไม่มีใบเสร็จ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Fixtures.ExpectApiError(GetReceipt(paid.Id, other), "NOT_BOOKING_OWNER", 403);
        Assert.Equal(paid.Payment!.ReceiptNo, (await GetReceipt(paid.Id, admin)).ReceiptNo);
        await Fixtures.ExpectApiError(GetReceipt("no-such-booking", admin), "BOOKING_NOT_FOUND", 404);

        var unpaid = await Fx.Book(user, showtime, seats[1]);
        await Fixtures.ExpectApiError(GetReceipt(unpaid.Id, user), "RECEIPT_NOT_READY", 403);
    }

    [Fact]
    public async Task ยกเลิกหลังจ่ายเงิน_ใบเสร็จยังเปิดได้_บอกสถานะคืนเงิน_และเลขที่เดิมไม่เปลี่ยน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await AdminCancel(paid.Id);

        var pending = await GetReceipt(paid.Id, user);
        Assert.Equal(BookingStatus.CANCELLED, pending.Booking.Status);
        Assert.Equal(new ReceiptRefund(PaymentStatus.REFUND_PENDING, null), pending.Refund);

        var payment = (await Fx.PaymentOf(paid.Id))!;
        var file = await Fx.MakeSlipFile(SlipKind.Refund);
        await Fx.Use<PaymentService>(payments => payments.CompleteRefundAsync(payment.Id, admin.Id, null, file.Slip));

        var refunded = await GetReceipt(paid.Id, user);
        Assert.Equal(PaymentStatus.REFUNDED, refunded.Refund!.Status);
        Assert.NotNull(refunded.Refund.RefundedAt);
        Assert.Equal(paid.Payment!.ReceiptNo, refunded.ReceiptNo);
    }

    [Fact]
    public async Task ผู้ดูแลค้นการจองด้วยเลขที่ใบเสร็จได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await Fx.CreatePaidBooking(other, admin, showtime, seats[1]);

        var result = await Fx.Use<BookingService, PageResult<BookingResponse>>(bookings =>
            bookings.ListAllAsync(null, null, null, paid.Payment!.ReceiptNo, null, null));

        Assert.Equal([paid.Id], result.Rows.Select(booking => booking.Id));
        Assert.Equal(paid.Payment!.ReceiptNo, result.Rows[0].Payment!.ReceiptNo);
    }

    // ---------- GET /api/bookings/:id/receipt ----------

    [Fact]
    public async Task HTTP_เจ้าของและผู้ดูแลได้200_คนอื่นได้403_ไม่มีtokenได้401()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        Task<HttpResponseMessage> GetAs(User? account) =>
            Client(account is null ? null : TokenFor(account)).GetAsync($"/api/bookings/{paid.Id}/receipt");

        var own = await GetAs(user);
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(paid.Payment!.ReceiptNo, (await Json(own))["receipt"]!["receiptNo"]!.GetValue<string>());

        Assert.Equal(HttpStatusCode.OK, (await GetAs(admin)).StatusCode);

        var stranger = await GetAs(other);
        Assert.Equal(HttpStatusCode.Forbidden, stranger.StatusCode);
        Assert.Equal("NOT_BOOKING_OWNER", await ErrorCode(stranger));

        Assert.Equal(HttpStatusCode.Unauthorized, (await GetAs(null)).StatusCode);
    }
}
