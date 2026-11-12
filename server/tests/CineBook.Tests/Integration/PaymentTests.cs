using CineBook.Tests.Helpers;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/payments.test.js และ slip-deadline.test.js</summary>
[Trait("Category", "Integration")]
public sealed class PaymentTests(ApiFactory factory) : IntegrationTest(factory)
{
    private Task<BookingResponse> Approve(string paymentId, User admin) =>
        Fx.Use<PaymentService, BookingResponse>(payments => payments.ApproveAsync(paymentId, admin.Id));

    private Task<BookingResponse> Reject(string paymentId, User admin, string reason) =>
        Fx.Use<PaymentService, BookingResponse>(payments => payments.RejectAsync(paymentId, admin.Id, reason));

    private Task<BookingResponse> AdminCancel(string bookingId) =>
        Fx.Use<BookingService, BookingResponse>(bookings =>
            bookings.CancelAsync(bookingId, null, byAdmin: true, null, RefundAccount.None));

    private Task<int> ReleaseExpiredHolds() => Fx.Use<BookingService, int>(bookings => bookings.ReleaseExpiredHoldsAsync());

    private Task<PaymentPageResponse> UploadSlip(BookingResponse booking, User user, SlipFixture file) =>
        Fx.Use<PaymentService, PaymentPageResponse>(payments => payments.UploadSlipAsync(booking.Id, user.Id, file.Slip));

    // ---------- ตรวจสลิปพร้อมกัน ----------

