using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.RateLimiting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Helpers;

/// <summary>
/// แอปทั้งตัวในหน่วยความจำสำหรับเทสต์ (แทน createApp().listen(0) ของเดิม) — ใช้ฐาน _test และไม่เริ่มงานเบื้องหลัง
/// configure = ปรับค่าตั้งเฉพาะแอปตัวนี้ (เช่น เปิดบังคับ PROXY_SECRET แบบ createApp({ proxySecret }))
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly Func<AppConfig, AppConfig>? _configure;

    public ApiFactory() : this(null)
    {
    }

    protected ApiFactory(Func<AppConfig, AppConfig>? configure)
    {
        TestEnvironment.EnsureLoaded();
        _configure = configure;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Test");
        if (_configure is null) return;
        builder.ConfigureTestServices(services =>
        {
            var current = (AppConfig)services.Single(d => d.ServiceType == typeof(AppConfig)).ImplementationInstance!;
            services.AddSingleton(_configure(current));
        });
    }

    public AppDbContext NewDb(out IServiceScope scope)
    {
        scope = Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<AppDbContext>();
    }

    public T Service<T>(IServiceScope scope) where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

    public AppConfig Config => Services.GetRequiredService<AppConfig>();

    public void ResetRateLimits() => Services.GetRequiredService<RateLimitStore>().Reset();
}

/// <summary>แอปอีกตัวที่ปรับค่าตั้งเอง (เช่น PROXY_SECRET) — แยกจากแอปหลักที่ทุกคลาสใช้ร่วมกัน</summary>
public sealed class ConfiguredApiFactory(Func<AppConfig, AppConfig> configure) : ApiFactory(configure);

/// <summary>ฐานข้อมูลของเทสต์ — migrate ครั้งเดียวต่อการรัน แล้วล้างทุกตารางก่อนแต่ละเคส</summary>
public static class TestDatabase
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static bool _migrated;

    private static readonly string[] Tables =
    [
        "Notification",
        "Payment",
        "SeatChange",
        // ล้างตัวนับด้วย เลขที่ใบเสร็จของแต่ละเคสจะได้เริ่มที่ 000001 เสมอ ไม่ขึ้นกับลำดับการรัน
        "ReceiptCounter",
        "BookingSeat",
        "Booking",
        "ZonePrice",
        "Showtime",
        "Seat",
        "Theatre",
        "Movie",
        "PasswordResetToken",
        "RefreshToken",
        "User",
    ];

    public static async Task EnsureMigratedAsync(ApiFactory factory)
    {
        await Gate.WaitAsync();
        try
        {
            if (_migrated) return;
            using var scope = factory.Services.CreateScope();
            // สร้างฐาน (ถ้ายังไม่มี) และรัน migration ให้ล่าสุด
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
            _migrated = true;
        }
        finally
        {
            Gate.Release();
        }
    }

    public static async Task ResetAsync(ApiFactory factory)
    {
        await EnsureMigratedAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // ชื่อตารางมาจากรายการคงที่ในไฟล์นี้ ไม่ใช่ค่าจากภายนอก (ชื่อตารางส่งเป็นพารามิเตอร์ของ SQL ไม่ได้)
        var sql = "TRUNCATE TABLE " + string.Join(", ", Tables.Select(t => "\"" + t + "\"")) + " RESTART IDENTITY CASCADE";
        await db.Database.ExecuteSqlRawAsync(sql);
    }
}
