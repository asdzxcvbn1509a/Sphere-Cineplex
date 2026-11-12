using CineBook.Web.Services;

namespace CineBook.Web.Jobs;

/// <summary>
/// งานเบื้องหลังสามตัว (port จาก jobs/index.js) — ปิดได้ด้วย RUN_JOBS=false (เทสต์ และเครื่องที่ไม่ควรแตะข้อมูลจริง)
/// แต่ละงานรันรอบแรกทันที แล้วทุก interval · รอบไม่ซ้อนกัน · error ไม่ทำให้งานหยุด แค่ลง log แล้วรอรอบถัดไป
/// ทุกรอบเปิด scope ใหม่ (DbContext ใหม่) — DbContext ไม่ควรอยู่ยาวข้ามรอบ
/// </summary>
public sealed class BackgroundJobs(IServiceScopeFactory scopes, ILogger<BackgroundJobs> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(
            RunAsync(
                "ปล่อยที่นั่งที่หมดเวลาชำระเงิน",
                services => services.GetRequiredService<BookingService>().ReleaseExpiredHoldsAsync(),
                TimeSpan.FromSeconds(30),
                stoppingToken),
            RunAsync(
                "ปล่อยที่นั่งของคำขอเปลี่ยนที่นั่งที่ไม่ได้โอนส่วนต่าง",
                services => services.GetRequiredService<SeatChangeService>().ReleaseExpiredAsync(),
                TimeSpan.FromSeconds(30),
                stoppingToken),
            RunAsync(
                "แจ้งเตือนก่อนรอบฉาย",
                services => services.GetRequiredService<ShowtimeReminders>().SendAsync(),
                TimeSpan.FromSeconds(60),
                stoppingToken));

    private async Task RunAsync(string name, Func<IServiceProvider, Task<int>> task, TimeSpan interval, CancellationToken ct)
    {
        // ไม่ให้งานแรกบล็อกการเปิดเครื่อง (ExecuteAsync ต้องคืน Task กลับไปก่อนที่ host จะเริ่มรับคำขอ)
        await Task.Yield();
        using var timer = new PeriodicTimer(interval);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var count = await task(scope.ServiceProvider);
                if (count > 0) logger.LogInformation("[job] {Name}: {Count} รายการ", name, count);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogError("[job] {Name} ล้มเหลว: {Message}", name, ex.Message);
            }
        }
        while (await WaitAsync(timer, ct));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
