using CineBook.Tests.Helpers;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Integration;

/// <summary>port จาก test/integration/auth.test.js</summary>
[Trait("Category", "Integration")]
public sealed class AuthTests(ApiFactory factory) : IntegrationTest(factory)
{
    private Task<int> LiveSessions(string userId) =>
        Db().RefreshTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null);

    private async Task<string> IssueSession(User user, string agent) =>
        (await Get<AuthService>().IssueSessionAsync(user, agent)).RefreshToken;

    [Fact]
    public async Task สองแท็บต่ออายุด้วยcookieใบเดียวกันพร้อมกัน_ได้ใบใหม่ใบเดียว_และไม่โดนเตะออกทุกอุปกรณ์()
    {
        var user = await Fx.CreateUser();
        var refreshToken = await IssueSession(user, "tab");

        var attempts = new[] { Get<AuthService>(), Get<AuthService>() }
            .Select(service => Capture(service.RotateSessionAsync(refreshToken, null)))
            .ToList();
        var results = await Task.WhenAll(attempts);
        var ok = results.Where(r => r.Value is not null).ToList();
        var failed = results.Where(r => r.Error is not null).ToList();

        Assert.Single(ok);
        Assert.Equal("REFRESH_RACE", failed[0].Error!.Code);
        Assert.Equal(1, await LiveSessions(user.Id));

        // แท็บที่แพ้ลองใหม่ด้วย cookie ใบใหม่ (เบราว์เซอร์อัปเดต cookie ให้แล้ว) — ต้องผ่าน
        var retried = await Get<AuthService>().RotateSessionAsync(ok[0].Value!.RefreshToken, null);
        Assert.False(string.IsNullOrEmpty(retried.AccessToken));
    }

    [Fact]
    public async Task เอาใบที่ถูกrotateไปนานแล้วมาใช้ซ้ำ_ถูกขโมย_เพิกถอนทุกเซสชัน()
    {
        var user = await Fx.CreateUser();
        var refreshToken = await IssueSession(user, "phone");
        await IssueSession(user, "laptop");
        var rotated = await Get<AuthService>().RotateSessionAsync(refreshToken, null);

        // ทำเหมือนเวลาผ่านไปเกินช่วงผ่อนผันแล้ว
        var hash = RefreshTokens.Hash(refreshToken);
        var past = DateTime.UtcNow.AddMinutes(-1);
        await Db().RefreshTokens.Where(t => t.TokenHash == hash).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, past));

        await Fixtures.ExpectApiError(Get<AuthService>().RotateSessionAsync(refreshToken, null), "REFRESH_TOKEN_REUSED", 401);
        Assert.Equal(0, await LiveSessions(user.Id));
        await Fixtures.ExpectApiError(Get<AuthService>().RotateSessionAsync(rotated.RefreshToken, null), "REFRESH_TOKEN_REUSED", 401);
    }

    [Fact]
    public async Task ใบที่logoutไปแล้ว_ไม่ได้รับช่วงผ่อนผัน_ใช้ซ้ำทันทีก็ถือว่าถูกขโมย()
    {
        var user = await Fx.CreateUser();
        var refreshToken = await IssueSession(user, "phone");
        await IssueSession(user, "laptop");
        await Get<AuthService>().RevokeSessionAsync(refreshToken);

        await Fixtures.ExpectApiError(Get<AuthService>().RotateSessionAsync(refreshToken, null), "REFRESH_TOKEN_REUSED", 401);
        Assert.Equal(0, await LiveSessions(user.Id));
    }

    [Fact]
    public async Task สองคำขอใช้ลิงก์ตั้งรหัสผ่านเดียวกันพร้อมกัน_ตั้งได้ครั้งเดียว_อีกคำขอได้RESET_LINK_INVALID()
    {
        var user = await Fx.CreateUser();
        await IssueSession(user, "phone");
        var token = "race-reset-token".PadRight(43, 'x');
        var db = Db();
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = RefreshTokens.Hash(token),
            ExpiresAt = DateTime.UtcNow.AddMinutes(10),
        });
        await db.SaveChangesAsync();

        string[] passwords = ["NewPassword111", "NewPassword222"];
        var results = await Task.WhenAll(passwords.Select(password => Capture(Get<AuthService>().ResetPasswordAsync(token, password))));
        var winner = Array.FindIndex(results, r => r.Value is not null);
        var failed = results.Where(r => r.Error is not null).ToList();

        Assert.Single(failed);
        Assert.Equal("RESET_LINK_INVALID", failed[0].Error!.Code);
        var stored = await Db().Users.AsNoTracking().FirstAsync(u => u.Id == user.Id);
        Assert.True(Get<PasswordHasher>().Verify(passwords[winner], stored.PasswordHash), "รหัสที่ใช้ได้ต้องเป็นของคำขอที่ชนะ");
        Assert.Equal(0, await LiveSessions(user.Id));
    }

    private sealed record Outcome<T>(T? Value, ApiException? Error);

    private static async Task<Outcome<T>> Capture<T>(Task<T> task)
    {
        try
        {
            return new Outcome<T>(await task, null);
        }
        catch (ApiException error)
        {
            return new Outcome<T>(default, error);
        }
    }
}
