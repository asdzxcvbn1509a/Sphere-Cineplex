using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace CineBook.Web.Utils;

public enum TrustProxyMode
{
    /// <summary>ไม่เชื่อ X-Forwarded-For เลย ใช้ไอพีของ connection ตรง ๆ</summary>
    None,
    /// <summary>เชื่อทุก hop — อันตราย ใครก็ปลอมไอพีหลบ rate limit ได้</summary>
    All,
    /// <summary>จำนวน proxy ที่อยู่หน้า API</summary>
    Hops,
    /// <summary>รายการไอพี/subnet (และชื่อกลุ่ม loopback, linklocal, uniquelocal)</summary>
    List,
}

public sealed record TrustProxySetting(TrustProxyMode Mode, int Hops, IReadOnlyList<string> Entries)
{
    /// <summary>เครือข่ายที่เชื่อ (เฉพาะ mode List) — แปลงชื่อกลุ่มแบบเดียวกับ Express เป็น subnet จริงแล้ว</summary>
    public IReadOnlyList<(IPAddress Prefix, int Length)> Networks()
    {
        var result = new List<(IPAddress, int)>();
        foreach (var entry in Entries)
        {
            switch (entry)
            {
                case "loopback":
                    result.Add((IPAddress.Parse("127.0.0.1"), 8));
                    result.Add((IPAddress.IPv6Loopback, 128));
                    break;
                case "linklocal":
                    result.Add((IPAddress.Parse("169.254.0.0"), 16));
                    result.Add((IPAddress.Parse("fe80::"), 10));
                    break;
                case "uniquelocal":
                    result.Add((IPAddress.Parse("10.0.0.0"), 8));
                    result.Add((IPAddress.Parse("172.16.0.0"), 12));
                    result.Add((IPAddress.Parse("192.168.0.0"), 16));
                    result.Add((IPAddress.Parse("fc00::"), 7));
                    break;
                default:
                    var slash = entry.IndexOf('/');
                    var address = IPAddress.Parse(slash < 0 ? entry : entry[..slash]);
                    var length = slash < 0
                        ? (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128)
                        : int.Parse(entry[(slash + 1)..], CultureInfo.InvariantCulture);
                    result.Add((address, length));
                    break;
            }
        }
        return result;
    }
}

/// <summary>
/// แปลงค่า TRUST_PROXY ให้เป็นการตั้งค่าว่าจะเชื่อ X-Forwarded-For แค่ไหน (ความหมายเดียวกับ trust proxy ของ Express)
///
/// - 'loopback' (ค่าเริ่มต้น) — เชื่อ X-Forwarded-For เฉพาะเมื่อคนส่งต่อมาคือเครื่องเดียวกัน
///   (nginx/caddy ที่รันบนเครื่องเดียวกับ API) ใครต่อตรงจากข้างนอกปลอมไอพีผ่าน header ไม่ได้
/// - ตัวเลข — จำนวน proxy ที่อยู่หน้า API (เช่น front end ของ App Service 1 ชั้น = 1)
/// - ชื่อ/subnet อื่น ๆ เช่น 'uniquelocal', '10.0.0.0/8' (คั่นด้วยจุลภาคได้)
/// - 'true' — เชื่อทุก hop: อันตราย ใครก็ปลอมไอพีหลบ rate limit ได้ ใช้เฉพาะเมื่อรู้ตัวจริง ๆ
/// - 'false' — ไม่เชื่อ header เลย ใช้ไอพีของ connection ตรง ๆ
/// </summary>
public static partial class TrustProxy
{
    [GeneratedRegex("^[0-9]+$")]
    private static partial Regex Digits();

    public static TrustProxySetting Parse(string? raw)
    {
        var value = (raw ?? "").Trim();
        if (value is "" or "false") return new TrustProxySetting(TrustProxyMode.None, 0, []);
        if (value == "true") return new TrustProxySetting(TrustProxyMode.All, 0, []);
        if (Digits().IsMatch(value))
        {
            var hops = int.Parse(value, CultureInfo.InvariantCulture);
            return hops == 0
                ? new TrustProxySetting(TrustProxyMode.None, 0, [])
                : new TrustProxySetting(TrustProxyMode.Hops, hops, []);
        }
        var entries = value.Split(',').Select(part => part.Trim()).Where(part => part.Length > 0).ToList();
        return new TrustProxySetting(TrustProxyMode.List, 0, entries);
    }

    /// <summary>ใช้ตรวจตอนเปิดเครื่อง — ค่าที่แปลงไม่ได้ควรหยุดตั้งแต่ต้น ไม่ใช่ไปพังกลางคำขอแรก</summary>
    public static bool TryValidate(string? raw, out string? error)
    {
        error = null;
        try
        {
            Parse(raw).Networks();
            return true;
        }
        catch (FormatException ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
