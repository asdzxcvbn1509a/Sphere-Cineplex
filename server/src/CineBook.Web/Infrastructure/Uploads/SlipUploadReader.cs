using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Utils;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

namespace CineBook.Web.Infrastructure.Uploads;

/// <summary>สลิปที่รับมาและเก็บลงที่เก็บแล้ว — service รู้จักแค่ชื่อไฟล์ ถ้าทำรายการไม่สำเร็จ service เป็นคนลบเอง</summary>
public sealed record StoredSlip(string FileName, SlipKind Kind);

/// <summary>ผลการอ่าน multipart — ไฟล์ slip (ถ้ามี) กับช่องข้อความ (เช่น note ของผู้ดูแล)</summary>
public sealed record SlipForm(StoredSlip? Slip, IReadOnlyDictionary<string, string> Fields);

/// <summary>
/// รับสลิปจาก multipart/form-data (ช่อง slip) แทน multer + ตรวจไส้ไฟล์ + เก็บลงที่เก็บของเดิม
///
/// พักไฟล์ไว้ในหน่วยความจำก่อน (ไม่เกิน MAX_SLIP_SIZE_MB) ให้ตรวจไส้ในได้ก่อนส่งไปที่เก็บจริง
/// ไฟล์ที่ไม่ผ่านการตรวจจึงไม่ถูกเขียนลงที่ไหนเลย ไม่ว่าที่เก็บจะเป็นดิสก์หรือ Blob
///
/// จำกัดช่องข้อความด้วย — ไม่จำกัด ใครล็อกอินได้ก็ส่งช่องปลอมรัว ๆ จนหน่วยความจำเต็มได้
/// ก่อนที่ service จะได้ตรวจว่าเป็นเจ้าของการจองหรือไม่ · ฟอร์มจริงมีแค่ไฟล์ slip กับ note ของผู้ดูแล
/// (ช่องกรอกจำกัด 200 ตัว — ภาษาไทยไม่เกิน 600 ไบต์)
/// </summary>
public sealed class SlipUploadReader(AppConfig config, ISlipStorage storage)
{
    private const int MaxFiles = 1;
    private const int MaxFields = 5;
    private const int MaxFieldBytes = 4 * 1024;
    private const int MaxParts = 6;
    private const int HeadersLimit = 16 * 1024;
    private const string FileField = "slip";

