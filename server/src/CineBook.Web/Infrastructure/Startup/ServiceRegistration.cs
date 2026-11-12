using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Jobs;
using CineBook.Web.Services;

namespace CineBook.Web.Infrastructure.Startup;

/// <summary>service ของระบบ (port จาก services/*.js) — เพิ่มตามหมวดที่ย้ายเสร็จ</summary>
public static class ServiceRegistration
{
    public static IServiceCollection AddCineBookServices(this IServiceCollection services, AppConfig config)
    {
        services.AddScoped<AuthService>();
        services.AddScoped<UserService>();
        services.AddScoped<MovieService>();
        services.AddScoped<TheatreService>();
        services.AddScoped<ShowtimeService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<SlipService>();
        services.AddScoped<BookingService>();
        services.AddScoped<ReceiptService>();
        services.AddScoped<SeatChangeService>();
        services.AddScoped<PaymentService>();
        services.AddScoped<ReportService>();
        services.AddScoped<ShowtimeReminders>();

        // createApp() ของเดิมไม่เริ่ม jobs — เทสต์ปิดด้วย RUN_JOBS=false ให้ job ไม่ไปแตะแถวที่เทสต์กำลังตรวจ
        if (config.RunJobs) services.AddHostedService<BackgroundJobs>();
        return services;
    }
}
