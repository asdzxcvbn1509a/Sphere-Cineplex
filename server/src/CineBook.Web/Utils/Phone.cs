using System.Text.RegularExpressions;
using CineBook.Web.Infrastructure.Errors;

namespace CineBook.Web.Utils;

public static partial class Phone
{
    [GeneratedRegex("[^0-9]")]
    private static partial Regex NonDigit();

    [GeneratedRegex("^0[689][0-9]{8}$")]
    private static partial Regex ThaiMobile();

    /// <summary>
    /// ทำให้เบอร์อยู่ในรูปเดียวกันเสมอ: 10 หลักขึ้นต้นด้วย 0
    /// รองรับ 0812345678 / 081-234-5678 / +66812345678 / 66812345678
    ///
    /// ต้อง normalize ทุกครั้งก่อนบันทึกหรือค้นหา ไม่งั้นเบอร์เดียวกันที่พิมพ์คนละแบบ
    /// จะกลายเป็นคนละบัญชี ทั้งที่คอลัมน์ phone เป็น unique
    /// (ใช้ [^0-9] ไม่ใช่ \D — \D ของ .NET นับเลขไทย ๐–๙ เป็นตัวเลขด้วย ซึ่ง JavaScript เดิมไม่นับ)
    /// </summary>
    public static string Normalize(string? raw)
    {
        var digits = NonDigit().Replace(raw ?? "", "");
        if (digits.StartsWith("66", StringComparison.Ordinal) && digits.Length == 11) return $"0{digits[2..]}";
        if (digits.StartsWith('0') && digits.Length == 10) return digits;
        if (digits.Length == 9) return $"0{digits}";
        return digits;
    }

    public static bool IsValidThaiMobile(string phone) => ThaiMobile().IsMatch(phone);

    /// <summary>normalize แล้วต้องเป็นเบอร์มือถือไทย ไม่งั้น 400 INVALID_PHONE — ใช้ทั้งตอนสมัครและตอนผู้ดูแลแก้ข้อมูลให้</summary>
    public static string RequireThaiMobile(string? raw)
    {
        var phone = Normalize(raw);
        if (!IsValidThaiMobile(phone))
        {
            throw ApiException.BadRequest("INVALID_PHONE", "เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องเป็นเบอร์มือถือ 10 หลัก)");
        }
        return phone;
    }
}
