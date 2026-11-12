using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;

namespace CineBook.Web.Infrastructure.Storage;

/// <summary>payment = สลิปที่ลูกค้าโอนเข้ามา · refund = สลิปที่ผู้ดูแลโอนคืน — แยกกองด้วยชื่อเดียวกันทั้งบนดิสก์และใน Blob</summary>
public enum SlipKind
{
    Payment,
    Refund,
}

public sealed record SlipFile(byte[] Content, string ContentType);

/// <summary>
/// ที่เก็บไฟล์สลิป — ตั้ง AZURE_STORAGE_CONNECTION_STRING แล้วเก็บบน Azure Blob ไม่งั้นเก็บลงดิสก์ใต้ UPLOAD_DIR
/// ส่วนอื่นของระบบรู้จักสลิปแค่ "ชื่อไฟล์" (ค่าที่ DB เก็บ) กับชนิดสลิป จึงไม่ต้องรู้ว่าไฟล์อยู่ที่ไหนจริง
/// </summary>
public interface ISlipStorage
{
    /// <summary>บอกในบรรทัดเปิดเครื่องว่าสลิปไปอยู่ที่ไหน</summary>
    string Description { get; }

    bool IsPersistentInProduction { get; }

    /// <summary>เก็บสลิปที่ผ่านการตรวจแล้ว — ไม่เขียนทับไฟล์เดิม (ชื่อสุ่มชนกันแทบเป็นไปไม่ได้ แต่ถ้าชนจริงต้องไม่ทับสลิปของคนอื่น)</summary>
    Task SaveAsync(SlipKind kind, string name, byte[] content, string contentType, CancellationToken ct = default);

    /// <summary>
    /// ลบสลิปแบบ best-effort — ใช้เก็บกวาดหลังทำรายการไม่สำเร็จ หรือเมื่อมีสลิปใบใหม่มาแทนใบเก่า
    /// ไม่โยน error ต่อ เพราะรายการหลักจบไปแล้ว (สำเร็จหรือล้มก็ตาม) ลบไฟล์ไม่ได้ไม่ควรเปลี่ยนผลนั้น — ไปโผล่ใน log แทน
    /// </summary>
    Task RemoveAsync(SlipKind kind, string? name);

    /// <summary>อ่านรูปสลิป — เรียกหลังตรวจสิทธิ์ผู้ขอแล้วเท่านั้น · ไม่มีไฟล์แล้ว = 404 SLIP_FILE_MISSING</summary>
    Task<SlipFile> ReadAsync(SlipKind kind, string name, CancellationToken ct = default);
}

internal static class SlipNames
{
    /// <summary>ตัดให้เหลือแค่ชื่อไฟล์ — กันชื่อที่พา path ออกนอกกองของตัวเอง (รับทั้ง / และ \ เหมือน path.basename)</summary>
    public static string BaseName(string? storedName)
    {
        var value = storedName ?? "";
        var cut = Math.Max(value.LastIndexOf('/'), value.LastIndexOf('\\'));
        return cut >= 0 ? value[(cut + 1)..] : value;
    }

    public static string Folder(SlipKind kind) => kind == SlipKind.Refund ? "refunds" : "payments";

    public static string ContentTypeOf(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        _ => "application/octet-stream",
    };

    /// <summary>DB ยังอ้างถึงแต่ไฟล์ไม่อยู่แล้ว = ไฟล์หายจากที่เก็บ (เช่น ดิสก์ไม่ถาวรถูกล้างตอน deploy) จึงไม่ควรเงียบ</summary>
    public static ApiException Missing(ILogger logger, SlipKind kind, string name)
    {
        logger.LogWarning("[slip] ไม่พบไฟล์สลิป {Kind}/{Name} ในที่เก็บ", Folder(kind), name);
        return ApiException.NotFound("SLIP_FILE_MISSING", "ไม่พบไฟล์สลิปในที่เก็บ");
    }
}

/// <summary>เก็บบนดิสก์ใต้ UPLOAD_DIR/slips/{payments,refunds} — ใช้ตอนพัฒนาและรันเทสต์</summary>
public sealed class DiskSlipStorage : ISlipStorage
{
    private readonly AppConfig _config;
    private readonly ILogger<DiskSlipStorage> _logger;

    public DiskSlipStorage(AppConfig config, ILogger<DiskSlipStorage> logger)
    {
        _config = config;
        _logger = logger;
        Directory.CreateDirectory(config.PaymentSlipDir);
        Directory.CreateDirectory(config.RefundSlipDir);
    }

    public string Description => _config.SlipDir;

    public bool IsPersistentInProduction => false;

    private string DirOf(SlipKind kind) => kind == SlipKind.Refund ? _config.RefundSlipDir : _config.PaymentSlipDir;

