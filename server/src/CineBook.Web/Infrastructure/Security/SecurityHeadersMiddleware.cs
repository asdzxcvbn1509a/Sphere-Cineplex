namespace CineBook.Web.Infrastructure.Security;

/// <summary>
/// security headers ของทุก response
/// - /api/* ใช้ชุดค่าเริ่มต้นของ helmet ที่ฝั่ง Express ส่งมาตลอด — สำคัญสุดคือ nosniff:
///   รูปสลิปที่ส่งออกไปต้องไม่ถูกเบราว์เซอร์เดาเป็น HTML/สคริปต์
/// - หน้าเว็บ (React) ใช้ชุดที่เคยอยู่ใน client/vercel.json: CSP ที่อนุญาตสคริปต์/สไตล์เฉพาะจากเว็บเองและ Google Fonts,
///   ห้ามเว็บอื่นฝังหน้า (กันหลอกให้กด "อนุมัติ" ในหน้าผู้ดูแล) และ cache ไฟล์ใน /assets/ ได้ปีหนึ่ง (ชื่อไฟล์มี hash)
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    private const string ApiCsp =
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';" +
        "img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';" +
        "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";

    private const string PageCsp =
        "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
        "img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

    private const string Hsts = "max-age=31536000; includeSubDomains";

    public Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        var path = context.Request.Path;
        if (path.StartsWithSegments("/api"))
        {
            headers.ContentSecurityPolicy = ApiCsp;
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            headers["Cross-Origin-Resource-Policy"] = "same-origin";
            headers["Origin-Agent-Cluster"] = "?1";
            headers["Referrer-Policy"] = "no-referrer";
            headers.StrictTransportSecurity = Hsts;
            headers.XContentTypeOptions = "nosniff";
            headers["X-DNS-Prefetch-Control"] = "off";
            headers["X-Download-Options"] = "noopen";
            headers.XFrameOptions = "SAMEORIGIN";
            headers["X-Permitted-Cross-Domain-Policies"] = "none";
            headers.XXSSProtection = "0";
        }
        else
        {
            headers.ContentSecurityPolicy = PageCsp;
            headers.XFrameOptions = "DENY";
            headers.XContentTypeOptions = "nosniff";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            headers.StrictTransportSecurity = Hsts;
            // Vite ใส่ hash ในชื่อไฟล์ทุกครั้งที่ build — ไฟล์ใน /assets/ จึง cache ได้ยาว ส่วน index.html ต้องถามใหม่ทุกครั้ง
            headers.CacheControl = path.StartsWithSegments("/assets") ? "public, max-age=31536000, immutable" : "no-cache";
        }
        return next(context);
    }
}
