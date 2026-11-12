using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class User : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    /// <summary>ชื่อผู้ใช้หลักตอนเข้าสู่ระบบ เก็บเป็นตัวพิมพ์เล็กเสมอ จะได้ไม่มีบัญชีซ้ำแค่เพราะพิมพ์ใหญ่/เล็กต่างกัน</summary>
    public string Email { get; set; } = "";
    /// <summary>ล็อกอินด้วยเบอร์แทนอีเมลก็ได้ และใช้เป็นช่องทางติดต่อเวลาการจองมีปัญหา</summary>
    public string Phone { get; set; } = "";
    /// <summary>bcrypt hash เท่านั้น — ไม่เคยเก็บรหัสผ่านจริงลงฐานข้อมูล</summary>
    public string PasswordHash { get; set; } = "";
    /// <summary>
    /// ฝังอยู่ใน access token — เพิ่มค่าเมื่อเปลี่ยน/รีเซ็ตรหัสผ่าน แล้ว access token เก่าทุกใบใช้ไม่ได้ทันที
    /// (ไม่ต้องรอหมดอายุ 15 นาที) การยืนยันตัวตนอ่านแถวผู้ใช้ทุก request อยู่แล้ว จึงเทียบได้แทบไม่มีต้นทุน
    /// </summary>
    public int TokenVersion { get; set; }
    public string Name { get; set; } = "";
    public Role Role { get; set; } = Role.USER;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<Booking> Bookings { get; set; } = [];
    public List<RefreshToken> RefreshTokens { get; set; } = [];
    public List<PasswordResetToken> PasswordResets { get; set; } = [];
    public List<Notification> Notifications { get; set; } = [];
    public List<Payment> VerifiedPayments { get; set; } = [];
    public List<Payment> RefundedPayments { get; set; } = [];
    public List<SeatChange> SeatChangesMade { get; set; } = [];
}