    /// <summary>
    /// แปลงชื่อไฟล์ใน DB เป็น path จริง พร้อมกันการหลุดออกนอกโฟลเดอร์ที่กำหนด
    /// ฐานข้อมูลเก็บแค่ชื่อไฟล์ ไม่เก็บ path จึงต้องบอกด้วยว่าเป็นสลิปชนิดไหน
    /// </summary>
    public string ResolvePath(string storedName, SlipKind kind)
    {
        var dir = DirOf(kind);
        var safeName = SlipNames.BaseName(storedName);
        var full = Path.GetFullPath(Path.Combine(dir, safeName));
        if (!full.StartsWith(Path.GetFullPath(dir), StringComparison.Ordinal))
        {
            throw ApiException.BadRequest("INVALID_PATH", "ชื่อไฟล์ไม่ถูกต้อง");
        }

        // ไฟล์ที่อัปโหลดไว้ก่อนแยกโฟลเดอร์ยังกองอยู่ที่ slips/ ชั้นนอก ต้องยังเปิดดูได้
        if (!File.Exists(full))
        {
            var legacy = Path.Combine(_config.SlipDir, safeName);
            if (File.Exists(legacy)) return legacy;
        }
        return full;
    }

    public async Task SaveAsync(SlipKind kind, string name, byte[] content, string contentType, CancellationToken ct = default)
    {
        var path = Path.Combine(DirOf(kind), SlipNames.BaseName(name));
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await stream.WriteAsync(content, ct);
    }

    public Task RemoveAsync(SlipKind kind, string? name)
    {
        if (string.IsNullOrEmpty(name)) return Task.CompletedTask;
        try
        {
            var path = ResolvePath(name, kind);
            // ไฟล์ไม่อยู่แล้วก็ได้ผลเดียวกับลบสำเร็จ
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ApiException)
        {
            _logger.LogError("[slip] ลบสลิป {Kind}/{Name} ไม่สำเร็จ: {Message}", SlipNames.Folder(kind), name, ex.Message);
        }
        return Task.CompletedTask;
    }

    public async Task<SlipFile> ReadAsync(SlipKind kind, string name, CancellationToken ct = default)
    {
        var path = ResolvePath(name, kind);
        // เช็กก่อนอ่าน — ปล่อยให้ไปเจอเองจะตอบเป็น 500 ทั้งที่แค่หาไฟล์ไม่เจอ
        if (!File.Exists(path)) throw SlipNames.Missing(_logger, kind, name);
        return new SlipFile(await File.ReadAllBytesAsync(path, ct), SlipNames.ContentTypeOf(name));
    }
}

/// <summary>
/// เก็บบน Azure Blob Storage (container แบบ private) — โฮสต์ที่ดิสก์ไม่ถาวรต้องใช้ตัวนี้
/// สลิปเปิดดูได้ผ่าน API ที่ตรวจสิทธิ์เท่านั้น (เซิร์ฟเวอร์ดึงไฟล์จาก Blob แล้วส่งต่อ) ไม่มีลิงก์ตรงไปที่ไฟล์หลุดออกไปเลย
/// </summary>
public sealed class AzureBlobSlipStorage(AppConfig config, ILogger<AzureBlobSlipStorage> logger) : ISlipStorage
{
    private readonly BlobContainerClient _container =
        new(config.AzureStorageConnectionString, config.AzureSlipContainer);

    public string Description => $"Azure Blob Storage (container {config.AzureSlipContainer})";

    public bool IsPersistentInProduction => true;

    /// <summary>ชื่อ blob — prefix ตามชนิดสลิป ให้ตรงกับโครงโฟลเดอร์บนดิสก์</summary>
    private BlobClient Blob(SlipKind kind, string name) =>
        _container.GetBlobClient($"{SlipNames.Folder(kind)}/{SlipNames.BaseName(name)}");

    public async Task SaveAsync(SlipKind kind, string name, byte[] content, string contentType, CancellationToken ct = default)
    {
        await Blob(kind, name).UploadAsync(new BinaryData(content), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
            // ไม่เขียนทับ blob เดิม เหตุผลเดียวกับ FileMode.CreateNew ของดิสก์
            Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All },
        }, ct);
    }

    public async Task RemoveAsync(SlipKind kind, string? name)
    {
        if (string.IsNullOrEmpty(name)) return;
        try
        {
            await Blob(kind, name).DeleteIfExistsAsync();
        }
        catch (RequestFailedException ex)
        {
            logger.LogError("[slip] ลบสลิป {Kind}/{Name} ไม่สำเร็จ: {Message}", SlipNames.Folder(kind), name, ex.Message);
        }
    }

    public async Task<SlipFile> ReadAsync(SlipKind kind, string name, CancellationToken ct = default)
    {
        try
        {
            var result = await Blob(kind, name).DownloadContentAsync(ct);
            return new SlipFile(result.Value.Content.ToArray(), SlipNames.ContentTypeOf(name));
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw SlipNames.Missing(logger, kind, name);
        }
    }
}
