namespace CineBook.Web.Utils;

/// <summary>
/// ค้นข้อความแบบ "มีคำนี้อยู่" (contains ของ Prisma) ด้วย ILIKE — หนีอักขระพิเศษของ LIKE ก่อน
/// ไม่งั้นคำค้นที่มี % หรือ _ (เช่นอีเมล a_b@…) จะกลายเป็น wildcard
/// </summary>
public static class Like
{
    public const string Escape = "\\";

    public static string Contains(string value) =>
        "%" + value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal) + "%";
}
