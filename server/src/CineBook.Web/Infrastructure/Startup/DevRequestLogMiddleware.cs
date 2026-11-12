using System.Diagnostics;

namespace CineBook.Web.Infrastructure.Startup;

/// <summary>
/// บรรทัดเดียวต่อคำขอตอนพัฒนา (แทน morgan('dev')) — method path status เวลา
/// วางนอกสุดของ pipeline จึงได้ status จริงหลัง ApiExceptionMiddleware แปลง error แล้ว · ไม่บันทึก header/body ที่อาจมี token
/// </summary>
public sealed class DevRequestLogMiddleware(RequestDelegate next, ILogger<DevRequestLogMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var started = Stopwatch.GetTimestamp();
        await next(context);
        logger.LogInformation(
            "{Method} {Path} {StatusCode} {Elapsed:0.0} ms",
            context.Request.Method,
            context.Request.Path + context.Request.QueryString,
            context.Response.StatusCode,
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }
}
