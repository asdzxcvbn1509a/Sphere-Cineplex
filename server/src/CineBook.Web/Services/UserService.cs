using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>จัดการบัญชีผู้ใช้ฝั่งผู้ดูแล (port จาก services/users.js)</summary>
public sealed class UserService(AppDbContext db, TimeProvider time, PasswordHasher passwords)
{
    private static ApiException UserNotFound() => ApiException.NotFound("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");

    private static ApiException DuplicateFieldError(IEnumerable<string> fields)
    {
        var list = fields.ToList();
        if (list.Contains("email")) return ApiException.Conflict("EMAIL_TAKEN", "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว");
        if (list.Contains("phone")) return ApiException.Conflict("PHONE_TAKEN", "เบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว");
        return ApiException.Conflict("DUPLICATE", "ข้อมูลซ้ำกับบัญชีที่มีอยู่แล้ว");
    }

    /// <summary>
    /// ผู้ดูแลระบบเห็นข้อมูลผู้ใช้ได้เท่าที่จำเป็นต่อการช่วยลูกค้า — ไม่มี passwordHash หลุดออกไปแม้แต่ในรูป hash
    /// bookingCount = จำนวนการจองของบัญชี หน้าผู้ใช้โชว์ และใช้ตัดสินว่าลบบัญชีได้ไหม
    /// </summary>
    private static IQueryable<AdminUserResponse> Shape(IQueryable<User> users) =>
        users.Select(u => new AdminUserResponse(u.Id, u.Email, u.Phone, u.Name, u.Role, u.CreatedAt, u.Bookings.Count));

    public async Task<PageResult<AdminUserResponse>> ListUsersAsync(string? q, Role? role, int? page, int? pageSize)
    {
        var where = db.Users.AsNoTracking();
        if (role is not null) where = where.Where(u => u.Role == role);
        if (!string.IsNullOrEmpty(q))
        {
            // ลูกค้าโทรเข้ามามักบอกแค่ชื่อหรือเบอร์ ค้นทีเดียวให้ครบทั้งสามช่องจะได้ไม่ต้องเดาว่าใช้อะไรสมัคร
            var pattern = Like.Contains(q);
            var phone = Phone.Normalize(q) is { Length: > 0 } normalized ? normalized : q;
            where = where.Where(u =>
                EF.Functions.ILike(u.Name, pattern, Like.Escape) ||
                EF.Functions.ILike(u.Email, pattern, Like.Escape) ||
                u.Phone.Contains(phone));
        }

        return await Pagination.FindPageAsync(
            where,
            query => query.OrderByDescending(u => u.CreatedAt).ThenByDescending(u => u.Id),
            u => new AdminUserResponse(u.Id, u.Email, u.Phone, u.Name, u.Role, u.CreatedAt, u.Bookings.Count),
            page,
            pageSize);
    }

    /// <summary>
    /// แก้ข้อมูลบัญชีแทนลูกค้า (เช่นกรอกอีเมลผิดตอนสมัครจนล็อกอินไม่ได้) และเปลี่ยนบทบาท
    ///
    /// ห้ามเปลี่ยนบทบาทของตัวเอง — ผู้ดูแลคนสุดท้ายจะได้ถอดสิทธิ์ตัวเองจนไม่มีใครเข้าหลังบ้านได้อีกไม่ได้
    /// ถ้าจะย้ายมือ ให้ตั้งคนใหม่เป็นผู้ดูแลก่อน แล้วให้คนนั้นเป็นคนถอดสิทธิ์ให้
    /// </summary>
    public async Task<AdminUserResponse> UpdateUserAsync(
        string userId, string actorId, string? name, string? email, string? phone, Role? role)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId) ?? throw UserNotFound();

        if (role is not null && role != user.Role && userId == actorId)
        {
            throw ApiException.BadRequest(
                "CANNOT_CHANGE_OWN_ROLE",
                "เปลี่ยนบทบาทของตัวเองไม่ได้ ต้องให้ผู้ดูแลอีกคนเป็นคนเปลี่ยนให้");
        }

        if (name is not null) user.Name = name.Trim();
        if (email is not null) user.Email = LoginIdentifier.NormalizeEmail(email);
        if (phone is not null) user.Phone = Phone.RequireThaiMobile(phone);
        if (role is not null) user.Role = role.Value;
        db.Entry(user).Property(u => u.UpdatedAt).CurrentValue = time.UtcNowMs();

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException error) when (ApiExceptionMiddleware.IsUniqueViolation(error, out var fields))
        {
            throw DuplicateFieldError(fields);
        }
        return await Shape(db.Users.AsNoTracking().Where(u => u.Id == userId)).FirstAsync();
    }

    /// <summary>
    /// ตั้งรหัสผ่านใหม่ให้ลูกค้าที่ลืมรหัส — ทางสำรองของกรณีที่ลูกค้าเข้าอีเมลตัวเองไม่ได้แล้ว
    /// ปกติลูกค้ากู้เองได้จากหน้า "ลืมรหัสผ่าน" ผู้ดูแลตั้งรหัสชั่วคราวแล้วแจ้งเจ้าของไปตั้งใหม่เอง
    ///
    /// ตั้งเสร็จเพิกถอนทุกเซสชันของบัญชีนั้น เผื่อกรณีที่ต้องรีเซ็ตเพราะบัญชีโดนยึด
    /// </summary>
    public async Task ResetUserPasswordAsync(string userId, string actorId, string newPassword)
    {
        if (userId == actorId)
        {
            throw ApiException.BadRequest(
                "USE_PROFILE_PAGE",
                "เปลี่ยนรหัสผ่านของตัวเองที่หน้าโปรไฟล์ เพราะต้องยืนยันรหัสผ่านเดิมก่อน");
        }

        if (!await db.Users.AnyAsync(u => u.Id == userId)) throw UserNotFound();

        var hash = passwords.Hash(newPassword);
        var now = time.UtcNowMs();
        await using var tx = await db.Database.BeginTransactionAsync();
        // access token ที่ค้างอยู่ในเครื่องคนที่ยึดบัญชีไปก็ใช้ไม่ได้ทันทีด้วย ไม่ใช่แค่ refresh token
        await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s
            .SetProperty(u => u.PasswordHash, hash)
            .SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1)
            .SetProperty(u => u.UpdatedAt, now));
        await AuthService.RevokeAllSessionsAsync(db, userId, now);
        await tx.CommitAsync();
    }

    /// <summary>
    /// ลบบัญชีได้เฉพาะที่ยังไม่เคยจอง
    ///
    /// Booking ผูกกับ User แบบ cascade ถ้าลบบัญชีที่มีประวัติ ยอดขายกับรายงานจะหายตามไปเงียบ ๆ
    /// บัญชีที่เคยใช้งานจริงจึงควรถอดสิทธิ์หรือแก้ข้อมูลแทนการลบ
    /// </summary>
    public async Task DeleteUserAsync(string userId, string actorId)
    {
        if (userId == actorId) throw ApiException.BadRequest("CANNOT_DELETE_SELF", "ลบบัญชีของตัวเองไม่ได้");

        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.Id, BookingCount = u.Bookings.Count })
            .FirstOrDefaultAsync() ?? throw UserNotFound();

        if (user.BookingCount > 0)
        {
            throw ApiException.Conflict(
                "USER_HAS_BOOKINGS",
                "บัญชีนี้มีประวัติการจองอยู่ ลบไม่ได้เพราะยอดขายในรายงานจะหายไปด้วย",
                new { bookingCount = user.BookingCount });
        }

        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }
}
