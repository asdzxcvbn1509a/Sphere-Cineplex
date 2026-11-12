using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Utils;

namespace CineBook.Tests.Helpers;

/// <summary>
/// โหลด server/.env.test เข้า environment ของ process เทสต์ (ไฟล์เดียว ไม่เติมค่าจาก .env ของเครื่อง)
/// แล้วตรวจด่านกันพัง — เทสต์ล้างทุกตารางก่อนแต่ละเคส ถ้าเผลอชี้ไปฐาน dev ข้อมูลจริงหายหมด
/// และถ้า SMTP ถูกตั้งไว้ เทสต์ลืมรหัสผ่าน/อนุมัติสลิปจะส่งอีเมลจริงออกไป
/// </summary>
public static class TestEnvironment
{
    private static readonly Lock Gate = new();
    private static bool _loaded;

    public static string ServerRoot { get; } = AppConfigLoader.FindServerRoot();

    public static void EnsureLoaded()
    {
        lock (Gate)
        {
            if (_loaded) return;
            var path = Path.Combine(ServerRoot, ".env.test");
            if (!File.Exists(path))
            {
                throw new InvalidOperationException("ไม่พบ server/.env.test — คัดลอกจาก .env.test.example แล้วแก้ <PASSWORD> ให้ตรงกับ PostgreSQL บนเครื่อง");
            }

            foreach (var (key, value) in DotNetEnv.Env.NoEnvVars().Load(path))
            {
                // ค่าว่างในไฟล์ = "ไม่ตั้ง" และต้องทับค่าที่อาจค้างอยู่ใน environment ของเครื่องด้วย
                Environment.SetEnvironmentVariable(key, string.IsNullOrEmpty(value) ? null : value);
            }
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Test");
            Environment.SetEnvironmentVariable("CINEBOOK_SKIP_DOTENV", "true");
            AssertSafe();
            _loaded = true;
        }
    }

    private static void AssertSafe()
    {
        var url = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "";
        var dbName = DatabaseUrl.DatabaseName(url);
        if (!dbName.EndsWith("_test", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"integration test ต้องรันกับฐานข้อมูลที่ชื่อลงท้ายด้วย _test เท่านั้น (ตอนนี้คือ \"{dbName}\") — ตรวจ server/.env.test");
        }
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SMTP_HOST")))
        {
            throw new InvalidOperationException("SMTP_HOST ถูกตั้งไว้ระหว่างเทสต์ — ใส่ SMTP_HOST= (ว่าง) ใน server/.env.test");
        }
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AZURE_STORAGE_CONNECTION_STRING")))
        {
            throw new InvalidOperationException("AZURE_STORAGE_CONNECTION_STRING ถูกตั้งไว้ระหว่างเทสต์ — เทสต์ต้องเก็บสลิปลงดิสก์เท่านั้น");
        }
    }
}
