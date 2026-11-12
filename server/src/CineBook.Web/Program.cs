using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Startup;
using Microsoft.EntityFrameworkCore;

// โฟลเดอร์ server/ (มี .env) — โหลด .env ก่อนสร้าง host เพราะ ASPNETCORE_ENVIRONMENT ในนั้นมีผลกับการตั้งค่าของ ASP.NET Core
// ค่าที่ตั้งไว้แล้ว (shell, App Settings ของ Azure, .env.test ของเทสต์) ชนะค่าในไฟล์เสมอ
// ตัวเลข/วันที่ในข้อความ (แจ้งเตือน อีเมล CSV) ต้องไม่ขึ้นกับภาษาของเครื่องที่รัน — ข้อความภาษาไทยเขียนเองทั้งหมดอยู่แล้ว
System.Globalization.CultureInfo.DefaultThreadCurrentCulture = System.Globalization.CultureInfo.InvariantCulture;
System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = System.Globalization.CultureInfo.InvariantCulture;
// ข้อความภาษาไทยของบรรทัดเปิดเครื่องและ seed — console ของ Windows ไม่ได้เป็น UTF-8 เป็นค่าเริ่มต้น
Console.OutputEncoding = System.Text.Encoding.UTF8;

var serverRoot = AppConfigLoader.FindServerRoot();
// เทสต์โหลด .env.test ไว้ให้แล้วและห้ามเติมค่าจาก .env ของเครื่อง (เช่น SMTP จริง) — จึงข้ามขั้นนี้
if (Environment.GetEnvironmentVariable("CINEBOOK_SKIP_DOTENV") != "true") AppConfigLoader.LoadDotEnv(serverRoot);

var builder = WebApplication.CreateBuilder(args);
var config = AppConfigLoader.LoadOrExit(builder.Environment.EnvironmentName, serverRoot);

builder.ConfigureCineBookHost(config);
builder.Services.AddCineBook(config);

var app = builder.Build();
app.UseCineBookPipeline(config);

if (args.Contains("seed"))
{
    // dotnet run -- seed : ล้างฐานแล้วสร้างข้อมูลตัวอย่าง (ดู Seed/SeedRunner) — ไม่เปิดเซิร์ฟเวอร์
    await CineBook.Web.Seed.SeedRunner.RunAsync(app.Services);
    return;
}

if (config.DbMigrateOnStart)
{
    // แทน prisma migrate deploy ตอน build ของ Render — รันเฉพาะ migration ที่ยังไม่เคยรัน จึงปลอดภัยที่จะรันทุกครั้งที่เปิดเครื่อง
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

app.Lifetime.ApplicationStarted.Register(() => StartupBanner.Print(app.Services, config));
await app.RunAsync();

/// <summary>ให้ WebApplicationFactory ของเทสต์อ้างถึงได้</summary>
public partial class Program;
