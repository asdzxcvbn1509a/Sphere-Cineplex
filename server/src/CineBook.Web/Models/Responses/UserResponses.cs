using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Models.Responses;

/// <summary>ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ — ไม่มี passwordHash และ tokenVersion</summary>
public sealed record UserResponse(string Id, string Phone, string Name, string Email, Role Role)
{
    public static UserResponse From(User user) => new(user.Id, user.Phone, user.Name, user.Email, user.Role);

    public static UserResponse From(CurrentUser user) => new(user.Id, user.Phone, user.Name, user.Email, user.Role);
}

/// <summary>ผลของการสมัคร/ล็อกอิน/ต่ออายุเซสชัน — refresh token ไปทาง cookie เท่านั้น ไม่อยู่ใน body</summary>
public sealed record SessionResult(UserResponse User, string AccessToken, string RefreshToken);

/// <summary>ผู้ใช้ในหน้าจัดการผู้ใช้ของผู้ดูแล — เห็นเท่าที่จำเป็นต่อการช่วยลูกค้า</summary>
public sealed record AdminUserResponse(
    string Id,
    string Email,
    string Phone,
    string Name,
    Role Role,
    DateTime CreatedAt,
    int BookingCount);
