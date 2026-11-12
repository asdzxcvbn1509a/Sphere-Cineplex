using System.Security.Cryptography;
using System.Text;
using CineBook.Web.Infrastructure.Config;

namespace CineBook.Web.Infrastructure.Auth;

/// <summary>
/// refresh token = สตริงสุ่ม 64 ไบต์ (ไม่ใช่ JWT) อยู่ใน httpOnly cookie ชื่อ trs_refresh
/// เก็บลง DB เฉพาะ sha256 hash — ถ้าฐานข้อมูลรั่ว token ที่ได้ไปก็ใช้ไม่ได้
/// </summary>
public static class RefreshTokens
{
    public const string CookieName = "trs_refresh";

    /// <summary>cookie ส่งมาเฉพาะคำขอใต้ /api/auth — endpoint อื่นไม่ต้องเห็น refresh token เลย</summary>
    public const string CookiePath = "/api/auth";

    public static (string Token, string TokenHash) Generate()
    {
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(64));
        return (token, Hash(token));
    }

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static DateTime Expiry(AppConfig config, TimeProvider time) => time.UtcNowMs().Add(config.RefreshTokenLifetime);

    /// <summary>
    /// SameSite=Lax + path /api/auth แบบเดิม — หน้าเว็บต้องเรียก /api บน origin ของตัวเองเสมอ cookie จึงถูกส่งมา
    /// Secure เฉพาะ production (ตอนพัฒนาเป็น http://localhost)
    /// </summary>
    public static void SetCookie(HttpResponse response, string token, AppConfig config, TimeProvider time)
    {
        response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = config.IsProduction,
            Path = CookiePath,
            MaxAge = config.RefreshTokenLifetime,
            Expires = time.GetUtcNow().Add(config.RefreshTokenLifetime),
        });
    }

    public static void ClearCookie(HttpResponse response, AppConfig config)
    {
        response.Cookies.Delete(CookieName, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = config.IsProduction,
            Path = CookiePath,
        });
    }

    public static string? Read(HttpRequest request) =>
        request.Cookies.TryGetValue(CookieName, out var value) && !string.IsNullOrEmpty(value) ? value : null;
}
