using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Utils;

namespace CineBook.Web.Seed;

/// <summary>
/// รูปสลิปตัวอย่างของ seed (port จาก prisma/seed/slipImage.js) — PNG ที่วาดเอง (ไม่ต้องลง library เพิ่ม)
/// มียอดเงิน เลขอ้างอิง และรหัสการจอง ผู้ดูแลจึงลองตรวจสลิปเทียบยอดได้จริง (มีใบหนึ่งที่ยอดไม่ตรงไว้ลองกดปฏิเสธ)
/// เขียนคำว่า DEMO / NOT A REAL TRANSFER ไว้ชัด ๆ และไม่ใช้สีหรือหน้าตาของธนาคารไหน — ต้องไม่มีใครเอาไปใช้เป็นหลักฐานโอนเงินได้
///
/// ชื่อไฟล์คงที่ (seed-pay-0001.png, seed-ref-0001.png, ...) และลบชื่อเดิมก่อนเขียนทุกครั้ง
/// รัน seed ซ้ำจึงเขียนทับชุดเดิม ไฟล์ไม่งอกเพิ่มทุกรอบ (ที่เก็บสลิปไม่เขียนทับไฟล์เดิมให้เอง)
/// </summary>
public sealed class SeedSlips(ISlipStorage storage)
{
    private const int Width = 360;
    private const int Height = 600;
    private const int Stride = 1 + Width * 3;

    // ฟอนต์ 5×7 จุด (บิตซ้ายสุด = คอลัมน์แรก) เฉพาะตัวอักษรที่ใช้บนสลิป
    private static readonly Dictionary<char, int[]> Glyphs = new()
    {
        ['A'] = [14, 17, 17, 31, 17, 17, 17], ['B'] = [30, 17, 17, 30, 17, 17, 30], ['C'] = [14, 17, 16, 16, 16, 17, 14],
        ['D'] = [30, 17, 17, 17, 17, 17, 30], ['E'] = [31, 16, 16, 30, 16, 16, 31], ['F'] = [31, 16, 16, 30, 16, 16, 16],
        ['G'] = [14, 17, 16, 23, 17, 17, 15], ['H'] = [17, 17, 17, 31, 17, 17, 17], ['I'] = [14, 4, 4, 4, 4, 4, 14],
        ['J'] = [7, 2, 2, 2, 2, 18, 12], ['K'] = [17, 18, 20, 24, 20, 18, 17], ['L'] = [16, 16, 16, 16, 16, 16, 31],
        ['M'] = [17, 27, 21, 21, 17, 17, 17], ['N'] = [17, 17, 25, 21, 19, 17, 17], ['O'] = [14, 17, 17, 17, 17, 17, 14],
        ['P'] = [30, 17, 17, 30, 16, 16, 16], ['Q'] = [14, 17, 17, 17, 21, 18, 13], ['R'] = [30, 17, 17, 30, 20, 18, 17],
        ['S'] = [15, 16, 16, 14, 1, 1, 30], ['T'] = [31, 4, 4, 4, 4, 4, 4], ['U'] = [17, 17, 17, 17, 17, 17, 14],
        ['V'] = [17, 17, 17, 17, 17, 10, 4], ['W'] = [17, 17, 17, 21, 21, 21, 10], ['X'] = [17, 17, 10, 4, 10, 17, 17],
        ['Y'] = [17, 17, 10, 4, 4, 4, 4], ['Z'] = [31, 1, 2, 4, 8, 16, 31],
        ['0'] = [14, 17, 19, 21, 25, 17, 14], ['1'] = [4, 12, 4, 4, 4, 4, 14], ['2'] = [14, 17, 1, 2, 4, 8, 31],
        ['3'] = [31, 2, 4, 2, 1, 17, 14], ['4'] = [2, 6, 10, 18, 31, 2, 2], ['5'] = [31, 16, 30, 1, 1, 17, 14],
        ['6'] = [6, 8, 16, 30, 17, 17, 14], ['7'] = [31, 1, 2, 4, 8, 8, 8], ['8'] = [14, 17, 17, 14, 17, 17, 14],
        ['9'] = [14, 17, 17, 15, 1, 2, 12],
        ['-'] = [0, 0, 0, 31, 0, 0, 0], ['.'] = [0, 0, 0, 0, 0, 12, 12], [','] = [0, 0, 0, 0, 12, 4, 8],
        [':'] = [0, 12, 12, 0, 12, 12, 0], ['*'] = [0, 4, 21, 14, 21, 4, 0], ['/'] = [0, 1, 2, 4, 8, 16, 0],
        [' '] = [0, 0, 0, 0, 0, 0, 0],
    };

