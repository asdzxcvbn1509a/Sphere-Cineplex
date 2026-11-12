using System.Net;
using System.Net.Http.Headers;
using CineBook.Tests.Helpers;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>
/// port ส่วนที่เหลือของ test/integration/http.test.js — อัปโหลด/เปิดดูสลิป แบ่งหน้า boolean ใน query และแจ้งเตือน
/// ยิงผ่าน HTTP ทั้งสาย (header → auth → rate limit → ตัวรับไฟล์ → ตรวจไฟล์ → service)
/// </summary>
[Trait("Category", "Integration")]
public sealed class HttpBookingTests(ApiFactory factory) : IntegrationTest(factory)
{
    private Task<HttpResponseMessage> PostSlip(string bookingId, string token, byte[] content, string type = "image/png", Action<MultipartFormDataContent>? fields = null)
    {
        var form = new MultipartFormDataContent();
        fields?.Invoke(form);
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(type);
        form.Add(file, "slip", "slip.png");
        return Client(token).PostAsync($"/api/payments/{bookingId}/slip", form);
    }

    private int SlipFileCount() =>
        Directory.Exists(Factory.Config.PaymentSlipDir) ? Directory.GetFiles(Factory.Config.PaymentSlipDir).Length : 0;

    // ---------- อัปโหลดสลิป ----------

    [Fact]
    public async Task ไฟล์ที่บอกว่าเป็นPNGแต่ไส้ในเป็นHTMLถูกปฏิเสธ_และไม่เหลือไฟล์ค้าง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        var before = SlipFileCount();

        var res = await PostSlip(booking.Id, TokenFor(user), "<html><script>alert(1)</script></html>"u8.ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("UNSUPPORTED_FILE_TYPE", await ErrorCode(res));
        Assert.Equal(before, SlipFileCount());
        Assert.Equal(BookingStatus.PENDING_PAYMENT, (await Fx.BookingOf(booking.Id))!.Status);
    }

