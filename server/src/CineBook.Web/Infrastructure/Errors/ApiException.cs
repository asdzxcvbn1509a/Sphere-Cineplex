namespace CineBook.Web.Infrastructure.Errors;

/// <summary>
/// Error ที่ตั้งใจส่งให้ client — ApiExceptionMiddleware แปลงเป็น JSON { error: { code, message, details } }
/// <c>Code</c> เป็นรหัสคงที่ให้ frontend เอาไปเลือกข้อความ i18n เอง
/// <c>Details</c> ใส่ข้อมูลเพิ่ม เช่น รายการที่นั่งที่ถูกจองตัดหน้า
/// </summary>
public sealed class ApiException(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;

    public static ApiException BadRequest(string code, string message, object? details = null) =>
        new(400, code, message, details);

    public static ApiException Unauthorized(string code = "UNAUTHORIZED", string message = "กรุณาเข้าสู่ระบบ") =>
        new(401, code, message);

    public static ApiException Forbidden(
        string code = "FORBIDDEN", string message = "ไม่มีสิทธิ์เข้าถึง", object? details = null) =>
        new(403, code, message, details);

    public static ApiException NotFound(string code = "NOT_FOUND", string message = "ไม่พบข้อมูลที่ต้องการ") =>
        new(404, code, message);

    public static ApiException Conflict(string code, string message, object? details = null) =>
        new(409, code, message, details);

    public static ApiException TooMany(
        string code = "TOO_MANY_REQUESTS", string message = "ทำรายการถี่เกินไป กรุณารอสักครู่") =>
        new(429, code, message);
}
