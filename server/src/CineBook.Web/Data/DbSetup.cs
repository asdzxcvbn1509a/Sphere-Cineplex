using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql.NameTranslation;

namespace CineBook.Web.Data;

public static class DbSetup
{
    /// <summary>
    /// ต่อ PostgreSQL พร้อม map enum ของ C# เข้ากับ enum type เดิมในฐาน (ชื่อ type และ label ตรงตัว ไม่แปลงเป็น snake_case)
    /// </summary>
    // ใช้ตัวเดียวกันทุก DbContext — EF เทียบการตั้งค่าเพื่อใช้ internal service provider ร่วมกัน
    // ถ้าสร้าง translator/interceptor ใหม่ทุกครั้ง EF จะสร้าง service provider ใหม่ทุกคำขอ (ช้าและกินหน่วยความจำ)
    private static readonly NpgsqlNullNameTranslator Translator = new();

    public static DbContextOptionsBuilder UseCineBookDatabase(
        this DbContextOptionsBuilder options, string connectionString, TimestampInterceptor interceptor)
    {
        var translator = Translator;
        options.UseNpgsql(connectionString, npgsql =>
        {
            npgsql.MapEnum<Role>("Role", nameTranslator: translator);
            npgsql.MapEnum<MovieStatus>("MovieStatus", nameTranslator: translator);
            npgsql.MapEnum<SeatZone>("SeatZone", nameTranslator: translator);
            npgsql.MapEnum<ShowtimeStatus>("ShowtimeStatus", nameTranslator: translator);
            npgsql.MapEnum<BookingStatus>("BookingStatus", nameTranslator: translator);
            npgsql.MapEnum<PaymentStatus>("PaymentStatus", nameTranslator: translator);
            npgsql.MapEnum<PaymentKind>("PaymentKind", nameTranslator: translator);
            npgsql.MapEnum<SeatChangeStatus>("SeatChangeStatus", nameTranslator: translator);
            npgsql.MapEnum<NotificationType>("NotificationType", nameTranslator: translator);
            npgsql.MigrationsHistoryTable("__EFMigrationsHistory");
            // คำสั่งเดียวเป็นค่าเริ่มต้น (แบบ join ของ Prisma) — query ที่ include หลาย collection เลือก AsSplitQuery เองเป็นรายตัว
            npgsql.UseQuerySplittingBehavior(QuerySplittingBehavior.SingleQuery);
        });
        options.AddInterceptors(interceptor);
        return options;
    }
}

/// <summary>
/// เติม createdAt / updatedAt แบบที่ Prisma ทำให้ (@default(now()) และ @updatedAt)
/// ค่าที่โค้ดตั้งเองชนะเสมอ (seed ย้อนเวลาสร้างแถวได้) — เติมเฉพาะที่ยังว่างหรือยังไม่ได้แก้
/// หมายเหตุ: ExecuteUpdateAsync ไม่ผ่านตัวดักนี้ ทุกจุดที่ใช้ต้องตั้ง UpdatedAt เอง (แบบที่ updateMany ของ Prisma ทำให้)
/// </summary>
public sealed class TimestampInterceptor(TimeProvider time) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Stamp(eventData.Context);
        return ValueTask.FromResult(result);
    }

    private void Stamp(DbContext? context)
    {
        if (context is null) return;
        var now = time.UtcNowMs();
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Entity is ICreatedAt created && created.CreatedAt == default) created.CreatedAt = now;
                if (entry.Entity is ITimestamped added && added.UpdatedAt == default) added.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified && entry.Entity is ITimestamped modified &&
                !entry.Property(nameof(ITimestamped.UpdatedAt)).IsModified)
            {
                modified.UpdatedAt = now;
            }
        }
    }
}

/// <summary>ให้คำสั่ง dotnet ef (migrations add / script) สร้าง DbContext ได้โดยไม่ต้องเปิดทั้งแอป</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var serverRoot = AppConfigLoader.FindServerRoot();
        AppConfigLoader.LoadDotEnv(serverRoot);
        var url = Environment.GetEnvironmentVariable("DATABASE_URL");
        var connectionString = string.IsNullOrWhiteSpace(url)
            ? "Host=localhost;Database=cinebook_design"
            : Utils.DatabaseUrl.ToNpgsql(url);
        var options = new DbContextOptionsBuilder<AppDbContext>();
        options.UseCineBookDatabase(connectionString, new TimestampInterceptor(TimeProvider.System));
        return new AppDbContext(options.Options);
    }
}
