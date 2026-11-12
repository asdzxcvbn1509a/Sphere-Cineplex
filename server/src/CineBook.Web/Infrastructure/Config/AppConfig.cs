using CineBook.Web.Utils;

namespace CineBook.Web.Infrastructure.Config;

/// <summary>
/// ค่าตั้งทั้งหมดของ API อ่านจาก environment (ชื่อตัวแปรเดิมของฝั่ง Express ทุกตัว) — ตรวจครบตอนเปิดเครื่องใน AppConfigLoader
/// ต่างจากเดิมแค่ NODE_ENV → ASPNETCORE_ENVIRONMENT และ SUPABASE_* → AZURE_STORAGE_* (เก็บสลิปบน Azure Blob)
/// </summary>
public sealed record AppConfig
{
    /// <summary>เลขพร้อมเพย์ตัวอย่างใน .env.example — ขึ้นระบบจริงแล้วยังเป็นเลขนี้ จะเตือนตอนเปิดเครื่อง</summary>
    public const string SamplePromptPayId = "0812345678";

    public required string DatabaseUrl { get; init; }
    public required string ConnectionString { get; init; }
    public int Port { get; init; } = 4000;
    /// <summary>Development / Test / Production — ไม่ตั้ง = Production (โหมดที่ปลอดภัยไว้ก่อน แบบเดียวกับเดิม)</summary>
    public required string EnvironmentName { get; init; }
    public string ClientOrigin { get; init; } = "http://localhost:5173";

    public required string JwtAccessSecret { get; init; }
    public required string JwtRefreshSecret { get; init; }
    public string AccessTokenTtl { get; init; } = "15m";
    public double AccessTokenLifetimeMs { get; init; }
    public int RefreshTokenTtlDays { get; init; } = 7;

    // ยิ่งสูงยิ่งเดารหัสผ่านยาก แต่ล็อกอินก็ช้าลงตามตัว 10 คือจุดที่ยังไม่รู้สึกหน่วง
    public int BcryptRounds { get; init; } = 10;
    // ล็อกอินผิดได้กี่ครั้งต่อ (ไอพี + บัญชี) ในกรอบเวลาด้านล่าง — ครั้งที่สำเร็จไม่ถูกนับ
    public int LoginLimit { get; init; } = 10;
    public int LoginWindowMinutes { get; init; } = 15;
    // สมัครสมาชิกได้กี่บัญชีต่อไอพี ในกรอบเวลาด้านล่าง (นับเฉพาะครั้งที่สมัครสำเร็จ)
    // ตั้งไว้กันบอทสมัครทีละพัน ไม่ใช่กันคนจริง — ออฟฟิศหรือห้างที่ออกเน็ตไอพีเดียวกันต้องยังสมัครได้
    public int RegisterLimit { get; init; } = 50;
    public int RegisterWindowMinutes { get; init; } = 60;
    // อายุลิงก์ตั้งรหัสผ่านใหม่ — สั้นพอที่ลิงก์หลุดทีหลังแล้วใช้ไม่ได้ แต่ยาวพอให้คนเปิดเมลทัน
    public int PasswordResetTtlMinutes { get; init; } = 30;
    // ขอลิงก์ได้กี่ครั้งต่อ (ไอพี + อีเมล) ในกรอบเวลาด้านล่าง — กันคนเอาระบบไปถล่มเมลคนอื่นเล่น
    public int PasswordResetLimit { get; init; } = 5;
    public int PasswordResetWindowMinutes { get; init; } = 60;

    public int SeatHoldMinutes { get; init; } = 10;
    public int RejectedRetryMinutes { get; init; } = 10;
    public int CancelCutoffHours { get; init; } = 3;
    public int MaxSeatsPerBooking { get; init; } = 8;
    // การจองที่ยังถือที่นั่งไว้พร้อมกันได้กี่รายการต่อคน (รอชำระ + รอตรวจสลิป)
    // กันบัญชีเดียววนจองกักที่นั่งไว้ทั้งโรงโดยไม่จ่าย — คนจองจริงแทบไม่เคยค้างเกิน 1-2 รายการ
    public int MaxPendingBookingsPerUser { get; init; } = 3;
    // ลูกค้าเปลี่ยนที่นั่งเองได้ถึงก่อนรอบฉายกี่นาที — ย้ายในโซนเดิมไม่มีเงินเกี่ยว จึงผ่อนกว่าการยกเลิก (CANCEL_CUTOFF_HOURS)
    public int SeatChangeCutoffMinutes { get; init; } = 30;
    // ลูกค้าเปลี่ยนที่นั่งเองได้กี่ครั้งต่อการจอง — กันการสลับไปมาจนที่นั่งกระพริบให้คนอื่นจองไม่ได้
    // (คำขอที่หมดเวลา/ยกเลิกไม่นับ และผู้ดูแลย้ายให้ไม่นับ)
    public int MaxSeatChangesPerBooking { get; init; } = 1;

    public string PromptPayId { get; init; } = SamplePromptPayId;
    public string PromptPayMerchantName { get; init; } = "THEATRE RESERVATION";

