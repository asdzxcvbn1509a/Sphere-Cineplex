using System.Reflection;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Email;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Infrastructure.RateLimiting;
using CineBook.Web.Infrastructure.Security;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Infrastructure.Validation;
using CineBook.Web.Utils;
using FluentValidation;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace CineBook.Web.Infrastructure.Startup;

/// <summary>ประกอบแอปทั้งหมด (แทน createApp() ใน app.js เดิม) — Program.cs เรียกต่อกันตามลำดับ</summary>
public static class CineBookSetup
{
    public const string CorsPolicy = "client";

    public static void ConfigureCineBookHost(this WebApplicationBuilder builder, AppConfig config)
    {
        // ระดับ log อยู่ในโค้ด ไม่ใช่ appsettings.json — รัน dll จากโฟลเดอร์อื่น (content root ไม่ใช่โฟลเดอร์ของแอป) ก็ได้ผลเหมือนกัน
        builder.Logging
            // หนึ่งเหตุการณ์ต่อบรรทัด — อ่านง่ายทั้งในเทอร์มินัลและ Log stream ของ App Service
            .AddSimpleConsole(options =>
            {
                options.SingleLine = true;
                options.TimestampFormat = "HH:mm:ss ";
            })
            .AddFilter("Microsoft.AspNetCore", LogLevel.Warning)
            .AddFilter("Microsoft.EntityFrameworkCore", LogLevel.Warning)
            // คำสั่งที่ล้มเพราะ unique (ที่นั่งชนกัน) เป็นเรื่องปกติที่แปลงเป็น 409 อยู่แล้ว — error จริงถูก log ที่ ApiExceptionMiddleware
            .AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.None)
            // token หมดอายุ/ผิดรูปเป็นเรื่องปกติของ client (ได้ 401 ตามรหัส) ไม่ใช่เหตุผิดปกติของเซิร์ฟเวอร์
            .AddFilter("CineBook.Web.Infrastructure.Auth.BearerAuthenticationHandler", LogLevel.Warning);

        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.AddServerHeader = false;
            // body ของ JSON ไม่เกิน 1 MB เหมือน express.json({ limit: '1mb' }) — endpoint อัปโหลดสลิปปลดเพดานนี้เอง
            kestrel.Limits.MaxRequestBodySize = 1024 * 1024;
        });

        // โฮสต์ที่กำหนดพอร์ตเอง (App Service ตั้ง ASPNETCORE_HTTP_PORTS, dotnet run ใช้ launchSettings) ชนะเสมอ
        // นอกนั้นฟัง PORT (ค่าเริ่มต้น 4000 ที่ Vite proxy /api ไปหา)
        var hostDecidesPort = new[] { "ASPNETCORE_URLS", "ASPNETCORE_HTTP_PORTS", "ASPNETCORE_HTTPS_PORTS", "URLS" }
            .Any(name => !string.IsNullOrEmpty(Environment.GetEnvironmentVariable(name)));
        if (!hostDecidesPort) builder.WebHost.UseUrls($"http://*:{config.Port}");
    }

    public static IServiceCollection AddCineBook(this IServiceCollection services, AppConfig config)
    {
        services.AddSingleton(config);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<TimestampInterceptor>();
        services.AddDbContext<AppDbContext>((sp, options) =>
            options.UseCineBookDatabase(config.ConnectionString, sp.GetRequiredService<TimestampInterceptor>()));

        services.AddSingleton<AccessTokens>();
        services.AddSingleton<PasswordHasher>();
        services.AddSingleton<RateLimitStore>();
        services.AddSingleton<IMailer, SmtpMailer>();
        services.AddSingleton<EmailQueue>();
        services.AddHostedService<EmailQueueSender>();
        if (config.IsBlobStorageConfigured) services.AddSingleton<ISlipStorage, AzureBlobSlipStorage>();
        else services.AddSingleton<ISlipStorage, DiskSlipStorage>();
        services.AddScoped<SlipUploadReader>();

        services.AddCineBookServices(config);
        AddValidators(services);

        services.AddAuthentication(BearerAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, BearerAuthenticationHandler>(BearerAuthenticationHandler.SchemeName, null);
        services.AddAuthorization();

        services.AddCors(options => options.AddPolicy(CorsPolicy, policy =>
            policy.WithOrigins(config.ClientOrigin)
                // จำเป็นสำหรับ refresh token cookie
                .AllowCredentials()
                .AllowAnyHeader()
                .WithMethods("GET", "HEAD", "PUT", "PATCH", "POST", "DELETE")));

        services.AddControllersWithViews(options =>
            {
                // หลัง rate limit เสมอ (Order −1000+) — คำขอที่ข้อมูลผิดก็ต้องถูกนับโควตาแบบลำดับ middleware เดิม
                options.Filters.Add<ValidationFilter>(100);
                // ทุกช่องตรวจผ่าน FluentValidation (ข้อความไทยแบบเดิม) ไม่ใช่กฎ "required" อัตโนมัติของ MVC
                options.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true;
                // body ว่างหรือไม่ใช่ JSON = {} แบบ validate() เดิม (req.body ?? {}) — ValidationFilter สร้างค่าว่างให้แล้วตรวจตามกฎ
                // ไม่งั้น MVC ตอบ 415 ตัวเปล่าก่อน rate limit และก่อนรูป error ของเรา
                options.AllowEmptyInputInBodyModelBinding = true;
                foreach (var filter in options.Filters.OfType<UnsupportedContentTypeFilter>().ToList()) options.Filters.Remove(filter);
                // Express อ่านแค่ JSON (ไม่มี urlencoded) และสลิปถูกอ่านแบบ stream ใน SlipUploadReader เอง
                // ถ้าปล่อยตัวอ่านฟอร์มของ MVC ไว้ มันอ่าน multipart ทั้งก้อน (รวมไฟล์) ตั้งแต่ตอน model binding
                // คือก่อน rate limit ของสลิป และตัวรับสลิปจะเจอ body ที่ถูกอ่านไปแล้ว
                options.ValueProviderFactories.RemoveType<FormValueProviderFactory>();
                options.ValueProviderFactories.RemoveType<FormFileValueProviderFactory>();
                options.ValueProviderFactories.RemoveType<JQueryFormValueProviderFactory>();
            })
            .ConfigureApiBehaviorOptions(options => options.SuppressModelStateInvalidFilter = true)
            .AddJsonOptions(options => JsonDefaults.Apply(options.JsonSerializerOptions));

        return services;
    }

    /// <summary>ลงทะเบียน validator ทุกตัวในโปรเจกต์ (IValidator&lt;T&gt;) — ValidationFilter หยิบไปใช้ตามชนิดของ body/query</summary>
    private static void AddValidators(IServiceCollection services)
    {
        var validators = Assembly.GetExecutingAssembly().GetTypes()
            .Where(type => type is { IsAbstract: false, IsGenericTypeDefinition: false })
            .SelectMany(type => type.GetInterfaces()
                .Where(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IValidator<>))
                .Select(i => (Service: i, Implementation: type)));
        foreach (var (service, implementation) in validators) services.AddSingleton(service, implementation);
    }

    public static WebApplication UseCineBookPipeline(this WebApplication app, AppConfig config)
    {
        // ไอพีของผู้ใช้ (กุญแจของ rate limit) ต้องได้ก่อนอย่างอื่นทั้งหมด
        app.UseTrustedForwardedHeaders(config);
        if (config.IsDevelopment) app.UseMiddleware<DevRequestLogMiddleware>();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.UseMiddleware<ApiExceptionMiddleware>();
        // ก่อน CORS และการอ่าน body — คำขอที่ไม่ได้มาทาง proxy ถูกปัดตกโดยไม่ต้องเสียแรง parse อะไรเลย
        app.UseMiddleware<ProxySecretMiddleware>();
        app.UseCors(CorsPolicy);

        // หน้าเว็บ React ที่ build แล้ว (wwwroot) — /assets/* มี hash ในชื่อไฟล์
        app.UseStaticFiles();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();

        app.MapControllers();
        // /api ที่ไม่มี route (รวม method ผิด) ตอบ JSON แบบเดิม ไม่ใช่หน้าเว็บ
        app.MapFallback("/api/{**path}", context => ApiErrorWriter.WriteAsync(
            context,
            ApiException.NotFound("ROUTE_NOT_FOUND", $"ไม่พบเส้นทาง {context.Request.Method} {context.Request.Path}{context.Request.QueryString}")));
        // ทุก path อื่นเป็นของหน้าเว็บ React — คืน index.html ให้ deep link และการรีเฟรชหน้าใช้ได้
        app.MapFallbackToController("Index", "Home");
        return app;
    }
}

