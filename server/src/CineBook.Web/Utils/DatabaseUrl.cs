using System.Globalization;
using Npgsql;

namespace CineBook.Web.Utils;

/// <summary>
/// DATABASE_URL ใช้รูปแบบ URI แบบเดิม (postgresql://user:pass@host:5432/db?sslmode=require&amp;connection_limit=5)
/// เพื่อให้ค่าที่ตั้งไว้ใน .env และบนโฮสต์ใช้ต่อได้ — Npgsql ต้องการแบบ key=value จึงแปลงตรงนี้ที่เดียว
/// ถ้าส่งมาเป็นแบบ key=value อยู่แล้ว (Host=…;Database=…) ก็ใช้ตามนั้นเลย
/// </summary>
public static class DatabaseUrl
{
    public static string ToNpgsql(string databaseUrl)
    {
        var value = databaseUrl.Trim();
        if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return new NpgsqlConnectionStringBuilder(value).ConnectionString;
        }

        var uri = new Uri(value);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
        };

        if (uri.UserInfo.Length > 0)
        {
            var colon = uri.UserInfo.IndexOf(':');
            builder.Username = Uri.UnescapeDataString(colon < 0 ? uri.UserInfo : uri.UserInfo[..colon]);
            if (colon >= 0) builder.Password = Uri.UnescapeDataString(uri.UserInfo[(colon + 1)..]);
        }

        foreach (var (key, raw) in ParseQuery(uri.Query))
        {
            switch (key)
            {
                // ชื่อเดิมของ Prisma — จำกัดจำนวน connection ให้อยู่ในโควตาของ pooler/แพ็กเกจฟรี
                case "connection_limit":
                    builder.MaxPoolSize = int.Parse(raw, CultureInfo.InvariantCulture);
                    break;
                case "sslmode":
                    builder.SslMode = raw.ToLowerInvariant() switch
                    {
                        "disable" => SslMode.Disable,
                        "allow" => SslMode.Allow,
                        "prefer" => SslMode.Prefer,
                        "require" => SslMode.Require,
                        "verify-ca" => SslMode.VerifyCA,
                        "verify-full" => SslMode.VerifyFull,
                        _ => throw new FormatException($"sslmode ไม่รู้จัก: {raw}"),
                    };
                    break;
                case "connect_timeout":
                    builder.Timeout = int.Parse(raw, CultureInfo.InvariantCulture);
                    break;
                case "application_name":
                    builder.ApplicationName = raw;
                    break;
                case "schema":
                    // Prisma ใส่ schema=public ไว้ใน URL ตัวอย่าง — public เป็นค่าเริ่มต้นอยู่แล้ว schema อื่นค่อยตั้ง search path
                    if (!raw.Equals("public", StringComparison.Ordinal)) builder.SearchPath = raw;
                    break;
            }
        }

        return builder.ConnectionString;
    }

    /// <summary>ชื่อฐานข้อมูลใน DATABASE_URL — เทสต์ใช้ตรวจว่าชี้ไปฐานที่ลงท้ายด้วย _test จริง</summary>
    public static string DatabaseName(string databaseUrl) =>
        new NpgsqlConnectionStringBuilder(ToNpgsql(databaseUrl)).Database ?? "";

    private static IEnumerable<(string Key, string Value)> ParseQuery(string query)
    {
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            var key = Uri.UnescapeDataString(eq < 0 ? part : part[..eq]);
            var value = eq < 0 ? "" : Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
            yield return (key, value);
        }
    }
}