    [Fact]
    public async Task ผู้ดูแลสองคนกดอนุมัติใบเดียวกันพร้อมกัน_สำเร็จครั้งเดียว_ลูกค้าได้แจ้งเตือนใบเดียว()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin1 = await Fx.CreateAdmin();
        var admin2 = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);
        var payment = (await Fx.PaymentOf(booking.Id))!;

        var results = await Fixtures.AllSettled(() => Approve(payment.Id, admin1), () => Approve(payment.Id, admin2));

        Assert.Single(results, r => r.Ok);
        Fixtures.AsApiError(Assert.Single(results, r => !r.Ok).Error, "PAYMENT_NOT_PENDING");
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.PAYMENT_APPROVED));
    }

    [Fact]
    public async Task อนุมัติชนกับปฏิเสธ_ผลสุดท้ายเป็นอย่างใดอย่างหนึ่งเท่านั้น()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);
        var payment = (await Fx.PaymentOf(booking.Id))!;

        var results = await Fixtures.AllSettled(() => Approve(payment.Id, admin), () => Reject(payment.Id, admin, "ยอดไม่ตรง"));

        Assert.Single(results, r => r.Ok);
        var pair = $"{(await Fx.BookingOf(booking.Id))!.Status}/{(await Fx.PaymentOf(booking.Id))!.Status}";
        Assert.Contains(pair, new[] { "PAID/APPROVED", "PENDING_PAYMENT/REJECTED" });
    }

    [Fact]
    public async Task อนุมัติชนกับผู้ดูแลอีกคนกดยกเลิก_ต้องไม่มีการจองที่PAIDแต่ที่นั่งถูกปล่อยแล้ว()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();

        // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ
        for (var i = 0; i < 6; i += 1)
        {
            var booking = await Fx.Book(user, showtime, seats[i]);
            await Fx.SubmitSlip(booking, user);
            var payment = (await Fx.PaymentOf(booking.Id))!;

            var results = await Fixtures.AllSettled(() => Approve(payment.Id, admin), () => AdminCancel(booking.Id));
            // ฝั่งที่แพ้ต้องได้ 409 ที่อ่านรู้เรื่อง ไม่ใช่ deadlock ที่กลายเป็น 500
            // (deadlock ที่ middleware แปลงเป็น WRITE_CONFLICT ก็ไม่นับว่าผ่าน — ต้องเป็น ApiException จาก service เอง)
            foreach (var failed in results.Where(r => !r.Ok))
            {
                Assert.True(
                    failed.Error is ApiException { Status: 409 },
                    $"ได้ {(failed.Error as ApiException)?.Code ?? failed.Error!.GetType().Name}: {failed.Error!.Message}");
            }

            var finalBooking = (await Fx.BookingOf(booking.Id))!;
            var finalPayment = (await Fx.PaymentOf(booking.Id))!;
            var heldSeats = await Fx.CountHeldSeats(booking.Id);
            if (finalBooking.Status == BookingStatus.PAID)
            {
                Assert.Equal(1, heldSeats);
                Assert.Equal(PaymentStatus.APPROVED, finalPayment.Status);
            }
            else
            {
                Assert.Equal(BookingStatus.CANCELLED, finalBooking.Status);
                Assert.Equal(0, heldSeats);
                Assert.NotEqual(PaymentStatus.APPROVED, finalPayment.Status);
            }
        }
    }

    [Fact]
    public async Task ลำดับคิวตรวจสลิป_ค่าเริ่มต้นเก่าสุดก่อน_newestใบล่าสุดก่อน_และแบ่งหน้าตามลำดับเดียวกัน()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var paymentIds = new List<string>();
        for (var index = 0; index < 3; index += 1)
        {
            var user = await Fx.CreateUser();
            var booking = await Fx.Book(user, showtime, seats[index]);
            await Fx.SubmitSlip(booking, user);
            var payment = (await Fx.PaymentOf(booking.Id))!;
            // ตั้งเวลาส่งเองให้ห่างกันชัด ๆ ไม่พึ่งว่าสามคำสั่งข้างบนใช้เวลาต่างกันพอ
            var uploadedAt = Fixtures.MinutesFromNow(-30 + index * 10);
            await Fx.Exec(db => db.Payments.Where(p => p.Id == payment.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.SlipUploadedAt, uploadedAt)));
            paymentIds.Add(payment.Id);
        }

        async Task<List<string>> Ids(string? sort = null, int? page = null, int? pageSize = null) =>
            (await Fx.Use<PaymentService, Web.Utils.PageResult<PaymentQueueItem>>(payments =>
                payments.ListAsync(null, sort, page, pageSize))).Rows.Select(item => item.Id).ToList();

        Assert.Equal(paymentIds, await Ids());
        Assert.Equal(paymentIds, await Ids("oldest"));
        Assert.Equal(Enumerable.Reverse(paymentIds), await Ids("newest"));
        Assert.Equal([paymentIds[0]], await Ids("newest", 2, 2));
    }

    [Fact]
    public async Task กดบันทึกคืนเงินซ้ำพร้อมกัน_สำเร็จครั้งเดียว_ไฟล์ของครั้งที่ไม่ผ่านถูกลบ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await AdminCancel(paid.Id);
        var payment = (await Fx.PaymentOf(paid.Id))!;
        var fileA = await Fx.MakeSlipFile(SlipKind.Refund);
        var fileB = await Fx.MakeSlipFile(SlipKind.Refund);

        Task<bool> Complete(SlipFixture file) => Fx.Use<PaymentService, bool>(async payments =>
        {
            await payments.CompleteRefundAsync(payment.Id, admin.Id, null, file.Slip);
            return true;
        });
        var results = await Fixtures.AllSettled(() => Complete(fileA), () => Complete(fileB));

        Assert.Single(results, r => r.Ok);
        Fixtures.AsApiError(Assert.Single(results, r => !r.Ok).Error, "REFUND_NOT_PENDING");
        Assert.Equal(1, await Fx.CountNotifications(NotificationType.REFUND_COMPLETED));

        var stored = (await Fx.PaymentOf(paid.Id))!.RefundSlipPath;
        Assert.Equal(stored == fileA.FileName, Fixtures.FileExists(fileA.Path));
        Assert.Equal(stored == fileB.FileName, Fixtures.FileExists(fileB.Path));
    }

    // ---------- ไม่มีการโอนหลังหมดเวลา (slip-deadline.test.js) ----------

    /// <summary>เลื่อนเส้นตายของการจองไปในอดีต (job ยังไม่ได้ทำงาน)</summary>
    private Task PassDeadline(BookingResponse booking)
    {
        var past = Fixtures.MinutesFromNow(-1);
        return Fx.Exec(db => db.Bookings.Where(b => b.Id == booking.Id).ExecuteUpdateAsync(s => s.SetProperty(b => b.HoldExpiresAt, past)));
    }

    /// <summary>409 HOLD_EXPIRED ที่บอกรหัสการจองไว้ให้ลูกค้าติดต่อเจ้าหน้าที่</summary>
    private static void AssertHoldExpired(BookingResponse booking, Exception? error)
    {
        var api = Fixtures.AsApiError(error, "HOLD_EXPIRED", 409);
        Assert.Contains(booking.Code, api.Message);
    }

    [Fact]
    public async Task หมดเวลาแล้ว_ส่งสลิปไม่ได้_และไฟล์ที่อัปโหลดมาถูกลบทิ้ง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await PassDeadline(booking);
        Assert.Equal(1, await ReleaseExpiredHolds());

        var view = await Fx.Use<PaymentService, PaymentPageResponse>(payments => payments.GetForBookingAsync(booking.Id, user.Id));
        Assert.False(view.CanUploadSlip);
        Assert.False((await Fx.Use<BookingService, BookingResponse>(bookings => bookings.GetByIdAsync(booking.Id))).CanUploadSlip);

        var file = await Fx.MakeSlipFile();
        var error = await Record.ExceptionAsync(() => UploadSlip(booking, user, file));
        AssertHoldExpired(booking, error);
        Assert.False(Fixtures.FileExists(file.Path));
        Assert.Equal(BookingStatus.EXPIRED, (await Fx.BookingOf(booking.Id))!.Status);
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOf(booking.Id))!.Status);
    }

    [Fact]
    public async Task เลยกำหนดแล้วแต่jobยังไม่ปล่อยที่นั่ง_รับสลิปตามปกติ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await PassDeadline(booking);

        await Fx.SubmitSlip(booking, user);
        Assert.Equal(BookingStatus.PENDING_VERIFICATION, (await Fx.BookingOf(booking.Id))!.Status);
        // job ต้องไม่ทับการจองที่ส่งสลิปแล้ว
        Assert.Equal(0, await ReleaseExpiredHolds());
    }

    [Fact]
    public async Task ส่งสลิปพร้อมกับที่jobกำลังปิดการจอง_ชนะได้ฝั่งเดียว_ไม่มีสลิปค้างบนการจองที่หมดเวลา()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        // วนหลายรอบให้มีโอกาสสลับลำดับกันจริง ๆ — บางรอบ job ปิดก่อน บางรอบสลิปเข้าก่อน
        for (var i = 0; i < 5; i += 1)
        {
            var user = await Fx.CreateUser();
            var booking = await Fx.Book(user, showtime, seats[i]);
            await PassDeadline(booking);
            var file = await Fx.MakeSlipFile();

            var results = await Fixtures.AllSettled<object?>(
                async () => await ReleaseExpiredHolds(),
                async () => await UploadSlip(booking, user, file));
            var upload = results[1];

            var current = (await Fx.BookingOf(booking.Id))!;
            var payment = (await Fx.PaymentOf(booking.Id))!;
            var held = await Fx.CountHeldSeats(booking.Id);
            if (upload.Ok)
            {
                Assert.Equal(BookingStatus.PENDING_VERIFICATION, current.Status);
                Assert.Equal(PaymentStatus.PENDING_VERIFICATION, payment.Status);
                // สลิปเข้าก่อน — ที่นั่งต้องยังถูกยึดไว้
                Assert.Equal(1, held);
            }
            else
            {
                AssertHoldExpired(booking, upload.Error);
                Assert.Equal(BookingStatus.EXPIRED, current.Status);
                Assert.Equal(PaymentStatus.REJECTED, payment.Status);
                // job ปิดก่อน — ที่นั่งต้องถูกปล่อย
                Assert.Equal(0, held);
                Assert.False(Fixtures.FileExists(file.Path));
            }
        }
    }

    [Fact]
    public async Task ปฏิเสธสลิปหลังรอบเริ่มฉาย_ปิดการจองและปล่อยที่นั่ง_ไม่เปิดให้จ่ายใหม่และส่งสลิปใหม่ไม่ได้()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture(startsAt: Fixtures.MinutesFromNow(60));
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        await Fx.SubmitSlip(booking, user);
        // รอบเริ่มฉายไปแล้วระหว่างที่สลิปรอตรวจ
        var (startsAt, endsAt) = (Fixtures.MinutesFromNow(-5), Fixtures.MinutesFromNow(115));
        await Fx.Exec(db => db.Showtimes.Where(s => s.Id == showtime.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.StartsAt, startsAt).SetProperty(x => x.EndsAt, endsAt)));

        var payment = (await Fx.PaymentOf(booking.Id))!;
        var rejected = await Reject(payment.Id, admin, "ยอดไม่ตรง");

        Assert.Equal(BookingStatus.EXPIRED, rejected.Status);
        // ต้องไม่ได้เวลาจ่ายใหม่
        Assert.Null(rejected.HoldExpiresAt);
        Assert.False(rejected.CanUploadSlip);
        Assert.Equal(0, await Fx.CountHeldSeats(booking.Id));
        var note = (await Fx.Query(db => db.Notifications.FirstAsync(n => n.Type == NotificationType.PAYMENT_REJECTED)));
        Assert.Contains("ปิดแล้ว", note.BodyTh);
        Assert.Contains("ติดต่อเจ้าหน้าที่", note.BodyTh);

        // โอนจริงแต่แนบรูปผิด — ส่งสลิปใหม่ไม่ได้แล้ว ต้องติดต่อเจ้าหน้าที่ตามที่แจ้งเตือนบอก
        AssertHoldExpired(booking, await Record.ExceptionAsync(() => Fx.SubmitSlip(booking, user)));
        Assert.Equal(PaymentStatus.REJECTED, (await Fx.PaymentOf(booking.Id))!.Status);
    }
}