/// <summary>บรรทัดเปิดเครื่อง และคำเตือนการตั้งค่าที่ไม่ควรขึ้นระบบจริง (แบบ index.js เดิม)</summary>
public static class StartupBanner
{
    public static void Print(IServiceProvider services, AppConfig config)
    {
        var storage = services.GetRequiredService<ISlipStorage>();
        Console.WriteLine($"\n🎬  Theatre Reservation API");
        // ที่อยู่ที่ฟังจริง (ASPNETCORE_URLS / ASPNETCORE_HTTP_PORTS ของโฮสต์ชนะ PORT) แสดงเป็น localhost ให้กดเปิดได้
        var address = services.GetService<IServer>()?.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault()
            ?? $"http://localhost:{config.Port}";
        foreach (var wildcard in new[] { "://*", "://+", "://[::]", "://0.0.0.0" }) address = address.Replace(wildcard, "://localhost");
        Console.WriteLine($"    {address}/api/health  ({config.EnvironmentName})");
        Console.WriteLine($"    อนุญาต origin: {config.ClientOrigin}");
        Console.WriteLine($"    ที่เก็บสลิป: {storage.Description}\n");

        if (!config.IsProduction) return;
        if (!storage.IsPersistentInProduction)
        {
            // โฮสต์ส่วนใหญ่ล้างดิสก์ทุกครั้งที่ deploy/restart — DB ยังอ้างถึงสลิปแต่ไฟล์หายไปแล้ว
            Console.Error.WriteLine(
                "⚠️  ยังเก็บสลิปลงดิสก์ ถ้าโฮสต์นี้ไม่มีดิสก์ถาวร สลิปจะหายทุกครั้งที่ deploy หรือ restart\n" +
                "    ตั้ง AZURE_STORAGE_CONNECTION_STRING เพื่อเก็บบน Azure Blob Storage แทน\n");
        }
        if (!config.IsMailConfigured)
        {
            // production ไม่พิมพ์เนื้อเมลลง log — ไม่ตั้ง SMTP = ลิงก์ลืมรหัสผ่านและใบเสร็จไม่ถึงใครเลย
            Console.Error.WriteLine(
                "⚠️  ยังไม่ได้ตั้ง SMTP_HOST — อีเมลลืมรหัสผ่านและใบเสร็จจะไม่ถูกส่ง\n" +
                "    ลูกค้าที่ลืมรหัสผ่านต้องให้ผู้ดูแลตั้งรหัสชั่วคราวให้ที่หน้าจัดการผู้ใช้\n");
        }
        if (config.PromptPayId == AppConfig.SamplePromptPayId)
        {
            // เตือนแต่ไม่หยุดระบบ — เว็บเดโมอาจตั้งใจใช้เลขตัวอย่าง ไม่ให้มีใครโอนเงินจริง
            Console.Error.WriteLine(
                $"⚠️  PROMPTPAY_ID ยังเป็นเลขตัวอย่าง {AppConfig.SamplePromptPayId} — ถ้าเปิดขายจริง ลูกค้าที่สแกน QR จะโอนเงินเข้าเลขนี้\n");
        }
        if (Environment.GetEnvironmentVariable("ASPNETCORE_FORWARDEDHEADERS_ENABLED") is "true" or "True")
        {
            // ASP.NET Core จะอ่าน X-Forwarded-For ซ้ำอีกรอบ ไอพีที่ได้ผิดจาก TRUST_PROXY — ตั้งเป็น false ใน App Settings
            Console.Error.WriteLine("⚠️  ASPNETCORE_FORWARDEDHEADERS_ENABLED=true ทำให้ไอพีถูกอ่านซ้ำ — ตั้งเป็น false แล้วใช้ TRUST_PROXY แทน\n");
        }
    }
}
