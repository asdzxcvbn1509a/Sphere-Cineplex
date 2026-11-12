using System.Net;
using CineBook.Tests.Helpers;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Tests.Integration;

/// <summary>
/// เทสต์ผ่าน HTTP ทั้งสาย (headers → proxy secret → authenticate → rate limit → validate → service)
/// port ส่วน auth / headers / health / rate limit จาก test/integration/http.test.js
/// </summary>
[Trait("Category", "Integration")]
public sealed class HttpAuthTests(ApiFactory factory) : IntegrationTest(factory)
{
    [Fact]
    public async Task ทุกresponseมีnosniff_เบราว์เซอร์ต้องไม่เดาชนิดไฟล์สลิปเป็นอย่างอื่น()
    {
        var res = await Client().GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task health_บอกจำนวนproxyในXForwardedFor_และไอพีที่ระบบมองเห็น()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.Add("X-Forwarded-For", "203.0.113.9, 198.51.100.7");
        var body = await Json(await Client().SendAsync(request));

        Assert.Equal(2, body["proxyHops"]!.GetValue<int>());
        // เทสต์ตั้ง TRUST_PROXY=loopback — เชื่อแค่ hop แรกที่มาจากเครื่องเดียวกัน จึงได้รายการขวาสุดของ header
        Assert.Equal("198.51.100.7", body["ip"]!.GetValue<string>());
    }

    [Fact]
    public async Task health_เรียกตรงไม่ผ่านproxy_ได้proxyHopsเป็น0_และยังไม่ได้ตั้งsecretได้unchecked()
    {
        var direct = await Json(await Client().GetAsync("/api/health"));
        Assert.Equal(0, direct["proxyHops"]!.GetValue<int>());
        Assert.Equal("missing", direct["proxySecret"]!.GetValue<string>());

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.Add("X-Proxy-Secret", "anything");
        Assert.Equal("unchecked", (await Json(await Client().SendAsync(request)))["proxySecret"]!.GetValue<string>());
    }

