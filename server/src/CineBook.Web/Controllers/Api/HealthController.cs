using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api;

/// <summary>ตรวจว่าเซิร์ฟเวอร์ยังทำงาน — ไม่แตะฐานข้อมูล ใช้กับ health check ของโฮสต์และตัวปลุก (UptimeRobot)</summary>
[ApiController]
[AllowAnonymous]
[Route("api/health")]
public sealed class HealthController(TimeProvider time) : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        var forwardedFor = HttpContext.Items[ForwardedHeadersSetup.RawForwardedForKey] as string ?? "";
        return Ok(new
        {
            ok = true,
            service = "theatre-reservation-api",
            time = time.UtcNowMs(),
            // ไว้ตั้ง TRUST_PROXY ตอนขึ้นระบบจริง (ดู DEPLOY.md) — ตั้ง TRUST_PROXY = proxyHops
            // ตั้งถูกแล้ว ip ต้องเป็นไอพีจริงของผู้เรียก ไม่ใช่ไอพีของ proxy ตัวใดตัวหนึ่ง
            ip = ForwardedHeadersSetup.ClientIp(HttpContext),
            proxyHops = forwardedFor.Split(',').Count(part => part.Trim().Length > 0),
            // ไว้ตรวจการตั้ง PROXY_SECRET — ค่าทั้งหมดดูใน ProxySecretMiddleware
            proxySecret = HttpContext.Items[ProxySecretMiddleware.StatusKey] as string ?? "missing",
        });
    }
}
