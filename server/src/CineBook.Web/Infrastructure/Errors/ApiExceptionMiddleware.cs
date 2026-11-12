using CineBook.Web.Infrastructure.Config;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace CineBook.Web.Infrastructure.Errors;

/// <summary>
/// แปลง exception ทุกตัวเป็น JSON error แบบเดียวกับ middleware/errorHandler.js เดิม
/// - ApiException → ตามที่ service ตั้งใจส่ง
/// - ตรวจข้อมูลไม่ผ่าน → 422 VALIDATION_ERROR
/// - unique ชนกัน (23505) → 409 DUPLICATE · ที่นั่งชนกันจะถูกดักไว้ใน service ก่อนแล้ว
/// - deadlock (40P01) / serialization failure (40001) → 409 WRITE_CONFLICT
/// - อื่น ๆ → 500 INTERNAL_ERROR (log ไว้ และแนบ stack เฉพาะตอนพัฒนา)
/// </summary>
public sealed class ApiExceptionMiddleware(RequestDelegate next, AppConfig config, ILogger<ApiExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // ผู้ใช้ปิดหน้าไปก่อนได้คำตอบ — ไม่มีใครรอ response แล้ว และไม่ใช่ข้อผิดพลาดของระบบ
        }
        catch (Exception ex) when (!context.Response.HasStarted)
        {
            var error = Map(ex);
            string? stack = null;
            if (error.Status >= 500)
            {
                logger.LogError(ex, "[error] {Method} {Url}", context.Request.Method, context.Request.Path + context.Request.QueryString);
                if (config.IsDevelopment) stack = ex.ToString();
            }
            // ไม่ล้าง header ที่ตั้งไว้แล้ว (security headers, RateLimit ฯลฯ) — แบบเดียวกับ error ของ Express
            context.Response.Headers.ContentLength = null;
            await ApiErrorWriter.WriteAsync(context, error, stack);
        }
    }

    public static ApiException Map(Exception ex)
    {
        switch (ex)
        {
            case ApiException api:
                return api;
            case RequestValidationException validation:
                return validation.ToApiException();
            case BadHttpRequestException bad:
                return new ApiException(bad.StatusCode, "BAD_REQUEST", "คำขอไม่ถูกต้อง");
        }

        var pg = ex as PostgresException ?? ex.InnerException as PostgresException;
        if (pg is not null)
        {
            switch (pg.SqlState)
            {
                case PostgresErrorCodes.UniqueViolation:
                    return ApiException.Conflict(
                        "DUPLICATE",
                        "ข้อมูลซ้ำกับที่มีอยู่แล้ว",
                        new { target = UniqueTarget(pg.ConstraintName) });
                case PostgresErrorCodes.DeadlockDetected:
                case PostgresErrorCodes.SerializationFailure:
                    // สองรายการแก้ข้อมูลชุดเดียวกันพร้อมกันจน PostgreSQL ต้องยกเลิกฝั่งหนึ่ง — ไม่ใช่ระบบพัง
                    // ลองใหม่อีกครั้งก็ผ่าน (หรือได้ 409 ที่บอกว่าสถานะเปลี่ยนไปแล้ว) จึงไม่ควรตอบเป็น 500
                    return ApiException.Conflict("WRITE_CONFLICT", "มีการทำรายการเดียวกันพร้อมกัน กรุณาลองใหม่อีกครั้ง");
            }
        }

        if (ex is DbUpdateConcurrencyException)
        {
            return ApiException.NotFound();
        }

        return new ApiException(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ");
    }

    /// <summary>
    /// ชื่อฟิลด์ที่ชนกัน (เหมือน meta.target ของ Prisma) จากชื่อ unique index แบบ Prisma: Table_field1_field2_key
    /// </summary>
    public static string[] UniqueTarget(string? constraintName)
    {
        if (string.IsNullOrEmpty(constraintName) || !constraintName.EndsWith("_key", StringComparison.Ordinal)) return [];
        var parts = constraintName[..^4].Split('_');
        return parts.Length > 1 ? parts[1..] : [];
    }

    /// <summary>error นี้คือ unique ของคอลัมน์ใดคอลัมน์หนึ่งที่ระบุหรือไม่ (เช่น email / phone ตอนสมัคร)</summary>
    public static bool IsUniqueViolation(Exception ex, out string[] fields)
    {
        var pg = ex as PostgresException ?? ex.InnerException as PostgresException;
        if (pg?.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            fields = UniqueTarget(pg.ConstraintName);
            return true;
        }
        fields = [];
        return false;
    }

    public static bool IsConstraint(Exception ex, string constraintName)
    {
        var pg = ex as PostgresException ?? ex.InnerException as PostgresException;
        return pg?.SqlState == PostgresErrorCodes.UniqueViolation && pg.ConstraintName == constraintName;
    }
}
