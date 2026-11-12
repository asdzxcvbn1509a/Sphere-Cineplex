using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.RateLimiting;
using CineBook.Web.Infrastructure.Security;
using CineBook.Web.Models.Requests;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api;

[Route("api/auth")]
public sealed class AuthController(AuthService auth, AppConfig config, TimeProvider time) : ApiControllerBase
{
    // @ENDPOINT POST http://localhost:4000/api/auth/register
    [HttpPost("register")]
    [AllowAnonymous]
    [RateLimit("register", Sequence = 1)]
    [RateLimit("registerFailure", Sequence = 2)]
    public async Task<IActionResult> Register(RegisterRequest body)
    {
        var session = await auth.RegisterAsync(body.Name!, body.Email!, body.Phone!, body.Password!, UserAgent);
        RefreshTokens.SetCookie(Response, session.RefreshToken, config, time);
        return Created201(new { user = session.User, accessToken = session.AccessToken, isNewUser = true });
    }

    // @ENDPOINT POST http://localhost:4000/api/auth/login
    [HttpPost("login")]
    [AllowAnonymous]
    [RateLimit("login")]
    public async Task<IActionResult> Login(LoginRequest body)
    {
        var session = await auth.LoginAsync(body.Identifier!, body.Password!, UserAgent);
        RefreshTokens.SetCookie(Response, session.RefreshToken, config, time);
        return Ok(new { user = session.User, accessToken = session.AccessToken });
    }

    // @ENDPOINT POST http://localhost:4000/api/auth/forgot-password
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [RateLimit("forgotPassword")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest body)
    {
        var result = await auth.RequestPasswordResetAsync(body.Email!, body.Lang, ForwardedHeadersSetup.ClientIp(HttpContext));
        // devResetUrl มีเฉพาะตอนพัฒนาที่ยังไม่ได้ตั้ง SMTP — ไม่มีก็ไม่ส่งช่องนี้เลย (แบบเดิม)
        return result.DevResetUrl is null
            ? Ok(new { ok = result.Ok, ttlMinutes = result.TtlMinutes })
            : Ok(new { ok = result.Ok, ttlMinutes = result.TtlMinutes, devResetUrl = result.DevResetUrl });
    }

    /// <summary>
    /// token อยู่ใน body ไม่ใช่ใน path เพราะ path ไปโผล่ใน access log ของเซิร์ฟเวอร์ ส่วน body ไม่ถูกบันทึก
    /// </summary>
    // @ENDPOINT POST http://localhost:4000/api/auth/reset-password/check
    [HttpPost("reset-password/check")]
    [AllowAnonymous]
    [RateLimit("resetPassword")]
    public async Task<IActionResult> CheckResetLink(ResetCheckRequest body) => Ok(await auth.CheckResetTokenAsync(body.Token));

    // @ENDPOINT POST http://localhost:4000/api/auth/reset-password
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [RateLimit("resetPassword")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest body)
    {
        // ไม่ล็อกอินให้อัตโนมัติ ให้ผู้ใช้พิมพ์รหัสใหม่ที่หน้าล็อกอินอีกรอบ
        // จะได้รู้ตั้งแต่ตอนนี้ว่าจำรหัสที่เพิ่งตั้งได้จริง ไม่ใช่ไปงงเอาตอนเข้าครั้งหน้า
        var email = await auth.ResetPasswordAsync(body.Token, body.Password!);
        return Ok(new { ok = true, email });
    }

    // @ENDPOINT POST http://localhost:4000/api/auth/refresh
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<IActionResult> Refresh()
    {
        var presented = RefreshTokens.Read(Request);
        // ไม่มี cookie = ผู้ใช้ทั่วไปที่ยังไม่ล็อกอิน ไม่ใช่ข้อผิดพลาด — หน้าเว็บถามที่นี่ทุกครั้งที่เปิด
        // ถ้าตอบ 401 คนที่ยังไม่ล็อกอินทุกคนจะเห็น error สีแดงใน console ทุกครั้งที่โหลดหน้า
        if (presented is null) return NoContent();

        try
        {
            var session = await auth.RotateSessionAsync(presented, UserAgent);
            RefreshTokens.SetCookie(Response, session.RefreshToken, config, time);
            return Ok(new { user = session.User, accessToken = session.AccessToken });
        }
        catch (ApiException error) when (error.Status == 401)
        {
            // ใบนี้ใช้ต่อไม่ได้แล้ว (ไม่รู้จัก/หมดอายุ/ถูกเพิกถอน) ลบทิ้ง — ไม่งั้นเบราว์เซอร์ส่งใบเสียมาได้ 401 ซ้ำทุกครั้งที่เปิดหน้า
            // ไม่ลบตอน 409 REFRESH_RACE: อีกแท็บเพิ่งได้ใบใหม่ไป cookie ในเบราว์เซอร์ตอนนี้เป็นใบดีแล้ว
            RefreshTokens.ClearCookie(Response, config);
            throw;
        }
    }

    // @ENDPOINT POST http://localhost:4000/api/auth/logout
    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await auth.RevokeSessionAsync(RefreshTokens.Read(Request));
        RefreshTokens.ClearCookie(Response, config);
        return Ok(new { ok = true });
    }

    // @ENDPOINT GET http://localhost:4000/api/auth/me
    [HttpGet("me")]
    [Authorize]
    public IActionResult GetMe() => Ok(new { user = UserResponse.From(Me) });

    [HttpPatch("me")]
    [Authorize]
    [RateLimit("currentPassword")]
    public async Task<IActionResult> UpdateMe(UpdateProfileRequest body)
    {
        var user = await auth.UpdateProfileAsync(Me.Id, body.Name, body.Email, body.CurrentPassword);
        return Ok(new { user });
    }

    // @ENDPOINT PATCH http://localhost:4000/api/auth/password
    [HttpPatch("password")]
    [Authorize]
    [RateLimit("currentPassword")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest body)
    {
        // เก็บเซสชันของเครื่องที่กำลังใช้อยู่ไว้ ไม่งั้นเปลี่ยนรหัสเสร็จจะเด้งออกจากระบบทันที
        var accessToken = await auth.ChangePasswordAsync(Me.Id, body.CurrentPassword!, body.NewPassword!, RefreshTokens.Read(Request));
        return Ok(new { ok = true, accessToken });
    }
}
