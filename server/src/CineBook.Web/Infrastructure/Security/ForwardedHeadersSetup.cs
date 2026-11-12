using System.Net;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Utils;
using Microsoft.AspNetCore.HttpOverrides;

namespace CineBook.Web.Infrastructure.Security;

/// <summary>
/// ไอพีของผู้ใช้เป็นกุญแจของ rate limit ทุกตัว — ต้องเชื่อ X-Forwarded-For เฉพาะ proxy ที่ตั้งไว้จริงเท่านั้น (TRUST_PROXY)
/// ไม่งั้นใครก็ใส่ header ปลอมมาหลบโควตาล็อกอิน/สมัคร/ลืมรหัสผ่านได้
/// </summary>
public static class ForwardedHeadersSetup
{
    /// <summary>เก็บ X-Forwarded-For ดิบไว้ก่อนถูกแก้ — /api/health นับจำนวน proxy จากค่านี้</summary>
    public const string RawForwardedForKey = "proxy:raw-xff";

    public static IApplicationBuilder UseTrustedForwardedHeaders(this IApplicationBuilder app, AppConfig config)
    {
        app.Use((context, next) =>
        {
            context.Items[RawForwardedForKey] = context.Request.Headers["X-Forwarded-For"].ToString();
            return next(context);
        });

        var setting = config.TrustProxySetting;
        if (setting.Mode == TrustProxyMode.None) return app;

        var options = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor };
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        switch (setting.Mode)
        {
            case TrustProxyMode.All:
                options.ForwardLimit = null;
                break;
            case TrustProxyMode.Hops:
                // ตัวเลข = จำนวน proxy หน้า API: เชื่อรายการขวาสุด N รายการ (แบบ trust proxy = N ของ Express)
                options.ForwardLimit = setting.Hops;
                break;
            case TrustProxyMode.List:
                options.ForwardLimit = null;
                foreach (var (prefix, length) in setting.Networks())
                {
                    options.KnownIPNetworks.Add(new System.Net.IPNetwork(prefix, length));
                }
                break;
        }
        return app.UseForwardedHeaders(options);
    }

    /// <summary>ไอพีที่ระบบมองเห็นในรูปแบบเดียวกับ req.ip ของ Express (IPv4 ที่ห่อเป็น IPv6 แกะออก)</summary>
    public static string? ClientIp(HttpContext context)
    {
        var address = context.Connection.RemoteIpAddress;
        if (address is null) return null;
        return address.IsIPv4MappedToIPv6 ? address.MapToIPv4().ToString() : address.ToString();
    }

    public static IPAddress? Normalize(IPAddress? address) =>
        address is not null && address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
}
