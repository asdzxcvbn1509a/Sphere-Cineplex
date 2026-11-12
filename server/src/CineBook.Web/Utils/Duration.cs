using System.Globalization;
using System.Text.RegularExpressions;

namespace CineBook.Web.Utils;

/// <summary>
/// แปลงช่วงเวลาแบบ "15m", "1h", "7d" เป็นมิลลิวินาที — กติกาเดียวกับไลบรารี ms ที่ jsonwebtoken ใช้อ่าน ACCESS_TOKEN_TTL
/// ตัวเลขล้วนไม่มีหน่วย = มิลลิวินาที (เหมือนเดิม: "900" คือ 0.9 วินาที ไม่ใช่ 15 นาที)
/// </summary>
public static partial class Duration
{
    private const double Second = 1000;
    private const double Minute = Second * 60;
    private const double Hour = Minute * 60;
    private const double Day = Hour * 24;
    private const double Week = Day * 7;
    private const double Year = Day * 365.25;

    [GeneratedRegex(
        "^(-?(?:[0-9]+)?\\.?[0-9]+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$",
        RegexOptions.IgnoreCase)]
    private static partial Regex Pattern();

    /// <summary>คืน null เมื่อแปลงไม่ได้</summary>
    public static double? ParseMilliseconds(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 100) return null;
        var match = Pattern().Match(value);
        if (!match.Success) return null;
        var n = double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var unit = match.Groups[2].Success ? match.Groups[2].Value.ToLowerInvariant() : "ms";
        return unit switch
        {
            "years" or "year" or "yrs" or "yr" or "y" => n * Year,
            "weeks" or "week" or "w" => n * Week,
            "days" or "day" or "d" => n * Day,
            "hours" or "hour" or "hrs" or "hr" or "h" => n * Hour,
            "minutes" or "minute" or "mins" or "min" or "m" => n * Minute,
            "seconds" or "second" or "secs" or "sec" or "s" => n * Second,
            _ => n,
        };
    }
}
