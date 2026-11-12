using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Models.Entities;
using CineBook.Web.Utils;
using Npgsql;

namespace CineBook.Tests.Unit;

/// <summary>เทสต์ของส่วนที่เปลี่ยนเทคโนโลยี — ต้องเข้ากันได้กับข้อมูล/โทเคนที่ฝั่ง Express สร้างไว้</summary>
[Trait("Category", "Unit")]
public sealed class PlatformTests
{
    private const string Secret = "test_access_secret_not_for_production";

    private static AppConfig Config(string accessTtl = "15m") => new()
    {
        DatabaseUrl = "x",
        ConnectionString = "x",
        EnvironmentName = "Test",
        JwtAccessSecret = Secret,
        JwtRefreshSecret = Secret,
        AccessTokenTtl = accessTtl,
        AccessTokenLifetimeMs = Duration.ParseMilliseconds(accessTtl)!.Value,
        AppUrl = "http://localhost:5173",
        ServerRoot = ".",
        BcryptRounds = 8,
    };

    [Fact]
    public void token_ที่jsonwebtokenออกไว้_ตรวจผ่านได้ทันที()
    {
        // ออกด้วย jsonwebtoken ของฝั่ง Express (exp ปี 2096) — token ที่ค้างอยู่ตอนย้ายระบบต้องยังใช้ได้
        const string token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjdXNlcjEyMyIsInJvbGUiOiJBRE1JTiIsInR2IjozLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6NDAwMDAwMDAwMH0.VQFbGYkdVgs5viaqQTwQDub_-3IFBZm71R9weSdT7pw";
        var (payload, error) = new AccessTokens(Config(), TimeProvider.System).Verify(token);
        Assert.Null(error);
        Assert.Equal(new AccessTokenPayload("cuser123", "ADMIN", 3, 1700000000, 4000000000), payload);
    }

    [Fact]
    public void token_หมดอายุ_ลายเซ็นผิด_หรือalgอื่น_ไม่ผ่าน()
    {
        var tokens = new AccessTokens(Config(), TimeProvider.System);
        const string expired = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjdXNlcjEyMyIsInJvbGUiOiJVU0VSIiwidHYiOjAsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAwOTAwfQ.ShNr3fKLJ3J_YOgQJLfs7uzPLUBgNxU_Lb9CvvDD118";
        Assert.Equal(AccessTokenError.Expired, tokens.Verify(expired).Error);
        Assert.Equal(AccessTokenError.Invalid, tokens.Verify(expired[..^2] + "AA").Error);
        Assert.Equal(AccessTokenError.Invalid, tokens.Verify("not.a.token").Error);
        // alg none ต้องไม่ผ่านแม้ payload จะถูกรูป
        const string none = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ4IiwiZXhwIjo0MDAwMDAwMDAwfQ.";
        Assert.Equal(AccessTokenError.Invalid, tokens.Verify(none).Error);
    }

    [Fact]
    public void tokenที่ระบบใหม่ออก_มีiatและexpห่างกันตามACCESS_TOKEN_TTL()
    {
        var tokens = new AccessTokens(Config(), TimeProvider.System);
        var token = tokens.Sign(new User { Id = "cabc", Role = Role.USER, TokenVersion = 2 });
        var (payload, error) = tokens.Verify(token);
        Assert.Null(error);
        Assert.Equal(900, payload!.Exp - payload.Iat);
        Assert.Equal(2, payload.Tv);
        Assert.StartsWith("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.", token);
    }

    [Fact]
    public void bcrypt_hashที่bcryptjsสร้างไว้ตรวจผ่าน_และhashใหม่เป็นรุ่น2b()
    {
        var hasher = new PasswordHasher(Config());
        Assert.True(hasher.Verify("Password123", "$2b$08$z0hPJlRIr.CWPGkjzgYuCOWW6066dIrmJoddL1BU.K9tM.qxlWVZe"));
        Assert.False(hasher.Verify("Password124", "$2b$08$z0hPJlRIr.CWPGkjzgYuCOWW6066dIrmJoddL1BU.K9tM.qxlWVZe"));
        // hash ผิดรูป (บัญชีเก่าที่ตั้งเป็น '!') = ไม่ตรง ไม่ใช่ error
        Assert.False(hasher.Verify("anything", "!"));
        Assert.StartsWith("$2b$08$", hasher.Hash("Password123"));
    }

    [Theory]
    [InlineData("15m", 900_000)]
    [InlineData("1h", 3_600_000)]
    [InlineData("7d", 604_800_000)]
    [InlineData("2 days", 172_800_000)]
    [InlineData("900", 900)]
    [InlineData("1.5h", 5_400_000)]
    public void ช่วงเวลาแบบไลบรารีms(string value, double expected) => Assert.Equal(expected, Duration.ParseMilliseconds(value));

