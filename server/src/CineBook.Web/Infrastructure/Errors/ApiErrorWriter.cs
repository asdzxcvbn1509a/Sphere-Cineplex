using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Web.Infrastructure.Json;

namespace CineBook.Web.Infrastructure.Errors;

/// <summary>หนึ่งช่องที่ไม่ผ่านการตรวจ — details ของ 422 VALIDATION_ERROR (หน้าสมัคร/แก้ผู้ใช้เอาไปแสดงใต้ช่อง)</summary>
public sealed record FieldError(string Field, string Message);

/// <summary>422 VALIDATION_ERROR — body หรือ query ไม่ผ่านการตรวจ</summary>
public sealed class RequestValidationException(IReadOnlyList<FieldError> errors) : Exception("ข้อมูลที่ส่งมาไม่ถูกต้อง")
{
    public IReadOnlyList<FieldError> Errors { get; } = errors;

    public ApiException ToApiException() => new(422, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", Errors);
}

/// <summary>
/// เขียน error ในรูปเดียวทั้งระบบ: { error: { code, message, details? } } (+ stack เฉพาะตอนพัฒนาและเป็น 5xx)
/// code คือสัญญาที่หน้าเว็บพึ่ง ส่วน message เป็นภาษาไทยที่หน้าเว็บแสดงตรง ๆ
/// </summary>
public static class ApiErrorWriter
{
    public static Task WriteAsync(HttpContext context, ApiException error, string? stack = null)
    {
        var body = new JsonObject
        {
            ["code"] = error.Code,
            ["message"] = error.Message,
        };
        if (error.Details is not null) body["details"] = JsonSerializer.SerializeToNode(error.Details, JsonDefaults.Api);
        if (stack is not null) body["stack"] = stack;

        context.Response.StatusCode = error.Status;
        context.Response.ContentType = "application/json; charset=utf-8";
        return context.Response.WriteAsync(new JsonObject { ["error"] = body }.ToJsonString(JsonDefaults.Api));
    }
}
