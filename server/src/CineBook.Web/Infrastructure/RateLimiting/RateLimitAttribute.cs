using System.Globalization;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace CineBook.Web.Infrastructure.RateLimiting;

/// <summary>
/// ติดโควตาให้ action — ใส่ได้หลายตัว ทำงานตามลำดับที่ประกาศ (Order) และก่อนการตรวจข้อมูลเสมอ
/// เหมือนลำดับ middleware เดิม: authenticate → limiter → validate → controller
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
public sealed class RateLimitAttribute(string policy) : Attribute, IFilterFactory, IOrderedFilter
{
    /// <summary>ลำดับระหว่างโควตาหลายตัวบน action เดียวกัน (น้อยทำก่อน)</summary>
    public int Sequence { get; init; }

    /// <summary>ก่อน ValidationFilter (Order 100) และ filter อื่นทั้งหมดเสมอ — MVC เรียงตามค่านี้</summary>
    public int Order => -1000 + Sequence;

    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        new RateLimitFilter(
            RateLimitPolicies.All[policy],
            serviceProvider.GetRequiredService<RateLimitStore>(),
            serviceProvider.GetRequiredService<AppConfig>(),
            serviceProvider.GetRequiredService<TimeProvider>(),
            Order);
}

/// <summary>
/// นับคำขอแบบ express-rate-limit: บวกหนึ่งก่อน → ใส่ header RateLimit / RateLimit-Policy (IETF draft 7)
/// → เกินโควตาตอบ 429 พร้อม Retry-After → ไม่เกินก็ทำงานต่อ แล้วคืนค่าทีหลังตามผลของคำขอ (skip)
/// </summary>
public sealed class RateLimitFilter(
    RateLimitPolicy policy,
    RateLimitStore store,
    AppConfig config,
    TimeProvider time,
    int order) : IAsyncActionFilter, IOrderedFilter
{
    public int Order { get; } = order;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var limit = policy.Limit(config);
        var window = policy.Window(config);
        var key = $"{policy.Name}:{policy.Key(new RateLimitRequest(http, context.ActionArguments))}";
        var hit = store.Increment(key, window);

        var remaining = Math.Max(limit - hit.TotalHits, 0);
        var resetSeconds = Math.Max(0, (long)Math.Ceiling((hit.ResetTime - time.GetUtcNow()).TotalSeconds));
        var windowSeconds = (long)Math.Ceiling(window.TotalSeconds);
        http.Response.Headers["RateLimit-Policy"] = $"{limit};w={windowSeconds}";
        http.Response.Headers["RateLimit"] = $"limit={limit}, remaining={remaining}, reset={resetSeconds}";

        if (policy.Skip != RateLimitSkip.None)
        {
            // คืนค่าตามผลจริงตอนเริ่มส่งคำตอบ (status สุดท้ายแล้ว และก่อนผู้เรียกจะได้คำตอบ จึงไม่ชนกับคำขอถัดไป)
            // 429 ของตัวเองก็นับเป็นคำขอที่ไม่สำเร็จ (แบบเดียวกับของเดิม)
            http.Response.OnStarting(() =>
            {
                var success = http.Response.StatusCode < 400;
                if ((policy.Skip == RateLimitSkip.SuccessfulRequests && success) ||
                    (policy.Skip == RateLimitSkip.FailedRequests && !success))
                {
                    store.Decrement(key, hit.ResetTime);
                }
                return Task.CompletedTask;
            });
        }

        if (hit.TotalHits > limit)
        {
            http.Response.Headers.RetryAfter = resetSeconds.ToString(CultureInfo.InvariantCulture);
            context.Result = new ObjectResult(new { error = new { code = policy.Code, message = policy.Message } })
            {
                StatusCode = StatusCodes.Status429TooManyRequests,
            };
            return;
        }

        await next();
    }
}
