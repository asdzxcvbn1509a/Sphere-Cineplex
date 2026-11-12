namespace CineBook.Web.Emails;

/// <summary>เนื้อหาอีเมลหนึ่งฉบับ — ข้อความล้วนกับ HTML คู่กันเสมอ</summary>
public sealed record EmailContent(string Subject, string Text, string Html);

/// <summary>
/// ตัวช่วยร่วมของเนื้อหาอีเมลแบบ HTML
/// ค่าที่มาจากผู้ใช้ (ชื่อ ชื่อเรื่อง) และลิงก์ต้องผ่าน EscapeHtml ก่อนต่อเข้า HTML ทุกครั้ง
/// </summary>
public static class Html
{
    public static string Escape(string? value) =>
        (value ?? "")
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal);
}
