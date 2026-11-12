using System.Globalization;
using CineBook.Web.Utils;

namespace CineBook.Web.Infrastructure.Config;

/// <summary>
/// อ่าน environment แล้วตรวจครบทุกตัวตอนเปิดเครื่อง (แทน zod schema ใน config/env.js เดิม)
/// ค่าผิดแม้แต่ตัวเดียว = พิมพ์ทุกตัวที่ผิดเป็นภาษาไทยแล้วหยุด process — ดีกว่าเปิดขึ้นแล้วไปพังกลางคำขอของลูกค้า
/// </summary>
public static class AppConfigLoader
{
    /// <summary>
    /// โหลด server/.env (ถ้ามี) เข้า environment โดยไม่ทับค่าที่ตั้งไว้แล้ว — ค่าจาก shell / App Settings / .env.test ชนะเสมอ
    /// ต้องเรียกก่อนสร้าง host เพราะ ASPNETCORE_ENVIRONMENT ใน .env มีผลกับการตั้งค่าของ ASP.NET Core ด้วย
    /// </summary>
    public static void LoadDotEnv(string serverRoot, string fileName = ".env")
    {
        var path = Path.Combine(serverRoot, fileName);
        if (File.Exists(path)) DotNetEnv.Env.NoClobber().Load(path);
    }

