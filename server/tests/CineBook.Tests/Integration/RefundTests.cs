using CineBook.Tests.Helpers;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/refunds.test.js</summary>
[Trait("Category", "Integration")]
public sealed class RefundTests(ApiFactory factory) : IntegrationTest(factory)
{
    private sealed record RefundPending(User Admin, User User, BookingResponse Booking, Payment Payment);

    private Task<BookingResponse> Cancel(string bookingId, string? userId, bool byAdmin, RefundAccount? account = null) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, userId, byAdmin, null, account ?? RefundAccount.None));

    private Task CompleteRefund(string paymentId, User admin, SlipFixture file, string? note = null) =>
        Fx.Use<PaymentService>(payments => payments.CompleteRefundAsync(paymentId, admin.Id, note, file.Slip));

    private Task UpdateRefund(string paymentId, string? note, SlipFixture? file = null) =>
        Fx.Use<PaymentService>(payments => payments.UpdateRefundAsync(paymentId, note, file?.Slip));

    private Task<PageResult<RefundQueueItem>> ListRefunds(string? status = null, string? sort = null, int? page = null, int? pageSize = null) =>
        Fx.Use<PaymentService, PageResult<RefundQueueItem>>(payments => payments.ListRefundsAsync(status, sort, page, pageSize));

    /// <summary>จองแล้วจ่ายจนเป็น PAID จากนั้นผู้ดูแลยกเลิกแทน — ใบชำระเงินเข้าคิวรอคืนเงิน</summary>
    private async Task<RefundPending> RefundPendingBooking()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await Cancel(paid.Id, null, byAdmin: true);
        return new RefundPending(admin, user, paid, (await Fx.PaymentOf(paid.Id))!);
    }

    [Fact]
    public async Task ลำดับคิวคืนเงิน_รอคืนค้างนานสุดก่อน_คืนแล้วโอนคืนล่าสุดก่อน_sortสลับทิศได้และแบ่งหน้าตามลำดับเดียวกัน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var paymentIds = new List<string>();
        for (var index = 0; index < 3; index += 1)
        {
            var user = await Fx.CreateUser();
            var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[index]);
            await Cancel(paid.Id, null, byAdmin: true);
            var payment = (await Fx.PaymentOf(paid.Id))!;
            // ตั้งเวลาเข้าคิวเองให้ห่างกันชัด ๆ ไม่พึ่งว่าคำสั่งข้างบนใช้เวลาต่างกันพอ
            var dueAt = Fixtures.MinutesFromNow(-30 + index * 10);
            await Fx.Exec(db => db.Payments.Where(p => p.Id == payment.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.RefundDueAt, dueAt)));
            paymentIds.Add(payment.Id);
        }

        static List<string> Ids(PageResult<RefundQueueItem> queue) => queue.Rows.Select(item => item.Id).ToList();
        var reversed = Enumerable.Reverse(paymentIds).ToList();
        Assert.Equal(paymentIds, Ids(await ListRefunds()));
        Assert.Equal(paymentIds, Ids(await ListRefunds(sort: "oldest")));
        Assert.Equal(reversed, Ids(await ListRefunds(sort: "newest")));
        Assert.Equal([paymentIds[0]], Ids(await ListRefunds(sort: "newest", page: 2, pageSize: 2)));

        // โอนคืนกลับลำดับกับตอนเข้าคิว (ใบที่เข้าคิวก่อนโอนคืนทีหลังสุด) — แท็บคืนแล้วต้องเรียงตามเวลาโอนคืน ไม่ใช่เวลาเข้าคิว
        for (var index = 0; index < paymentIds.Count; index += 1)
        {
            var paymentId = paymentIds[index];
            await CompleteRefund(paymentId, admin, await Fx.MakeSlipFile(SlipKind.Refund));
            var refundedAt = Fixtures.MinutesFromNow(-index * 10);
            await Fx.Exec(db => db.Payments.Where(p => p.Id == paymentId).ExecuteUpdateAsync(s => s.SetProperty(p => p.RefundedAt, refundedAt)));
        }
        Assert.Equal(paymentIds, Ids(await ListRefunds("REFUNDED")));
        Assert.Equal(paymentIds, Ids(await ListRefunds("REFUNDED", "newest")));
        Assert.Equal(reversed, Ids(await ListRefunds("REFUNDED", "oldest")));
        Assert.Equal([paymentIds[0]], Ids(await ListRefunds("REFUNDED", "oldest", 2, 2)));
        Assert.Equal(0, (await ListRefunds()).Total);
    }

    // ---------- บัญชีรับเงินคืนในคิวคืนเงิน ----------

    [Fact]
    public async Task ลูกค้ายกเลิกใบที่จ่ายแล้ว_ต้องแจ้งบัญชี_และคิวเห็นชื่อบัญชีกับเวลาที่ส่งสลิป()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Fixtures.ExpectApiError(Cancel(paid.Id, user.Id, byAdmin: false), "REFUND_ACCOUNT_REQUIRED", 400);

        await Cancel(paid.Id, user.Id, byAdmin: false, RefundAccount.Read("กสิกรไทย", "1234567890", "  วรรณกร จิตณา  "));

        var item = Assert.Single((await ListRefunds()).Rows);
        Assert.Equal("กสิกรไทย", item.RefundBankName);
        Assert.Equal("1234567890", item.RefundAccountNo);
        Assert.Equal("วรรณกร จิตณา", item.RefundAccountName);
        Assert.Equal((await Fx.PaymentOf(paid.Id))!.SlipUploadedAt, item.SlipUploadedAt);
    }

    [Fact]
    public async Task clientรุ่นก่อนที่ไม่ส่งชื่อบัญชี_ยังยกเลิกได้ตามเดิม_และชื่อบัญชีเป็นnull()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);

        await Cancel(paid.Id, user.Id, byAdmin: false, RefundAccount.Read("กสิกรไทย", "1234567890", null));

        var item = Assert.Single((await ListRefunds()).Rows);
        Assert.Equal("1234567890", item.RefundAccountNo);
        Assert.Null(item.RefundAccountName);
    }

    // ---------- แก้รายการที่คืนเงินแล้ว ----------

    [Fact]
    public async Task แนบสลิปใหม่_สลิปเก่าถูกลบ_สถานะยังคืนเงินแล้ว_และไม่แจ้งเตือนลูกค้าซ้ำ()
    {
        var (admin, _, booking, payment) = await RefundPendingBooking();
        var first = await Fx.MakeSlipFile(SlipKind.Refund);
        await CompleteRefund(payment.Id, admin, first, "โอนแล้ว");
        var refunded = (await Fx.PaymentOf(booking.Id))!;

        var second = await Fx.MakeSlipFile(SlipKind.Refund);
        await UpdateRefund(payment.Id, "  แก้หมายเหตุ  ", second);

        var updated = (await Fx.PaymentOf(booking.Id))!;
        Assert.Equal(PaymentStatus.REFUNDED, updated.Status);
        Assert.Equal(second.FileName, updated.RefundSlipPath);
        Assert.Equal("แก้หมายเหตุ", updated.RefundNote);
        Assert.Equal(refunded.RefundedAt, updated.RefundedAt);
        Assert.False(Fixtures.FileExists(first.Path));
        Assert.True(Fixtures.FileExists(second.Path));
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.REFUND_COMPLETED));

        // ไม่แนบไฟล์ = ใช้สลิปเดิม · หมายเหตุว่างเก็บเป็น null
        await UpdateRefund(payment.Id, "   ");
        var noteCleared = (await Fx.PaymentOf(booking.Id))!;
        Assert.Equal(second.FileName, noteCleared.RefundSlipPath);
        Assert.Null(noteCleared.RefundNote);
        Assert.True(Fixtures.FileExists(second.Path));
    }

    [Fact]
    public async Task รายการที่ยังไม่ได้บันทึกคืนเงินหรือไม่มีอยู่จริง_แก้ไม่ได้_และไฟล์ที่แนบมาถูกลบ()
    {
        var (_, _, _, payment) = await RefundPendingBooking();

        var early = await Fx.MakeSlipFile(SlipKind.Refund);
        await Fixtures.ExpectApiError(UpdateRefund(payment.Id, "ยังไม่ได้โอน", early), "REFUND_NOT_COMPLETED", 409);
        Assert.False(Fixtures.FileExists(early.Path));
        Assert.Equal(PaymentStatus.REFUND_PENDING, (await Fx.PaymentOf(payment.MainBookingId!))!.Status);

        var orphan = await Fx.MakeSlipFile(SlipKind.Refund);
        await Fixtures.ExpectApiError(UpdateRefund("no-such-payment", null, orphan), "PAYMENT_NOT_FOUND", 404);
        Assert.False(Fixtures.FileExists(orphan.Path));
    }

    // ---------- ชื่อไฟล์สลิปสำหรับเปิดดู ----------

    [Fact]
    public async Task สลิปคืนเงิน_เจ้าของการจองและผู้ดูแลเปิดได้_คนอื่นได้403_ยังไม่โอนคืนได้404()
    {
        var (admin, user, booking, payment) = await RefundPendingBooking();
        var stranger = await Fx.CreateUser();

        Task<string> RefundSlipName(User requester) =>
            Fx.Use<PaymentService, string>(payments => payments.GetRefundSlipFileNameAsync(booking.Id, null, Fixtures.As(requester)));

        await Fixtures.ExpectApiError(RefundSlipName(user), "REFUND_SLIP_NOT_FOUND", 404);

        var file = await Fx.MakeSlipFile(SlipKind.Refund);
        await CompleteRefund(payment.Id, admin, file);

        Assert.Equal(file.FileName, await RefundSlipName(user));
        Assert.Equal(file.FileName, await RefundSlipName(admin));
        await Fixtures.ExpectApiError(RefundSlipName(stranger), "NOT_BOOKING_OWNER", 403);
    }

    [Fact]
    public async Task สลิปโอนเงิน_ยังไม่ส่งสลิปได้404ก่อนเช็กสิทธิ์_ส่งแล้วเจ้าของและผู้ดูแลเปิดได้_คนอื่นได้403()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var stranger = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);

        Task<string> SlipName(string bookingId, User requester) =>
            Fx.Use<PaymentService, string>(payments => payments.GetSlipFileNameAsync(bookingId, null, Fixtures.As(requester)));

        // ยังไม่มีสลิป — ตอบ 404 ก่อนดูว่าเป็นใคร (คนอื่นก็ได้ 404 ไม่ใช่ 403)
        await Fixtures.ExpectApiError(SlipName(booking.Id, stranger), "SLIP_NOT_FOUND", 404);
        await Fixtures.ExpectApiError(SlipName("no-such-booking", admin), "SLIP_NOT_FOUND", 404);

        await Fx.SubmitSlip(booking, user);
        var slipPath = (await Fx.PaymentOf(booking.Id))!.SlipPath;

        Assert.Equal(slipPath, await SlipName(booking.Id, user));
        Assert.Equal(slipPath, await SlipName(booking.Id, admin));
        await Fixtures.ExpectApiError(SlipName(booking.Id, stranger), "NOT_BOOKING_OWNER", 403);
    }
}
