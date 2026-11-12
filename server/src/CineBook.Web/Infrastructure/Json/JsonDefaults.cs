using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace CineBook.Web.Infrastructure.Json;

/// <summary>
/// รูปแบบ JSON ของ API ให้ตรงกับที่ Express ส่งมาตลอด: ชื่อฟิลด์ camelCase, enum เป็นสตริง, null ส่งออกครบ
/// และเวลาเป็น ISO 8601 แบบ Date.toISOString() (มิลลิวินาที 3 หลัก ลงท้าย Z)
/// </summary>
public static class JsonDefaults
{
    /// <summary>ตั้งค่าเดียวกันให้ทั้ง MVC และตัวเขียน error/health ที่เขียน JSON เอง</summary>
    public static void Apply(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.DictionaryKeyPolicy = null;
        options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        // ภาษาไทยเขียนเป็นตัวอักษรจริง ไม่ใช่ ก — อ่าน log/response ได้ และขนาดเล็กกว่า
        options.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
        if (!options.Converters.OfType<JsonStringEnumConverter>().Any()) options.Converters.Add(new JsonStringEnumConverter());
        if (!options.Converters.OfType<IsoDateTimeConverter>().Any())
        {
            options.Converters.Add(new IsoDateTimeConverter());
            options.Converters.Add(new IsoNullableDateTimeConverter());
        }
    }

    /// <summary>JSON ที่ API ใช้ (สร้างครั้งเดียวแล้วใช้ซ้ำ)</summary>
    public static readonly JsonSerializerOptions Api = Create();

    /// <summary>
    /// JSON ที่เก็บลงคอลัมน์ jsonb (seatSnapshot ฯลฯ) — รูปเดียวกับที่ Prisma เคยเก็บไว้: camelCase และ enum เป็นสตริง
    /// </summary>
    public static readonly JsonSerializerOptions Storage = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Apply(options);
        return options;
    }

    public static string FormatIso(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }
}

/// <summary>เขียนเวลาเป็น 2026-10-02T12:00:00.000Z เสมอ (เวลาในระบบทั้งหมดเป็น UTC)</summary>
public sealed class IsoDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTime.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(JsonDefaults.FormatIso(value));
}

public sealed class IsoNullableDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null
            ? null
            : DateTime.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(JsonDefaults.FormatIso(value.Value));
    }
}
