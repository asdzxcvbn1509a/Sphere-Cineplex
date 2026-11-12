using System.Security.Cryptography;
using System.Text;

namespace CineBook.Web.Utils;

/// <summary>header ที่ proxy หน้า API แนบมากับทุกคำขอ (ใช้เมื่อวาง proxy/CDN ไว้ข้างหน้าแล้วตั้ง PROXY_SECRET)</summary>
public static class ProxySecret
{
    public const string Header = "x-proxy-secret";

    private static byte[] Digest(string? value) => SHA256.HashData(Encoding.UTF8.GetBytes(value ?? ""));

    /// <summary>
    /// สร้างตัวเทียบ secret — ไม่ได้ตั้ง secret ไว้ = ไม่มีคำขอไหนเทียบผ่าน (คืน false เสมอ)
    /// เทียบ hash ของทั้งสองฝั่งด้วย FixedTimeEquals: ความยาวเท่ากันเสมอ และเวลาที่ใช้ไม่บอกว่าเดาถูกไปกี่ตัวอักษร
    /// </summary>
    public static Func<string?, bool> CreateMatcher(string? secret)
    {
        if (string.IsNullOrEmpty(secret)) return _ => false;
        var expected = Digest(secret);
        return presented => CryptographicOperations.FixedTimeEquals(Digest(presented), expected);
    }
}
