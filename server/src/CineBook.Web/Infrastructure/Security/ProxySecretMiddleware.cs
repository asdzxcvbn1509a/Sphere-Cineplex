using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Utils;

namespace CineBook.Web.Infrastructure.Security;

/// <summary>
/// รับเฉพาะคำขอที่มาทาง proxy หน้าเว็บ (proxy แนบ secret มาใน header x-proxy-secret) — บังคับเมื่อตั้ง PROXY_SECRET แล้วเท่านั้น
///
/// บน Azure ที่แอปเดียวเสิร์ฟทั้งหน้าเว็บและ API ไม่ต้องตั้ง (มีทางเข้าทางเดียวคือ front end ของ App Service)
/// คงไว้สำหรับกรณีวาง proxy/CDN ไว้ข้างหน้า: rate limit นับตามไอพีจาก X-Forwarded-For ตามจำนวน proxy ที่ตายตัว (TRUST_PROXY)
/// ถ้าคำขอเข้ามาได้สองทาง (ผ่าน proxy กับยิงตรง) จำนวน proxy ไม่เท่ากัน ตั้งให้ถูกได้แค่ทางเดียว — ปิดทางตรงไปเลยจึงปลอดภัย
/// </summary>
public sealed class ProxySecretMiddleware(RequestDelegate next, AppConfig config)
{
    /// <summary>เปิดให้เรียกตรงได้เสมอ — health check ของโฮสต์และตัวปลุกเซิร์ฟเวอร์ (UptimeRobot) ไม่ได้มาทาง proxy</summary>
    private const string OpenPath = "/api/health";

    /// <summary>ข้อความที่ proxy บางเจ้า (เช่น Vercel) ส่งมาตรง ๆ เมื่อยังไม่ได้ตั้งตัวแปร PROXY_SECRET ฝั่งตัวเอง</summary>
    private const string UnresolvedPlaceholder = "$PROXY_SECRET";

    public const string StatusKey = "proxy:secret-status";

    private readonly Func<string?, bool> _matches = ProxySecret.CreateMatcher(config.ProxySecret);

    public Task InvokeAsync(HttpContext context)
    {
        var presented = context.Request.Headers[ProxySecret.Header].ToString();
        var status = StatusOf(presented.Length > 0 ? presented : null);
        context.Items[StatusKey] = status;

        if (string.IsNullOrEmpty(config.ProxySecret) || status == "valid" ||
            context.Request.Path.Equals(OpenPath, StringComparison.Ordinal))
        {
            return next(context);
        }
        return ApiErrorWriter.WriteAsync(context, ApiException.Forbidden("DIRECT_ACCESS_FORBIDDEN", "กรุณาใช้งานผ่านหน้าเว็บ"));
    }

    /// <summary>
    /// สถานะ secret ของคำขอ — /api/health แสดงไว้ให้ตรวจการตั้งค่าได้ทีละขั้น
    /// missing = ไม่มี header · unresolved = proxy ยังไม่มีตัวแปร PROXY_SECRET
    /// unchecked = มี header แล้วแต่ API ยังไม่ได้ตั้ง PROXY_SECRET · valid = ตรงกัน · invalid = สองฝั่งตั้งค่าไม่เหมือนกัน
    /// </summary>
    private string StatusOf(string? presented)
    {
        if (presented is null) return "missing";
        if (presented == UnresolvedPlaceholder) return "unresolved";
        if (string.IsNullOrEmpty(config.ProxySecret)) return "unchecked";
        return _matches(presented) ? "valid" : "invalid";
    }
}