    [Fact]
    public void ช่วงเวลาที่อ่านไม่ได้คืนnull()
    {
        Assert.Null(Duration.ParseMilliseconds("soon"));
        Assert.Null(Duration.ParseMilliseconds(""));
    }

    [Fact]
    public void DATABASE_URLแบบURIแปลงเป็นconnectionstringของNpgsql()
    {
        var builder = new NpgsqlConnectionStringBuilder(DatabaseUrl.ToNpgsql(
            "postgresql://cine%40admin:p%40ss%23word@db.example.com:6543/cinebook?sslmode=require&connection_limit=5&schema=public"));
        Assert.Equal("db.example.com", builder.Host);
        Assert.Equal(6543, builder.Port);
        Assert.Equal("cinebook", builder.Database);
        Assert.Equal("cine@admin", builder.Username);
        Assert.Equal("p@ss#word", builder.Password);
        Assert.Equal(SslMode.Require, builder.SslMode);
        Assert.Equal(5, builder.MaxPoolSize);
        Assert.Null(builder.SearchPath);
        Assert.Equal("theatre_reservation_test", DatabaseUrl.DatabaseName("postgres://u:p@localhost/theatre_reservation_test"));
        Assert.Equal("x_test", DatabaseUrl.DatabaseName("Host=localhost;Database=x_test;Username=u"));
    }

    [Fact]
    public void Cuidยาว25ตัว_ขึ้นต้นด้วยc_และไม่ซ้ำ()
    {
        var ids = Enumerable.Range(0, 2000).Select(_ => Cuid.New()).ToList();
        Assert.All(ids, id =>
        {
            Assert.Equal(25, id.Length);
            Assert.StartsWith("c", id);
            Assert.Matches("^[0-9a-z]+$", id);
        });
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Theory]
    // ค่าอ้างอิงจาก Intl.DateTimeFormat ของ Node (th-TH / en-GB, Asia/Bangkok) ที่ฝั่ง Express ใช้
    [InlineData("2026-10-02T12:00:00Z", "2 ต.ค. 19:00", "2 Oct, 19:00", "2 ตุลาคม 2569 เวลา 19:00", "2 October 2026 at 19:00")]
    [InlineData("2026-01-05T02:05:00Z", "5 ม.ค. 09:05", "5 Jan, 09:05", "5 มกราคม 2569 เวลา 09:05", "5 January 2026 at 09:05")]
    [InlineData("2026-12-31T17:00:00Z", "1 ม.ค. 00:00", "1 Jan, 00:00", "1 มกราคม 2570 เวลา 00:00", "1 January 2027 at 00:00")]
    [InlineData("2027-03-09T23:59:00Z", "10 มี.ค. 06:59", "10 Mar, 06:59", "10 มีนาคม 2570 เวลา 06:59", "10 March 2027 at 06:59")]
    [InlineData("2026-09-15T05:07:00Z", "15 ก.ย. 12:07", "15 Sept, 12:07", "15 กันยายน 2569 เวลา 12:07", "15 September 2026 at 12:07")]
    public void วันเวลาไทยและอังกฤษตรงกับIntlของเดิม(string iso, string shortTh, string shortEn, string longTh, string longEn)
    {
        var utc = DateTime.Parse(iso).ToUniversalTime();
        Assert.Equal(shortTh, BangkokTime.FormatShort(utc, "th"));
        Assert.Equal(shortEn, BangkokTime.FormatShort(utc, "en"));
        Assert.Equal(longTh, BangkokTime.FormatLong(utc, "th"));
        Assert.Equal(longEn, BangkokTime.FormatLong(utc, "en"));
    }

    [Fact]
    public void ช่วงวันตามเวลาไทยเหมือนDateParseของJavaScript()
    {
        Assert.Equal(
            (DateTime.Parse("2026-02-27T17:00:00Z").ToUniversalTime(), DateTime.Parse("2026-02-28T17:00:00Z").ToUniversalTime()),
            BangkokTime.DayRange("2026-02-28"));
        // วันเกินเดือนเลื่อนไปเดือนถัดไปแบบ JavaScript
        Assert.Equal(DateTime.Parse("2026-03-01T17:00:00Z").ToUniversalTime(), BangkokTime.DayRange("2026-02-30")!.Value.Start);
        Assert.Null(BangkokTime.DayRange("2026-13-01"));
        Assert.Null(BangkokTime.DayRange("2026-2-3"));
        Assert.Null(BangkokTime.DayRange("abc"));
        Assert.Equal("2027-01-01", BangkokTime.DateKey(DateTime.Parse("2026-12-31T17:00:00Z").ToUniversalTime()));
    }
}