    // ชื่อผู้ออกใบเสร็จ ใช้ทั้งหน้าใบเสร็จและอีเมล — ค่าเริ่มต้นตรงกับชื่อที่ลูกค้าเห็นบนหน้าเว็บ (common.appName)
    public string ReceiptIssuerName { get; init; } = "Sphere Cineplex";
    // ที่อยู่ผู้ออกใบเสร็จ — ไม่ตั้ง = ไม่แสดงบรรทัดที่อยู่บนใบเสร็จ
    public string? ReceiptIssuerAddress { get; init; }

    // ไม่ตั้ง SMTP_HOST = ยังไม่ส่งอีเมลจริง ระบบจะพิมพ์เนื้อเมลลง console ให้แทน (ใช้ตอนพัฒนา)
    public string? SmtpHost { get; init; }
    public int SmtpPort { get; init; } = 587;
    /// <summary>true = เข้ารหัสตั้งแต่เชื่อมต่อ (พอร์ต 465) · ไม่ตั้งมาจะเดาจากพอร์ตให้เอง</summary>
    public bool SmtpSecure { get; init; }
    public string? SmtpUser { get; init; }
    public string? SmtpPass { get; init; }
    public string MailFrom { get; init; } = "Theatre Reservation <no-reply@localhost>";
    /// <summary>ฐานของลิงก์ในอีเมล ต้องเป็น URL ที่ผู้ใช้เปิดได้จากเครื่องตัวเอง — ตัด / ท้ายทิ้งแล้ว</summary>
    public required string AppUrl { get; init; }

    public string UploadDir { get; init; } = "uploads";
    public double MaxSlipSizeMb { get; init; } = 5;

    // ไม่ตั้ง = เก็บสลิปลงดิสก์ใต้ UPLOAD_DIR (ใช้ตอนพัฒนาและรันเทสต์)
    // โฮสต์ที่ดิสก์ไม่ถาวรต้องตั้ง ไม่งั้นสลิปหายทุกครั้งที่ deploy หรือ restart
    public string? AzureStorageConnectionString { get; init; }
    // ต้องเป็น container แบบ private — สลิปเปิดดูได้ผ่าน API ที่ตรวจสิทธิ์เท่านั้น
    public string AzureSlipContainer { get; init; } = "slips";

    // ใครอยู่หน้า API บ้าง — ใช้ตัดสินว่าจะเชื่อ X-Forwarded-For แค่ไหน (ดู Utils/TrustProxy)
    public string TrustProxy { get; init; } = "loopback";
    // secret ที่ proxy ข้างหน้าแนบมากับทุกคำขอ — ตั้งแล้ว API รับเฉพาะคำขอที่มาทาง proxy นั้น (ไม่ตั้ง = รับทุกคำขอ)
    public string? ProxySecret { get; init; }

    /// <summary>รัน EF migration ที่ยังไม่เคยรันตอนเปิดเครื่อง (บน Azure) — แทน prisma migrate deploy ตอน build ของ Render</summary>
    public bool DbMigrateOnStart { get; init; }
    /// <summary>เริ่มงานเบื้องหลังหรือไม่ — เทสต์ปิดไว้ (เดิม createApp() ของเทสต์ก็ไม่เริ่ม jobs)</summary>
    public bool RunJobs { get; init; } = true;

    /// <summary>โฟลเดอร์ server/ (ที่มี .env) — ฐานของ UPLOAD_DIR แบบ relative</summary>
    public required string ServerRoot { get; init; }

    public bool IsDevelopment => EnvironmentName.Equals("Development", StringComparison.OrdinalIgnoreCase);
    public bool IsProduction => EnvironmentName.Equals("Production", StringComparison.OrdinalIgnoreCase);
    public bool IsTest => EnvironmentName.Equals("Test", StringComparison.OrdinalIgnoreCase);

    /// <summary>ตั้ง SMTP_HOST แล้วเท่านั้นถึงจะส่งอีเมลจริง ไม่งั้น mailer จะพิมพ์ลง console ให้แทน</summary>
    public bool IsMailConfigured => !string.IsNullOrEmpty(SmtpHost);

    /// <summary>ตั้ง AZURE_STORAGE_CONNECTION_STRING แล้วสลิปไปอยู่บน Azure Blob ไม่งั้นเก็บลงดิสก์ใต้ UPLOAD_DIR</summary>
    public bool IsBlobStorageConfigured => !string.IsNullOrEmpty(AzureStorageConnectionString);

    public long MaxSlipBytes => (long)(MaxSlipSizeMb * 1024 * 1024);

    /// <summary>โฟลเดอร์เก็บไฟล์อัปโหลด (absolute)</summary>
    public string UploadRoot => Path.IsPathRooted(UploadDir) ? UploadDir : Path.Combine(ServerRoot, UploadDir);

    public string SlipDir => Path.Combine(UploadRoot, "slips");

    /// <summary>
    /// แยกโฟลเดอร์ตามคนอัปโหลด เพราะสองอย่างนี้เป็นคนละเรื่องกัน
    /// payments = สลิปที่ลูกค้าโอนเงินเข้ามา · refunds = สลิปที่ผู้ดูแลโอนคืนให้ลูกค้า
    /// </summary>
    public string PaymentSlipDir => Path.Combine(SlipDir, "payments");

    public string RefundSlipDir => Path.Combine(SlipDir, "refunds");

    public TrustProxySetting TrustProxySetting => Utils.TrustProxy.Parse(TrustProxy);

    public TimeSpan RefreshTokenLifetime => TimeSpan.FromDays(RefreshTokenTtlDays);
}