    private static readonly byte[] Page = [238, 241, 244];
    private static readonly byte[] Card = [255, 255, 255];
    private static readonly byte[] Label = [104, 112, 122];
    private static readonly byte[] Text = [27, 31, 36];
    // สีกลาง ๆ ที่ไม่ตรงกับแบรนด์ธนาคารไหน — เขียว = เงินเข้า, คราม = เงินคืน
    private static readonly byte[] PaymentAccent = [31, 122, 108];
    private static readonly byte[] RefundAccent = [74, 79, 181];
    private static readonly byte[] OnAccent = [255, 255, 255];

    private static readonly string[] Months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    private readonly Dictionary<SlipKind, byte[]> _templates = [];
    private int _paymentCount;
    private int _refundCount;

    public (int Payment, int Refund) Counts => (_paymentCount, _refundCount);

    private static byte[] Accent(SlipKind kind) => kind == SlipKind.Refund ? RefundAccent : PaymentAccent;

    private static void FillRect(byte[] raw, int x, int y, int w, int h, byte[] color)
    {
        for (var row = y; row < y + h; row += 1)
        {
            var i = row * Stride + 1 + x * 3;
            for (var col = 0; col < w; col += 1)
            {
                raw[i] = color[0];
                raw[i + 1] = color[1];
                raw[i + 2] = color[2];
                i += 3;
            }
        }
    }

    private static int TextWidth(string text, int scale) => text.Length * 6 * scale - scale;

    private static void DrawText(byte[] raw, string text, int x, int y, int scale, byte[] color)
    {
        var cursor = x;
        foreach (var ch in text.ToUpperInvariant())
        {
            var glyph = Glyphs.TryGetValue(ch, out var found) ? found : Glyphs[' '];
            for (var row = 0; row < glyph.Length; row += 1)
            {
                for (var col = 0; col < 5; col += 1)
                {
                    if (((glyph[row] >> (4 - col)) & 1) == 1)
                    {
                        FillRect(raw, cursor + col * scale, y + row * scale, scale, scale, color);
                    }
                }
            }
            cursor += 6 * scale;
        }
    }

    private static void DrawCentered(byte[] raw, string text, int y, int scale, byte[] color) =>
        DrawText(raw, text, (int)SeedTime.JsRound((Width - TextWidth(text, scale)) / 2.0), y, scale, color);

