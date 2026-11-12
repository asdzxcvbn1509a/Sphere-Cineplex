using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>
/// ลิงก์ตั้งรหัสผ่านใหม่ที่ส่งไปทางอีเมล — เก็บแค่ sha256 hash เหมือน refresh token
/// ฐานข้อมูลรั่วก็เอาแถวพวกนี้ไปตั้งรหัสผ่านใหม่ของใครไม่ได้
/// </summary>
public class PasswordResetToken : ICreatedAt
{
    public string Id { get; set; } = Cuid.New();
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    /// <summary>ใช้ไปแล้วครั้งเดียวจบ ลิงก์เดิมกดซ้ำไม่ได้แม้จะยังไม่หมดอายุ</summary>
    public DateTime? UsedAt { get; set; }
    /// <summary>ไอพีของคนที่กดขอลิงก์ ไว้ไล่ดูตอนมีคนสั่งรีเซ็ตบัญชีคนอื่นรัว ๆ</summary>
    public string? RequestIp { get; set; }
    public DateTime CreatedAt { get; set; }

    public User User { get; set; } = null!;
}