    [Fact]
    public async Task รูปPNGจริงผ่าน_และการจองเข้าคิวตรวจ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);

        var res = await PostSlip(booking.Id, TokenFor(user), Fixtures.TinyPng);

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Equal(BookingStatus.PENDING_VERIFICATION, (await Fx.BookingOf(booking.Id))!.Status);
    }

    [Fact]
    public async Task ช่องข้อความเกินจำนวนหรือยาวเกิน_ถูกปฏิเสธตั้งแต่ตอนรับไฟล์_และไม่เหลือไฟล์ค้าง()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        var before = SlipFileCount();

        Action<MultipartFormDataContent>[] forms =
        [
            form => { for (var i = 0; i < 6; i += 1) form.Add(new StringContent("x"), $"field{i}"); },
            form => form.Add(new StringContent(new string('x', 5 * 1024)), "note"),
        ];
        foreach (var fields in forms)
        {
            var res = await PostSlip(booking.Id, TokenFor(user), Fixtures.TinyPng, fields: fields);
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
            Assert.Equal("UPLOAD_ERROR", await ErrorCode(res));
        }
        Assert.Equal(before, SlipFileCount());
        Assert.Equal(BookingStatus.PENDING_PAYMENT, (await Fx.BookingOf(booking.Id))!.Status);
    }

    [Fact]
    public async Task อัปโหลดสลิปได้ไม่เกิน20ครั้งต่อชั่วโมงต่อบัญชี()
    {
        var user = await Fx.CreateUser();
        var token = TokenFor(user);
        var before = SlipFileCount();
        // การจองที่ไม่มีอยู่จริง — service ตอบ 404 และลบไฟล์ทิ้งทุกครั้ง แต่ทุกคำขอนับโควตา
        for (var i = 0; i < 20; i += 1)
        {
            Assert.Equal(HttpStatusCode.NotFound, (await PostSlip("no-such-booking", token, Fixtures.TinyPng)).StatusCode);
        }
        Assert.Equal(before, SlipFileCount());

        var res = await PostSlip("no-such-booking", token, Fixtures.TinyPng);
        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.Equal("SLIP_RATE_LIMITED", await ErrorCode(res));
    }

    // ---------- เปิดดูสลิป ----------

    [Fact]
    public async Task เจ้าของการจองเปิดรูปที่อัปโหลดได้_ไบต์และชนิดไฟล์ตรงกับที่ส่งไป()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        var token = TokenFor(user);
        Assert.Equal(HttpStatusCode.Created, (await PostSlip(booking.Id, token, Fixtures.TinyPng)).StatusCode);

        var res = await Client(token).GetAsync($"/api/payments/{booking.Id}/slip");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("image/png", res.Content.Headers.ContentType?.ToString());
        Assert.True(res.Headers.CacheControl is { Private: true, NoStore: true }, res.Headers.CacheControl?.ToString());
        Assert.Equal(Fixtures.TinyPng, await res.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task DBยังอ้างถึงแต่ไฟล์หายจากที่เก็บแล้ว_ได้404SLIP_FILE_MISSINGไม่ใช่500()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);
        var token = TokenFor(user);
        Assert.Equal(HttpStatusCode.Created, (await PostSlip(booking.Id, token, Fixtures.TinyPng)).StatusCode);
        var slipPath = (await Fx.PaymentOf(booking.Id))!.SlipPath!;
        File.Delete(Path.Combine(Factory.Config.PaymentSlipDir, slipPath));

        var res = await Client(token).GetAsync($"/api/payments/{booking.Id}/slip");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("SLIP_FILE_MISSING", await ErrorCode(res));
    }

    // ---------- แบ่งหน้ารายการฝั่งผู้ดูแล ----------

    [Fact]
    public async Task แบ่งหน้า_หน้า2ได้ช่วงถัดไปพร้อมจำนวนทั้งหมด_หน้าเกินได้รายการว่าง_และขอเกินเพดานไม่ได้()
    {
        var admin = await Fx.CreateAdmin();
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        for (var i = 0; i < 7; i += 1) await Fx.Book(await Fx.CreateUser(), showtime, seats[i]);
        var client = Client(TokenFor(admin));
        Task<HttpResponseMessage> Get(string query) => client.GetAsync($"/api/admin/bookings?{query}");

        var all = await Json(await Get("pageSize=100"));
        Assert.Equal(7, all["total"]!.GetValue<int>());
        var allIds = all["bookings"]!.AsArray().Select(b => b!["id"]!.GetValue<string>()).ToList();
        Assert.Equal(7, allIds.Count);

        var page2 = await Json(await Get("page=2&pageSize=3"));
        Assert.Equal(7, page2["total"]!.GetValue<int>());
        Assert.Equal(2, page2["page"]!.GetValue<int>());
        Assert.Equal(3, page2["pageSize"]!.GetValue<int>());
        Assert.Equal(allIds.Skip(3).Take(3), page2["bookings"]!.AsArray().Select(b => b!["id"]!.GetValue<string>()));

        var beyond = await Json(await Get("page=5&pageSize=3"));
        Assert.Empty(beyond["bookings"]!.AsArray());
        Assert.Equal(7, beyond["total"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Get("pageSize=500")).StatusCode);
    }

    // ---------- boolean ใน query string ----------

    [Fact]
    public async Task forceเท่ากับfalseไม่ใช่การยืนยันลบถาวร_หนังที่มีการจองยังอยู่_ค่าที่ไม่ใช่trueหรือfalseได้422()
    {
        var (showtime, movie, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        await Fx.Book(user, showtime, seats[0]);
        Task<HttpResponseMessage> Remove(string query) => Client(TokenFor(admin)).DeleteAsync($"/api/admin/movies/{movie.Id}?{query}");

        var kept = await Remove("force=false");
        Assert.Equal(HttpStatusCode.Conflict, kept.StatusCode);
        Assert.Equal("MOVIE_HAS_BOOKINGS", await ErrorCode(kept));
        Assert.Equal(HttpStatusCode.OK, (await Client().GetAsync($"/api/movies/{movie.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Remove("force=yes")).StatusCode);
    }

    private Task<Notification> Notify(User user, string code) =>
        Fx.Query(db => NotificationService.NotifyAsync(db, user.Id, NotificationType.BOOKING_EXPIRED, new NotificationContext { Code = code }));

    [Fact]
    public async Task unreadOnlyเท่ากับfalseคืนแจ้งเตือนที่อ่านแล้วด้วย_ไม่ใช่แค่ที่ยังไม่อ่าน()
    {
        var user = await Fx.CreateUser();
        var read = await Notify(user, "READ01");
        await Notify(user, "NEW001");
        await Fx.Use<NotificationService>(notifications => notifications.MarkReadAsync(user.Id, read.Id));
        async Task<System.Text.Json.Nodes.JsonObject> List(string query) =>
            await Json(await Client(TokenFor(user)).GetAsync($"/api/notifications?{query}"));

        var all = await List("unreadOnly=false");
        Assert.Equal(2, all["notifications"]!.AsArray().Count);
        Assert.Equal(1, all["unreadCount"]!.GetValue<int>());
        Assert.Single((await List("unreadOnly=true"))["notifications"]!.AsArray());
    }

    [Fact]
    public async Task ลบแจ้งเตือนได้เฉพาะของตัวเอง_ของคนอื่นตอบ200แต่ไม่ถูกลบ()
    {
        var owner = await Fx.CreateUser();
        var other = await Fx.CreateUser();
        var item = await Notify(owner, "DEL001");
        Task<HttpResponseMessage> Remove(User user) => Client(TokenFor(user)).DeleteAsync($"/api/notifications/{item.Id}");
        Task<bool> Exists() => Fx.Query(db => db.Notifications.AnyAsync(n => n.Id == item.Id));

        Assert.Equal(HttpStatusCode.OK, (await Remove(other)).StatusCode);
        Assert.True(await Exists());

        Assert.Equal(HttpStatusCode.OK, (await Remove(owner)).StatusCode);
        Assert.False(await Exists());
        // ลบซ้ำ (เช่น กดจากอีกแท็บ) ไม่ error
        Assert.Equal(HttpStatusCode.OK, (await Remove(owner)).StatusCode);
    }

    // ---------- เพิ่มเติมจากการย้ายมา ASP.NET Core ----------

    [Fact]
    public async Task bodyว่างหรือไม่ใช่JSON_ตรวจเป็นวัตถุว่างแบบเดิม_ไม่ใช่415()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var booking = await Fx.Book(user, showtime, seats[0]);

        // schema ที่ทุกช่องไม่บังคับ — ไม่มี body ก็ผ่าน (ผู้ดูแลยกเลิกโดยไม่ระบุเหตุผล)
        var cancelled = await Client(TokenFor(admin)).PostAsync($"/api/admin/bookings/{booking.Id}/cancel", null);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal(BookingStatus.CANCELLED, (await Fx.BookingOf(booking.Id))!.Status);

        // ช่องบังคับ — body ที่ไม่ใช่ JSON ได้ 422 พร้อมรายชื่อช่องที่ขาด
        var res = await Client(TokenFor(user)).PostAsync("/api/bookings", new StringContent("hello", System.Text.Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        var details = (await Json(res))["error"]!["details"]!.AsArray().Select(d => d!["field"]!.GetValue<string>()).ToList();
        Assert.Contains("showtimeId", details);
        Assert.Contains("seatIds", details);
    }

    [Fact]
    public async Task หมายเหตุคืนเงินส่งเป็นJSONได้เหมือนเดิม_ไม่ถูกล้างเงียบๆ()
    {
        var (showtime, _, _, seats) = await Fx.CreateShowtimeFixture();
        var admin = await Fx.CreateAdmin();
        var user = await Fx.CreateUser();
        var paid = await Fx.CreatePaidBooking(user, admin, showtime, seats[0]);
        await Fx.Use<BookingService, CineBook.Web.Models.Responses.BookingResponse>(bookings =>
            bookings.CancelAsync(paid.Id, null, byAdmin: true, null, RefundAccount.None));
        var payment = (await Fx.PaymentOf(paid.Id))!;
        var file = await Fx.MakeSlipFile(CineBook.Web.Infrastructure.Storage.SlipKind.Refund);
        await Fx.Use<PaymentService>(payments => payments.CompleteRefundAsync(payment.Id, admin.Id, "โอนแล้ว", file.Slip));

        var res = await Client(TokenFor(admin)).PatchAsync($"/api/admin/refunds/{payment.Id}", JsonBody(new { note = "  แก้ผ่าน JSON  " }));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = (await Fx.PaymentOf(paid.Id))!;
        Assert.Equal("แก้ผ่าน JSON", updated.RefundNote);
        Assert.Equal(file.FileName, updated.RefundSlipPath);
    }
}