    private static uint Crc32(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k += 1) crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
        }
        return crc ^ 0xFFFFFFFFu;
    }

    private static void WriteChunk(Stream output, string type, byte[] data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        output.Write(length);
        var body = new byte[4 + data.Length];
        Encoding.ASCII.GetBytes(type, body);
        data.CopyTo(body, 4);
        output.Write(body);
        Span<byte> crc = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(body));
        output.Write(crc);
    }

    private static byte[] EncodePng(byte[] raw)
    {
        var header = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(0), Width);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(4), Height);
        header[8] = 8; // 8 บิตต่อช่องสี
        header[9] = 2; // RGB

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true)) zlib.Write(raw);

        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        WriteChunk(png, "IHDR", header);
        WriteChunk(png, "IDAT", compressed.ToArray());
        WriteChunk(png, "IEND", []);
        return png.ToArray();
    }

    // พื้นหลัง หัวสลิป และป้ายกำกับเหมือนกันทุกใบ — วาดครั้งเดียวแล้วคัดลอกไปเติมค่าของแต่ละใบ
    private byte[] Template(SlipKind kind)
    {
        lock (_templates)
        {
            if (!_templates.TryGetValue(kind, out var raw))
            {
                raw = new byte[Stride * Height]; // ไบต์แรกของทุกแถว = 0 (PNG filter: none)
                var accent = Accent(kind);
                FillRect(raw, 0, 0, Width, Height, Page);
                FillRect(raw, 0, 0, Width, 120, accent);
                DrawCentered(raw, kind == SlipKind.Refund ? "DEMO REFUND" : "DEMO SLIP", 30, 4, OnAccent);
                DrawCentered(raw, "SAMPLE DATA ONLY", 80, 2, OnAccent);
                FillRect(raw, 20, 140, Width - 40, 390, Card);
                FillRect(raw, 20, 140, Width - 40, 6, accent);
                DrawText(raw, kind == SlipKind.Refund ? "REFUND TRANSFER" : "PROMPTPAY TRANSFER", 36, 166, 2, Label);
                DrawText(raw, "AMOUNT", 36, 206, 2, Label);
                DrawText(raw, "REF", 36, 296, 2, Label);
                DrawText(raw, "BOOKING", 36, 356, 2, Label);
                DrawText(raw, "DATE", 36, 416, 2, Label);
                DrawCentered(raw, "NOT A REAL TRANSFER", 556, 2, Label);
                _templates[kind] = raw;
            }
            return (byte[])raw.Clone();
        }
    }

    /// <summary>05 NOV 2026 14:05 ตามเวลาไทย</summary>
    private static string SlipDate(DateTime at)
    {
        var d = BangkokTime.ToBangkok(at);
        return $"{d.Day:D2} {Months[d.Month - 1]} {d.Year} {d.Hour:D2}:{d.Minute:D2}";
    }

    private static string SlipAmount(int amount) => $"{amount.ToString("N0", CultureInfo.InvariantCulture)}.00 THB";

    private byte[] Render(SlipKind kind, int amount, string reference, string code, DateTime at, string to)
    {
        var raw = Template(kind);
        DrawText(raw, SlipAmount(amount), 36, 232, 3, Accent(kind));
        DrawText(raw, reference, 36, 320, 2, Text);
        DrawText(raw, code, 36, 380, 2, Text);
        DrawText(raw, SlipDate(at), 36, 440, 2, Text);
        DrawText(raw, to, 36, 490, 2, Text);
        return EncodePng(raw);
    }

    /// <summary>สลิปที่ลูกค้าโอนเข้ามา — amount คือยอดที่ "เขียนบนสลิป" (ตั้งให้ไม่ตรงกับยอดที่ต้องจ่ายได้)</summary>
    public byte[] RenderPaymentSlip(int amount, string reference, string code, DateTime at) =>
        Render(SlipKind.Payment, amount, reference, code, at, "TO SPHERE CINEPLEX");

    /// <summary>สลิปที่ผู้ดูแลโอนคืน — แสดงเลขบัญชีปลายทางแค่ 4 ตัวท้าย</summary>
    public byte[] RenderRefundSlip(int amount, string? accountNo, string code, DateTime at)
    {
        var digits = accountNo ?? "";
        return Render(SlipKind.Refund, amount, $"ACCOUNT ***{(digits.Length > 4 ? digits[^4..] : digits)}", code, at, "FROM SPHERE CINEPLEX");
    }

    /// <summary>ชื่อไฟล์ถัดไปของสลิปชนิดนั้น — ชื่อเดิมทุกครั้งที่รัน seed (ดูหมายเหตุบนสุด)</summary>
    public string NextName(SlipKind kind)
    {
        var count = kind == SlipKind.Refund ? ++_refundCount : ++_paymentCount;
        return $"seed-{(kind == SlipKind.Refund ? "ref" : "pay")}-{count:D4}.png";
    }

    public sealed record SlipJob(SlipKind Kind, string Name, Func<byte[]> Render);

    /// <summary>เขียนสลิปลงที่เก็บจริง (ดิสก์หรือ Azure Blob ตามค่า env เดียวกับ API) — ทำทีละ 8 ไฟล์พร้อมกัน ตอน seed ฐานบน cloud จะได้ไม่ต้องรออัปโหลดทีละไฟล์</summary>
    public Task StoreAsync(IReadOnlyList<SlipJob> jobs, int concurrency = 8) =>
        Parallel.ForEachAsync(jobs, new ParallelOptions { MaxDegreeOfParallelism = concurrency }, async (job, ct) =>
        {
            await storage.RemoveAsync(job.Kind, job.Name);
            await storage.SaveAsync(job.Kind, job.Name, job.Render(), "image/png", ct);
        });

    /// <summary>สร้างและเก็บสลิปหนึ่งใบ แล้วคืนในรูปเดียวกับที่ตัวรับไฟล์ส่งให้ service</summary>
    public async Task<StoredSlip> StoreOneAsync(SlipKind kind, Func<byte[]> render)
    {
        var name = NextName(kind);
        await StoreAsync([new SlipJob(kind, name, render)]);
        return new StoredSlip(name, kind);
    }
}
