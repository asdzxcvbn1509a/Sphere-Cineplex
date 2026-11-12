using System.Security.Claims;
using System.Text.Encodings.Web;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Errors;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CineBook.Web.Infrastructure.Auth;

/// <summary>
/// ยืนยันตัวตนจาก Authorization: Bearer &lt;accessToken&gt; (แทน middleware/authenticate.js)
///
/// อ่านผู้ใช้จากฐานข้อมูลทุก request และเทียบ tokenVersion — เปลี่ยน role หรือเปลี่ยน/รีเซ็ตรหัสผ่านแล้ว
/// มีผลกับคำขอถัดไปทันที ไม่ต้องรอ token หมดอายุ 15 นาที (คนที่ขโมย access token ไปได้จะโดนตัดพร้อมกับ refresh token)
///
/// endpoint ที่ [Authorize] แต่ token ใช้ไม่ได้ → 401 พร้อมรหัสที่บอกเหตุ (NO_TOKEN / INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_REVOKED)
/// endpoint สาธารณะได้ผู้ใช้ผูกมาด้วยถ้า token ใช้ได้ ใช้ไม่ได้ก็ถือเป็นผู้ใช้ทั่วไป (แบบ optionalAuth เดิม)
/// </summary>
public sealed class BearerAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AccessTokens accessTokens,
    AppDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Bearer";
    private const string FailureKey = "auth:failure";
    private const string UserKey = "auth:user";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = ReadBearer(Request);
        if (token is null)
        {
            Context.Items[FailureKey] = ApiException.Unauthorized("NO_TOKEN", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
            return AuthenticateResult.NoResult();
        }

        var (payload, error) = accessTokens.Verify(token);
        if (payload is null)
        {
            var expired = error == AccessTokenError.Expired;
            Context.Items[FailureKey] = ApiException.Unauthorized(
                expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
                expired ? "เซสชันหมดอายุ" : "โทเคนไม่ถูกต้อง");
            return AuthenticateResult.Fail("invalid token");
        }

        var found = await db.Users.AsNoTracking()
            .Where(u => u.Id == payload.Sub)
            .Select(u => new { u.Id, u.Phone, u.Name, u.Email, u.Role, u.TokenVersion })
            .FirstOrDefaultAsync(Context.RequestAborted);
        if (found is null || found.TokenVersion != payload.Tv)
        {
            Context.Items[FailureKey] = ApiException.Unauthorized("TOKEN_REVOKED", "เซสชันนี้ถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่");
            return AuthenticateResult.Fail("token revoked");
        }

        var user = new CurrentUser(found.Id, found.Phone, found.Name, found.Email, found.Role);
        Context.Items[UserKey] = user;
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Role, user.Role.ToString())],
            SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var error = Context.Items[FailureKey] as ApiException ?? ApiException.Unauthorized();
        return ApiErrorWriter.WriteAsync(Context, error);
    }

    /// <summary>มี token ถูกต้องแต่ role ไม่พอ (เช่นลูกค้าเรียก /api/admin/*)</summary>
    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        ApiErrorWriter.WriteAsync(Context, ApiException.Forbidden("ROLE_REQUIRED", "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้"));

    private static string? ReadBearer(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.Ordinal)) return null;
        var token = header[7..].Trim();
        return token.Length > 0 ? token : null;
    }

    public static CurrentUser? UserOf(HttpContext context) => context.Items[UserKey] as CurrentUser;
}

public static class CurrentUserExtensions
{
    /// <summary>ผู้ใช้ที่ล็อกอินอยู่ — ใช้ใน action ที่ [Authorize] แล้วเท่านั้น (ไม่มี = บั๊กของการตั้ง route)</summary>
    public static CurrentUser RequireUser(this HttpContext context) =>
        BearerAuthenticationHandler.UserOf(context) ?? throw ApiException.Unauthorized();

    public static CurrentUser? OptionalUser(this HttpContext context) => BearerAuthenticationHandler.UserOf(context);
}
