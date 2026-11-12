using CineBook.Web.Models.Entities;

namespace CineBook.Web.Infrastructure.Auth;

/// <summary>
/// ผู้ใช้ที่ล็อกอินอยู่ของคำขอนี้ — อ่านจากฐานข้อมูลทุก request (ไม่เชื่อค่าใน JWT)
/// เปลี่ยน role หรือเพิกถอน token แล้วจึงมีผลกับคำขอถัดไปทันที
/// </summary>
public sealed record CurrentUser(string Id, string Phone, string Name, string Email, Role Role);
