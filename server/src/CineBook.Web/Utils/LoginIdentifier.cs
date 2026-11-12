namespace CineBook.Web.Utils;

/// <summary>ผลการแปลงช่องล็อกอิน — มีค่าใดค่าหนึ่งเท่านั้น</summary>
public sealed record LoginLookup(string? Email, string? Phone);

public static class LoginIdentifier
{
    /// <summary>อีเมลเก็บเป็นตัวพิมพ์เล็กเสมอ — ตัวพิมพ์ต่างกันจะได้ไม่กลายเป็นคนละบัญชี (ผู้ดูแลแก้อีเมลให้ก็ใช้ตัวนี้)</summary>
    public static string NormalizeEmail(string? raw) => (raw ?? "").Trim().ToLowerInvariant();

    /// <summary>
    /// แปลงสิ่งที่กรอกในช่องล็อกอินเป็นเงื่อนไขค้นบัญชี — มี @ = อีเมล ไม่มี = เบอร์โทร · ว่างหลัง normalize คืน null
    ///
    /// ใช้ทั้งตอนค้นบัญชีและเป็นกุญแจของ rate limit ล็อกอิน ต้องเป็นตัวเดียวกันเสมอ
    /// เดิมกุญแจ rate limit แค่ตัดช่องว่างกับทำเป็นตัวเล็ก แต่การค้นบัญชีตัดทุกอักขระที่ไม่ใช่ตัวเลขออกจากเบอร์
    /// 0812345678, 081-234-5678, +66812345678 จึงเป็นบัญชีเดียวกันแต่นับโควตาแยกกัน — เดารหัสผ่านได้ไม่จำกัด
    /// </summary>
    public static LoginLookup? Lookup(string? raw)
    {
        var value = (raw ?? "").Trim();
        if (value.Contains('@'))
        {
            var email = NormalizeEmail(value);
            return email.Length > 0 ? new LoginLookup(email, null) : null;
        }
        var phone = Phone.Normalize(value);
        return phone.Length > 0 ? new LoginLookup(null, phone) : null;
    }

    /// <summary>กุญแจของบัญชีสำหรับ rate limit — ช่องว่างหรือรูปแบบที่ต่างกันของบัญชีเดียวกันได้กุญแจเดียวกัน</summary>
    public static string Key(string? raw)
    {
        var lookup = Lookup(raw);
        if (lookup is null) return "";
        return lookup.Email is not null ? $"email:{lookup.Email}" : $"phone:{lookup.Phone}";
    }
}
