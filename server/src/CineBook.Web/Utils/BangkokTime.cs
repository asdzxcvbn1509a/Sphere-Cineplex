using System.Globalization;
using System.Text.RegularExpressions;

namespace CineBook.Web.Utils;

/// <summary>
/// เก็บเวลาทั้งหมดใน DB เป็น UTC แต่ "วัน" ที่ผู้ใช้เห็นคือวันตามเวลาไทย
/// ไทยเป็น UTC+7 ตลอดปี (ไม่มี DST) จึงบวก offset ตรง ๆ ได้อย่างปลอดภัย
///
/// ข้อความวันเวลาเขียนชื่อเดือนเองทั้งหมด ไม่พึ่งข้อมูล culture ของเครื่อง —
/// ICU บน Linux (App Service) กับ NLS/ICU บน Windows ให้ผลต่างกันได้ และ th-TH ของ .NET ใช้ปฏิทินพุทธศักราชเป็นค่าเริ่มต้น
/// ผลลัพธ์ตรงกับ Intl.DateTimeFormat ของ Node ที่ฝั่ง Express เคยใช้ (เช่น en-GB เดือนกันยายนเป็น "Sept")
/// </summary>
public static partial class BangkokTime
{
    public static readonly TimeSpan Offset = TimeSpan.FromHours(7);

    private static readonly string[] ThaiMonthsShort =
        ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

    private static readonly string[] ThaiMonthsLong =
    [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
    ];

    private static readonly string[] EnglishMonthsShort =
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

    private static readonly string[] EnglishMonthsLong =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    /// <summary>เวลาไทยของเวลา UTC (ใช้อ่านวัน/ชั่วโมงตามเวลาไทยเท่านั้น ไม่ได้เก็บลงฐาน)</summary>
    public static DateTime ToBangkok(DateTime utc) => DateTime.SpecifyKind(utc.ToUniversalTime() + Offset, DateTimeKind.Unspecified);

    /// <summary>คืนคีย์วันแบบ YYYY-MM-DD ตามเวลาไทย</summary>
    public static string DateKey(DateTime utc) => ToBangkok(utc).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    [GeneratedRegex("^([0-9]{4})-([0-9]{2})-([0-9]{2})$")]
    private static partial Regex DateKeyPattern();

    /// <summary>
    /// ช่วงเวลา UTC ที่ครอบ "วันนั้นทั้งวัน" ตามเวลาไทย — รูปแบบผิดคืน null
    /// เลียนแบบ Date.parse ของ JavaScript เดิมทุกกรณี: เดือนต้อง 01–12 และวันต้อง 01–31
    /// แต่วันที่เกินจำนวนวันของเดือนจะเลื่อนไปเดือนถัดไป (2026-02-30 = 2 มี.ค.)
    /// </summary>
    public static (DateTime Start, DateTime End)? DayRange(string? dateKey)
    {
        var match = DateKeyPattern().Match(dateKey ?? "");
        if (!match.Success) return null;
        var year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
        if (month is < 1 or > 12 || day is < 1 or > 31 || year < 1) return null;
        var startOfDay = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(day - 1);
        var start = startOfDay - Offset;
        return (start, start.AddDays(1));
    }

    /// <summary>รายการคีย์วันตามเวลาไทย เริ่มจากวันนี้ไปข้างหน้า n วัน</summary>
    public static List<string> UpcomingDateKeys(int days, DateTime fromUtc) =>
        Enumerable.Range(0, days).Select(i => DateKey(fromUtc.AddDays(i))).ToList();

    /// <summary>วันเวลาแบบสั้นตามเวลาไทย ใช้ในข้อความแจ้งเตือน เช่น "2 ต.ค. 19:00" / "2 Oct, 19:00"</summary>
    public static string FormatShort(DateTime utc, string lang = "th")
    {
        var local = ToBangkok(utc);
        var time = local.ToString("HH:mm", CultureInfo.InvariantCulture);
        return lang == "en"
            ? $"{local.Day} {EnglishMonthsShort[local.Month - 1]}, {time}"
            : $"{local.Day} {ThaiMonthsShort[local.Month - 1]} {time}";
    }

    /// <summary>วันเวลาแบบเต็มตามเวลาไทย ใช้ในอีเมลใบเสร็จ เช่น "2 ตุลาคม 2569 เวลา 19:05" / "2 October 2026 at 19:05"</summary>
    public static string FormatLong(DateTime utc, string lang = "th")
    {
        var local = ToBangkok(utc);
        var time = local.ToString("HH:mm", CultureInfo.InvariantCulture);
        return lang == "en"
            ? $"{local.Day} {EnglishMonthsLong[local.Month - 1]} {local.Year} at {time}"
            : $"{local.Day} {ThaiMonthsLong[local.Month - 1]} {local.Year + 543} เวลา {time}";
    }

    /// <summary>เวลาแบบ HH:mm ตามเวลาไทย (ข้อความเตือนก่อนรอบฉาย)</summary>
    public static string FormatTime(DateTime utc) => ToBangkok(utc).ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>ชั่วโมง (0–23) ตามเวลาไทย</summary>
    public static int Hour(DateTime utc) => ToBangkok(utc).Hour;
}