    [Fact]
    public async Task PROXY_SECRET_รับเฉพาะคำขอที่มาทางหน้าเว็บ()
    {
        var secret = "proxy-secret-for-tests-".PadRight(48, 'x');
        using var guarded = new ConfiguredApiFactory(config => config with { ProxySecret = secret });
        var client = guarded.CreateClient();
        Task<HttpResponseMessage> Get(string path, string? presented)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, path);
            if (presented is not null) request.Headers.Add("X-Proxy-Secret", presented);
            return client.SendAsync(request);
        }

        foreach (var presented in new[] { null, "wrong", "$PROXY_SECRET" })
        {
            var res = await Get("/api/auth/me", presented);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            Assert.Equal("DIRECT_ACCESS_FORBIDDEN", await ErrorCode(res));
        }

        // secret ถูก → ผ่านไปถึง route ตามปกติ (me ไม่มี token จึงได้ 401 ของ route ไม่ใช่ 403)
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get("/api/auth/me", secret)).StatusCode);

        async Task<string> StatusOf(string? presented)
        {
            var res = await Get("/api/health", presented);
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            return (await Json(res))["proxySecret"]!.GetValue<string>();
        }
        Assert.Equal("missing", await StatusOf(null));
        Assert.Equal("unresolved", await StatusOf("$PROXY_SECRET"));
        Assert.Equal("invalid", await StatusOf("wrong"));
        Assert.Equal("valid", await StatusOf(secret));
    }

    [Fact]
    public async Task เส้นทางapiที่ไม่มีได้404ROUTE_NOT_FOUNDเป็นJSON()
    {
        var res = await Client().GetAsync("/api/nope?x=1");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        var body = await Json(res);
        Assert.Equal("ROUTE_NOT_FOUND", body["error"]!["code"]!.GetValue<string>());
        Assert.Equal("ไม่พบเส้นทาง GET /api/nope?x=1", body["error"]!["message"]!.GetValue<string>());

        // method ผิดบน path ที่มีอยู่ก็ได้ 404 แบบเดียวกับ Express (ไม่ใช่ 405)
        Assert.Equal(HttpStatusCode.NotFound, (await Client().DeleteAsync("/api/health")).StatusCode);
    }

    [Fact]
    public async Task เปลี่ยนรหัสผ่าน_accessTokenใบเก่าใช้ไม่ได้ทันที_เครื่องที่กดได้ใบใหม่_refreshเดิมยังต่ออายุได้()
    {
        var user = await Fx.CreateUser(password: "Password123");
        var session = await Get<AuthService>().IssueSessionAsync(user, "test");
        Task<HttpResponseMessage> Me(string token) => Client(token).GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, (await Me(session.AccessToken)).StatusCode);

        var request = new HttpRequestMessage(HttpMethod.Patch, "/api/auth/password")
        {
            Content = JsonBody(new { currentPassword = "Password123", newPassword = "NewPassword456" }),
        };
        request.Headers.Add("Authorization", $"Bearer {session.AccessToken}");
        // refresh token ของเครื่องที่กดเปลี่ยนมากับ cookie — ใบนี้ต้องไม่ถูกเพิกถอน
        request.Headers.Add("Cookie", $"trs_refresh={session.RefreshToken}");
        var changed = await Client().SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var fresh = (await Json(changed))["accessToken"]!.GetValue<string>();

        var revoked = await Me(session.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        Assert.Equal("TOKEN_REVOKED", await ErrorCode(revoked));

        // ใบใหม่ที่ได้กลับมาใช้ได้ทันที หน้าเว็บจึงไม่ต้องไปเจอ 401 ก่อนแล้วค่อยต่ออายุ
        Assert.Equal(HttpStatusCode.OK, (await Me(fresh)).StatusCode);

        var renewed = await Get<AuthService>().RotateSessionAsync(session.RefreshToken, null);
        var ok = await Me(renewed.AccessToken);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var body = await Json(ok);
        Assert.Equal(user.Id, body["user"]!["id"]!.GetValue<string>());
        Assert.Null(body["user"]!["tokenVersion"]);
    }

    private Task<HttpResponseMessage> PostRefresh(string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        if (token is not null) request.Headers.Add("Cookie", $"trs_refresh={token}");
        return Client().SendAsync(request);
    }

    private static string? RefreshCookieOf(HttpResponseMessage res) =>
        res.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.FirstOrDefault(c => c.StartsWith("trs_refresh=", StringComparison.Ordinal))
            : null;

    [Fact]
    public async Task refresh_ไม่มีcookie_ได้204ไม่ใช่401()
    {
        var res = await PostRefresh(null);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.False(res.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task refresh_cookieที่ไม่รู้จัก_ได้401และลบcookieทิ้ง()
    {
        var res = await PostRefresh("not-a-real-token");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("INVALID_REFRESH_TOKEN", await ErrorCode(res));

        var cleared = RefreshCookieOf(res);
        Assert.NotNull(cleared);
        Assert.StartsWith("trs_refresh=;", cleared);
        Assert.Contains("expires=Thu, 01 Jan 1970", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth", cleared, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task refresh_cookieที่ใช้ได้_ได้200พร้อมaccessTokenและcookieใบใหม่()
    {
        var user = await Fx.CreateUser();
        var session = await Get<AuthService>().IssueSessionAsync(user, "test");

        var res = await PostRefresh(session.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.False(string.IsNullOrEmpty((await Json(res))["accessToken"]?.GetValue<string>()));

        var renewed = RefreshCookieOf(res);
        Assert.NotNull(renewed);
        Assert.False(renewed.StartsWith("trs_refresh=;", StringComparison.Ordinal));
        Assert.False(renewed.StartsWith($"trs_refresh={session.RefreshToken};", StringComparison.Ordinal));
        Assert.Contains("httponly", renewed, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", renewed, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth", renewed, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task refresh_ใบที่อีกแท็บเพิ่งrotateไป_ได้409REFRESH_RACEและไม่แตะcookie()
    {
        var user = await Fx.CreateUser();
        var session = await Get<AuthService>().IssueSessionAsync(user, "tab");
        await Get<AuthService>().RotateSessionAsync(session.RefreshToken, null);

        var res = await PostRefresh(session.RefreshToken);
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("REFRESH_RACE", await ErrorCode(res));
        Assert.False(res.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task ล็อกอิน_เบอร์เดียวกันที่พิมพ์คนละรูปแบบใช้โควตาเดียวกัน()
    {
        string[] formats = ["0861234567", "086-123-4567", "+66861234567", "086 123 4567"];
        Task<HttpResponseMessage> Login(string identifier) =>
            Client().PostAsync("/api/auth/login", JsonBody(new { identifier, password = "WrongPassword1" }));

        for (var i = 0; i < Factory.Config.LoginLimit; i += 1)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(formats[i % formats.Length])).StatusCode);
        }
        var res = await Login("66861234567");
        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.Equal("LOGIN_RATE_LIMITED", await ErrorCode(res));
        Assert.True(res.Headers.Contains("Retry-After"));
        Assert.Contains("limit=10", res.Headers.GetValues("RateLimit").Single());
    }

    [Fact]
    public async Task PATCH_me_แก้ชื่อไม่ต้องใช้รหัส_เปลี่ยนอีเมลต้องยืนยันรหัส_และลิงก์รีเซ็ตที่ค้างใช้ไม่ได้อีก()
    {
        var user = await Fx.CreateUser(password: "Password123");
        var db = Db();
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = "pending-link",
            ExpiresAt = DateTime.UtcNow.AddMinutes(1),
        });
        await db.SaveChangesAsync();
        Task<HttpResponseMessage> Patch(object body) =>
            Client(TokenFor(user)).PatchAsync("/api/auth/me", JsonBody(body));

        var renamed = await Patch(new { name = "ชื่อใหม่" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal("ชื่อใหม่", (await Json(renamed))["user"]!["name"]!.GetValue<string>());
        // อีเมลเดิมที่ต่างแค่ตัวพิมพ์ไม่นับว่าเปลี่ยน
        Assert.Equal(HttpStatusCode.OK, (await Patch(new { email = user.Email.ToUpperInvariant() })).StatusCode);

        var noPassword = await Patch(new { email = "new-address@test.local" });
        Assert.Equal(HttpStatusCode.BadRequest, noPassword.StatusCode);
        Assert.Equal("CURRENT_PASSWORD_REQUIRED", await ErrorCode(noPassword));

        var wrongPassword = await Patch(new { email = "new-address@test.local", currentPassword = "Wrong12345" });
        Assert.Equal(HttpStatusCode.BadRequest, wrongPassword.StatusCode);
        Assert.Equal("WRONG_PASSWORD", await ErrorCode(wrongPassword));
        Assert.Equal(user.Email, (await Db().Users.AsNoTracking().FirstAsync(u => u.Id == user.Id)).Email);
        Assert.Equal(1, await Db().PasswordResetTokens.CountAsync(t => t.UserId == user.Id));

        var changed = await Patch(new { email = "New-Address@test.local", currentPassword = "Password123" });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal("new-address@test.local", (await Json(changed))["user"]!["email"]!.GetValue<string>());
        Assert.Equal(0, await Db().PasswordResetTokens.CountAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task สมัครไม่สำเร็จเกิน30ครั้งจากไอพีเดียว_ได้429()
    {
        Task<HttpResponseMessage> Register() => Client().PostAsync("/api/auth/register", JsonBody(new
        {
            name = "ทดสอบ",
            email = "not-an-email",
            phone = "0861234567",
            password = "Password123",
        }));

        for (var i = 0; i < 30; i += 1)
        {
            var attempt = await Register();
            Assert.True((int)attempt.StatusCode == 422, await attempt.Content.ReadAsStringAsync());
        }
        var res = await Register();
        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.Equal("REGISTER_RATE_LIMITED", await ErrorCode(res));
    }

    [Fact]
    public async Task สมัครสำเร็จได้201พร้อมผู้ใช้และcookie_สมัครซ้ำได้EMAIL_TAKEN()
    {
        var body = new { name = "  สมชาย ใจดี ", email = "Somchai@Example.TEST", phone = "081-234-5678", password = "Password123" };
        var res = await Client().PostAsync("/api/auth/register", JsonBody(body));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var json = await Json(res);
        Assert.True(json["isNewUser"]!.GetValue<bool>());
        Assert.Equal("somchai@example.test", json["user"]!["email"]!.GetValue<string>());
        Assert.Equal("0812345678", json["user"]!["phone"]!.GetValue<string>());
        Assert.Equal("สมชาย ใจดี", json["user"]!["name"]!.GetValue<string>());
        Assert.NotNull(RefreshCookieOf(res));

        var again = await Client().PostAsync("/api/auth/register", JsonBody(body));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("EMAIL_TAKEN", await ErrorCode(again));

        var validation = await Client().PostAsync("/api/auth/register", JsonBody(new { name = "ก", email = "x", phone = "1", password = "short" }));
        var details = (await Json(validation))["error"]!["details"]!.AsArray();
        Assert.Contains(details, d => d!["field"]!.GetValue<string>() == "name" && d["message"]!.GetValue<string>() == "กรุณากรอกชื่อ");
        Assert.Contains(details, d => d!["field"]!.GetValue<string>() == "password");
    }
}