    private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
    };

    private static ApiException UploadError() => ApiException.BadRequest("UPLOAD_ERROR", "อัปโหลดไฟล์ไม่สำเร็จ");

    private static ApiException TooLarge() => ApiException.BadRequest("FILE_TOO_LARGE", "ไฟล์มีขนาดใหญ่เกินกำหนด");

    /// <summary>อ่านฟอร์มแล้วเก็บไฟล์ที่ผ่านการตรวจ — คำขอที่ไม่ใช่ multipart ได้ฟอร์มว่าง (service ตอบ NO_FILE เอง)</summary>
    public async Task<SlipForm> ReadAsync(HttpRequest request, SlipKind kind, CancellationToken ct)
    {
        var (file, fields) = await ReadPartsAsync(request, ct);
        if (file is null) return new SlipForm(null, fields);

        var (content, mimeType) = file.Value;
        if (!HasImageSignature(mimeType, content))
        {
            throw ApiException.BadRequest("UNSUPPORTED_FILE_TYPE", "ไฟล์นี้ไม่ใช่รูปภาพ JPG, PNG หรือ WEBP ที่ถูกต้อง");
        }

        // ไม่ใช้ชื่อไฟล์จากผู้ใช้เลย — กัน path traversal และชื่อซ้ำ
        var fileName = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Codes.FileId()}{Allowed[mimeType]}";
        await storage.SaveAsync(kind, fileName, content, mimeType.ToLowerInvariant(), ct);
        return new SlipForm(new StoredSlip(fileName, kind), fields);
    }

    private async Task<((byte[] Content, string MimeType)? File, Dictionary<string, string> Fields)> ReadPartsAsync(
        HttpRequest request, CancellationToken ct)
    {
        var fields = new Dictionary<string, string>();
        if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var contentType) ||
            !contentType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            return (null, fields);
        }

        var boundary = HeaderUtilities.RemoveQuotes(contentType.Boundary).Value;
        if (string.IsNullOrEmpty(boundary)) throw UploadError();

        // เพดานทั้งคำขอของ Kestrel (1 MB เท่า express.json) เล็กกว่าสลิป — ขยายเฉพาะคำขอนี้ให้พอดีกับ
        // ไฟล์ + ช่องข้อความ + ส่วนหัวของทุกส่วน ส่วนที่เกินจริงถูกตรวจทีละส่วนด้านล่าง (ไฟล์เกิน = FILE_TOO_LARGE)
        var bodyLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (bodyLimit is { IsReadOnly: false })
        {
            bodyLimit.MaxRequestBodySize = config.MaxSlipBytes + MaxParts * (HeadersLimit + MaxFieldBytes) + HeadersLimit;
        }

        // เพดานของแต่ละส่วนตรวจเองใน ReadLimitedAsync (ไฟล์เกิน = FILE_TOO_LARGE, ช่องข้อความเกิน = UPLOAD_ERROR)
        var reader = new MultipartReader(boundary, request.Body)
        {
            HeadersLengthLimit = HeadersLimit,
            BodyLengthLimit = null,
        };

        (byte[], string)? file = null;
        var parts = 0;
        try
        {
            for (var section = await reader.ReadNextSectionAsync(ct); section is not null; section = await reader.ReadNextSectionAsync(ct))
            {
                parts += 1;
                if (parts > MaxParts) throw UploadError();
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)) throw UploadError();
                var name = HeaderUtilities.RemoveQuotes(disposition.Name).Value ?? "";

                if (disposition.IsFileDisposition())
                {
                    // multer .single('slip'): ไฟล์ในช่องอื่นหรือเกินหนึ่งไฟล์ = คำขอผิดรูป
                    if (name != FileField || file is not null) throw UploadError();
                    // mimetype ใน multipart เป็นค่าที่ฝั่งส่งตั้งเองได้ จึงเป็นแค่ด่านแรก ไส้ไฟล์ถูกตรวจซ้ำด้านล่าง
                    var mimeType = section.ContentType ?? "";
                    if (!Allowed.ContainsKey(mimeType))
                    {
                        throw ApiException.BadRequest("UNSUPPORTED_FILE_TYPE", "รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP");
                    }
                    file = (await ReadLimitedAsync(section.Body, config.MaxSlipBytes, TooLarge, ct), mimeType);
                }
                else
                {
                    if (fields.Count >= MaxFields) throw UploadError();
                    var bytes = await ReadLimitedAsync(section.Body, MaxFieldBytes, UploadError, ct);
                    fields[name] = System.Text.Encoding.UTF8.GetString(bytes);
                }
            }
        }
        catch (InvalidDataException)
        {
            // multipart ผิดรูป หรือส่วนหัว/เนื้อหาเกินเพดานของตัวอ่าน
            throw UploadError();
        }
        catch (BadHttpRequestException error) when (error.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // Content-Length ใหญ่เกินเพดานทั้งคำขอ — Kestrel ตัดตั้งแต่ก่อนอ่าน ซึ่งเกิดได้จากไฟล์ใหญ่เท่านั้น
            throw TooLarge();
        }
        catch (IOException) when (!ct.IsCancellationRequested)
        {
            throw UploadError();
        }

        if (file is { } f && f.Item1.Length > config.MaxSlipBytes) throw TooLarge();
        return (file is { } ok ? (ok.Item1, ok.Item2) : null, fields);
    }

    private static async Task<byte[]> ReadLimitedAsync(Stream body, long limit, Func<ApiException> tooLarge, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > limit) throw tooLarge();
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    /// <summary>
    /// ตรวจไส้ในไฟล์ว่าเป็นรูปจริงตามชนิดที่บอกมา (magic bytes)
    /// ไม่ตรวจตรงนี้ ใครก็อัปโหลด HTML/สคริปต์โดยบอกว่าเป็น image/png แล้วไปค้างอยู่ในที่เก็บสลิปได้
    /// </summary>
    public static bool HasImageSignature(string mimeType, ReadOnlySpan<byte> head) => mimeType.ToLowerInvariant() switch
    {
        "image/jpeg" => head.Length >= 3 && head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff,
        "image/png" => head.Length >= 8 && head[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }),
        "image/webp" => head.Length >= 12 && head[..4].SequenceEqual("RIFF"u8) && head[8..12].SequenceEqual("WEBP"u8),
        _ => false,
    };
}