    /// <summary>
    /// โฟลเดอร์ server/ — ตอนพัฒนาคือโฟลเดอร์ที่มี CineBook.slnx (แอปรันจาก src/CineBook.Web หรือ bin/)
    /// ตอน deploy ไม่มีไฟล์นี้ จึงใช้โฟลเดอร์ของแอปที่ publish แทน
    /// </summary>
    public static string FindServerRoot()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "CineBook.slnx"))) return dir.FullName;
            }
        }
        return AppContext.BaseDirectory;
    }

    /// <summary>ตรวจแล้วคืนค่าตั้ง หรือพิมพ์ข้อผิดพลาดแล้ว exit(1) แบบเดียวกับเดิม</summary>
    public static AppConfig LoadOrExit(string environmentName, string serverRoot)
    {
        var (config, errors) = Load(Environment.GetEnvironmentVariables(), environmentName, serverRoot);
        if (config is not null) return config;

        Console.Error.WriteLine($"\n❌ ตั้งค่า environment ไม่ถูกต้อง (server/.env)\n{string.Join('\n', errors.Select(e => $"  - {e}"))}\n");
        Console.Error.WriteLine("   คัดลอกจาก server/.env.example แล้วแก้ค่าให้ครบก่อนรันใหม่\n");
        Environment.Exit(1);
        return null!;
    }

    /// <summary>ตรวจค่าจากชุดตัวแปรที่ส่งมา (เทสต์เรียกตรงได้) — คืน config หรือรายการข้อผิดพลาดแบบ "ชื่อตัวแปร: ข้อความ"</summary>
    public static (AppConfig? Config, List<string> Errors) Load(
        System.Collections.IDictionary variables, string environmentName, string serverRoot)
    {
        var reader = new EnvReader(variables);
        var isProduction = environmentName.Equals("Production", StringComparison.OrdinalIgnoreCase);

        var databaseUrl = reader.Required("DATABASE_URL", "ต้องกำหนด DATABASE_URL ใน server/.env");
        string? connectionString = null;
        if (databaseUrl is not null)
        {
            try
            {
                connectionString = Utils.DatabaseUrl.ToNpgsql(databaseUrl);
            }
            catch (Exception ex) when (ex is FormatException or ArgumentException or UriFormatException)
            {
                // รหัสผ่านที่ Azure บังคับให้มีอักขระพิเศษคือสาเหตุที่เจอบ่อยสุด — ในรูปแบบ URI ตัว @ / ? # ทำให้แยก host ผิด
                // ข้อความจาก .NET ("hostname could not be parsed") ไม่บอกเรื่องนี้ จึงต่อท้ายวิธีแก้ไว้ให้เห็นใน Log stream เลย
                var hint = databaseUrl.Contains("://", StringComparison.Ordinal)
                    ? " — ถ้ารหัสผ่านมี @ : / ? # % ต้องเข้ารหัสแบบ URL ก่อน (เช่น @ → %40, # → %23) หรือใช้รูปแบบ Host=…;Database=…;Username=…;Password=…"
                    : "";
                reader.Fail("DATABASE_URL", $"อ่าน connection string ไม่ได้ ({ex.Message}){hint}");
            }
        }

        var accessSecret = reader.Required("JWT_ACCESS_SECRET", "ต้องกำหนด JWT_ACCESS_SECRET ใน server/.env");
        if (accessSecret is not null && accessSecret.Length < 16) reader.Fail("JWT_ACCESS_SECRET", "JWT_ACCESS_SECRET สั้นเกินไป");
        var refreshSecret = reader.Required("JWT_REFRESH_SECRET", "ต้องกำหนด JWT_REFRESH_SECRET ใน server/.env");
        if (refreshSecret is not null && refreshSecret.Length < 16) reader.Fail("JWT_REFRESH_SECRET", "JWT_REFRESH_SECRET สั้นเกินไป");
        if (isProduction)
        {
            // JWT secret ที่ยังเป็นค่าตัวอย่างจาก .env.example — ใครเปิด repo ก็เห็น ถ้าหลุดไปถึง production ใครก็เซ็น token ปลอมได้
            foreach (var (key, value) in new[] { ("JWT_ACCESS_SECRET", accessSecret), ("JWT_REFRESH_SECRET", refreshSecret) })
            {
                if (IsSampleSecret(value)) reader.Fail(key, "ยังเป็นค่าตัวอย่างจาก .env.example — สร้างค่าสุ่มใหม่ก่อนขึ้นระบบจริง");
            }
        }

        var accessTtl = reader.String("ACCESS_TOKEN_TTL") ?? "15m";
        var accessLifetime = Duration.ParseMilliseconds(accessTtl);
        if (accessLifetime is null or <= 0) reader.Fail("ACCESS_TOKEN_TTL", "ต้องเป็นช่วงเวลา เช่น 15m, 1h");

        var smtpSecureRaw = reader.String("SMTP_SECURE");
        if (smtpSecureRaw is not null and not ("true" or "false")) reader.Fail("SMTP_SECURE", "ต้องเป็น true หรือ false");
        var smtpPort = reader.PositiveInt("SMTP_PORT", 587);

        var promptPayId = reader.String("PROMPTPAY_ID") ?? AppConfig.SamplePromptPayId;
        if (promptPayId.Length < 8) reader.Fail("PROMPTPAY_ID", "PROMPTPAY_ID ต้องยาวอย่างน้อย 8 ตัวอักษร");

        var issuerName = reader.String("RECEIPT_ISSUER_NAME", trim: true) ?? "Sphere Cineplex";

        var proxySecret = reader.String("PROXY_SECRET", trim: true);
        if (proxySecret is not null && proxySecret.Length < 32) reader.Fail("PROXY_SECRET", "PROXY_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร");

        var trustProxy = reader.String("TRUST_PROXY") ?? "loopback";
        if (!Utils.TrustProxy.TryValidate(trustProxy, out var trustError)) reader.Fail("TRUST_PROXY", $"อ่านค่าไม่ได้ ({trustError})");

        var clientOrigin = reader.String("CLIENT_ORIGIN") ?? "http://localhost:5173";
        var appUrl = (reader.String("APP_URL") ?? clientOrigin).TrimEnd('/');

        var maxSlip = reader.PositiveDouble("MAX_SLIP_SIZE_MB", 5);

        var config = new AppConfig
        {
            DatabaseUrl = databaseUrl ?? "",
            ConnectionString = connectionString ?? "",
            Port = reader.PositiveInt("PORT", 4000),
            EnvironmentName = environmentName,
            ClientOrigin = clientOrigin,
            JwtAccessSecret = accessSecret ?? "",
            JwtRefreshSecret = refreshSecret ?? "",
            AccessTokenTtl = accessTtl,
            AccessTokenLifetimeMs = accessLifetime ?? 0,
            RefreshTokenTtlDays = reader.PositiveInt("REFRESH_TOKEN_TTL_DAYS", 7),
            BcryptRounds = reader.IntInRange("BCRYPT_ROUNDS", 10, 8, 15),
            LoginLimit = reader.PositiveInt("LOGIN_LIMIT", 10),
            LoginWindowMinutes = reader.PositiveInt("LOGIN_WINDOW_MINUTES", 15),
            RegisterLimit = reader.PositiveInt("REGISTER_LIMIT", 50),
            RegisterWindowMinutes = reader.PositiveInt("REGISTER_WINDOW_MINUTES", 60),
            PasswordResetTtlMinutes = reader.PositiveInt("PASSWORD_RESET_TTL_MINUTES", 30),
            PasswordResetLimit = reader.PositiveInt("PASSWORD_RESET_LIMIT", 5),
            PasswordResetWindowMinutes = reader.PositiveInt("PASSWORD_RESET_WINDOW_MINUTES", 60),
            SeatHoldMinutes = reader.PositiveInt("SEAT_HOLD_MINUTES", 10),
            RejectedRetryMinutes = reader.PositiveInt("REJECTED_RETRY_MINUTES", 10),
            CancelCutoffHours = reader.NonNegativeInt("CANCEL_CUTOFF_HOURS", 3),
            MaxSeatsPerBooking = reader.PositiveInt("MAX_SEATS_PER_BOOKING", 8),
            MaxPendingBookingsPerUser = reader.PositiveInt("MAX_PENDING_BOOKINGS_PER_USER", 3),
            SeatChangeCutoffMinutes = reader.NonNegativeInt("SEAT_CHANGE_CUTOFF_MINUTES", 30),
            MaxSeatChangesPerBooking = reader.PositiveInt("MAX_SEAT_CHANGES_PER_BOOKING", 1),
            PromptPayId = promptPayId,
            PromptPayMerchantName = reader.String("PROMPTPAY_MERCHANT_NAME") ?? "THEATRE RESERVATION",
            ReceiptIssuerName = issuerName,
            ReceiptIssuerAddress = reader.String("RECEIPT_ISSUER_ADDRESS", trim: true),
            SmtpHost = reader.String("SMTP_HOST", trim: true),
            SmtpPort = smtpPort,
            // ไม่ใช้การแปลงสตริงเป็น boolean แบบหลวม ๆ — สตริง 'false' ต้องได้ false จริง ไม่ใช่ true เพราะไม่ว่าง
            SmtpSecure = smtpSecureRaw is null ? smtpPort == 465 : smtpSecureRaw == "true",
            SmtpUser = reader.String("SMTP_USER"),
            SmtpPass = reader.String("SMTP_PASS"),
            MailFrom = reader.String("MAIL_FROM") ?? "Theatre Reservation <no-reply@localhost>",
            AppUrl = appUrl,
            UploadDir = reader.String("UPLOAD_DIR") ?? "uploads",
            MaxSlipSizeMb = maxSlip,
            AzureStorageConnectionString = reader.String("AZURE_STORAGE_CONNECTION_STRING", trim: true),
            AzureSlipContainer = reader.String("AZURE_SLIP_CONTAINER", trim: true) ?? "slips",
            TrustProxy = trustProxy,
            ProxySecret = proxySecret,
            DbMigrateOnStart = reader.Boolean("DB_MIGRATE_ON_START", false),
            RunJobs = reader.Boolean("RUN_JOBS", true),
            ServerRoot = serverRoot,
        };

        return reader.Errors.Count == 0 ? (config, reader.Errors) : (null, reader.Errors);
    }

    private static bool IsSampleSecret(string? value)
    {
        var secret = value ?? "";
        return secret.StartsWith("replace_me", StringComparison.Ordinal) ||
            secret.EndsWith("_not_for_production", StringComparison.Ordinal);
    }

    /// <summary>
    /// ตัวอ่านค่า — ค่าที่เป็นสตริงว่างถือว่า "ไม่ได้ตั้ง" (.env.example มีบรรทัดอย่าง SMTP_HOST= ไว้ให้เติมทีหลัง)
    /// ไม่งั้นคัดลอก .env.example ไปใช้ตามขั้นตอนใน README ทุกอย่างแล้วเซิร์ฟเวอร์กลับเปิดไม่ขึ้น
    /// </summary>
    private sealed class EnvReader(System.Collections.IDictionary variables)
    {
        public List<string> Errors { get; } = [];

        public void Fail(string key, string message) => Errors.Add($"{key}: {message}");

        public string? String(string key, bool trim = false)
        {
            var raw = variables.Contains(key) ? variables[key] as string : null;
            if (raw is null) return null;
            var value = trim ? raw.Trim() : raw;
            return value.Length == 0 ? null : value;
        }

        public string? Required(string key, string message)
        {
            var value = String(key);
            if (value is null) Fail(key, message);
            return value;
        }

        private int Int(string key, int fallback, Func<int, bool> valid, string rule)
        {
            var raw = String(key, trim: true);
            if (raw is null) return fallback;
            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && valid(value)) return value;
            Fail(key, rule);
            return fallback;
        }

        public int PositiveInt(string key, int fallback) => Int(key, fallback, v => v > 0, "ต้องเป็นจำนวนเต็มบวก");

        public int NonNegativeInt(string key, int fallback) => Int(key, fallback, v => v >= 0, "ต้องเป็นจำนวนเต็มที่ไม่ติดลบ");

        public int IntInRange(string key, int fallback, int min, int max) =>
            Int(key, fallback, v => v >= min && v <= max, $"ต้องเป็นจำนวนเต็ม {min}–{max}");

        public double PositiveDouble(string key, double fallback)
        {
            var raw = String(key, trim: true);
            if (raw is null) return fallback;
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0) return value;
            Fail(key, "ต้องเป็นตัวเลขที่มากกว่า 0");
            return fallback;
        }

        public bool Boolean(string key, bool fallback)
        {
            var raw = String(key, trim: true);
            if (raw is null) return fallback;
            if (raw is "true" or "false") return raw == "true";
            Fail(key, "ต้องเป็น true หรือ false");
            return fallback;
        }
    }
}
