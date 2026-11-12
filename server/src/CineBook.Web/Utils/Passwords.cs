using System.Text.RegularExpressions;
using CineBook.Web.Infrastructure.Config;

namespace CineBook.Web.Utils;

/// <summary>
/// เกณฑ์รหัสผ่าน: ยาวพอและมีทั้งตัวอักษรกับตัวเลข
/// ไม่บังคับอักขระพิเศษ เพราะทำให้คนตั้งรหัสที่จำยากแล้วไปจดไว้ที่อื่นแทน
///
/// อยู่ที่นี่เพื่อให้ทุกทางที่ตั้งรหัสผ่านได้ (สมัคร, เปลี่ยนเอง, ผู้ดูแลรีเซ็ตให้) ใช้เกณฑ์เดียวกัน
/// </summary>
public static partial class PasswordRules
{
    /// <summary>bcrypt อ่านรหัสผ่านแค่ 72 ไบต์แรก ยาวกว่านั้นต้องกันไว้ตั้งแต่ชั้น validate ไม่ใช่ปล่อยให้ถูกตัดเงียบ ๆ</summary>
    public const int MaxLength = 72;
    public const int MinLength = 8;

    [GeneratedRegex("[A-Za-z]")]
    private static partial Regex Letter();

    [GeneratedRegex("[0-9]")]
    private static partial Regex Digit();

    /// <summary>ข้อความ error ตามลำดับเดียวกับ zod เดิม (ข้อแรกที่ไม่ผ่าน) — ผ่านทุกข้อคืน null</summary>
    public static IEnumerable<string> Violations(string? value)
    {
        var password = value ?? "";
        if (password.Length < MinLength) yield return $"รหัสผ่านต้องยาวอย่างน้อย {MinLength} ตัวอักษร";
        if (password.Length > MaxLength) yield return $"รหัสผ่านต้องไม่เกิน {MaxLength} ตัวอักษร";
        if (!Letter().IsMatch(password)) yield return "รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว";
        if (!Digit().IsMatch(password)) yield return "รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว";
    }
}

/// <summary>hash/ตรวจรหัสผ่านด้วย bcrypt — hash เดิมที่ bcryptjs สร้างไว้ ($2b$) ตรวจผ่านได้ตามปกติ</summary>
public sealed class PasswordHasher
{
    private readonly int _rounds;

    public PasswordHasher(AppConfig config)
    {
        _rounds = config.BcryptRounds;
        DummyHash = Hash(Guid.NewGuid().ToString());
    }

    /// <summary>
    /// hash ที่ไม่มีทางตรงกับรหัสผ่านใด ๆ — ใช้เทียบทิ้งเปล่า ๆ ตอนหาบัญชีไม่เจอ
    /// ให้เวลาตอบกลับใกล้เคียงกับตอนที่บัญชีมีอยู่จริง ไม่งั้นคนร้ายจับเวลา response
    /// ก็ไล่ได้ว่าอีเมลหรือเบอร์ไหนมีบัญชีอยู่ในระบบ
    /// </summary>
    public string DummyHash { get; }

    /// <summary>ใช้ revision 2b แบบเดียวกับ bcryptjs เดิม hash ของบัญชีเก่าและใหม่จึงหน้าตาเดียวกัน</summary>
    public string Hash(string plain) => BCrypt.Net.BCrypt.HashPassword(plain, BCrypt.Net.BCrypt.GenerateSalt(_rounds, 'b'));

    /// <summary>hash ผิดรูป (เช่น '!' ของบัญชีเก่าที่ยังไม่เคยตั้งรหัสผ่าน) ถือว่าไม่ตรง ไม่ใช่ error</summary>
    public bool Verify(string? plain, string? hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(plain ?? "", hash ?? "");
        }
        catch (Exception ex) when (ex is BCrypt.Net.SaltParseException or ArgumentException)
        {
            return false;
        }
    }
}
