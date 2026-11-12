namespace CineBook.Web.Utils;

/// <summary>
/// จำนวนเงินเป็นตัวอักษร สำหรับบรรทัด "(ห้าร้อยหกสิบบาทถ้วน)" บนใบเสร็จ
/// รับเฉพาะจำนวนเต็มบาท เพราะระบบเก็บเงินเป็นบาทเต็มเสมอ จึงลงท้าย "ถ้วน" ทุกครั้ง
/// </summary>
public static class BahtText
{
    private static readonly string[] ThDigits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
    private static readonly string[] ThPlaces = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

    private static readonly string[] EnOnes =
    [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
    ];

    private static readonly string[] EnTens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    // ครอบคลุมถึงราว 9 พันล้านล้าน (เท่ากับ Number.MAX_SAFE_INTEGER ของฝั่ง JavaScript เดิม)
    private static readonly string[] EnScales = ["", "Thousand", "Million", "Billion", "Trillion", "Quadrillion"];

    private const long MaxSafeInteger = 9_007_199_254_740_991;

    private static void AssertBaht(long amount)
    {
        if (amount < 0 || amount > MaxSafeInteger)
        {
            throw new ArgumentOutOfRangeException(nameof(amount), amount, $"จำนวนเงินต้องเป็นจำนวนเต็มบาทที่ไม่ติดลบ (ได้ {amount})");
        }
    }

    /// <summary>
    /// อ่านตัวเลขที่ต่ำกว่าหนึ่งล้าน
    /// hasHigher = มีหลักล้านอยู่ข้างหน้า — หลักหน่วยที่เป็น 1 จึงอ่าน "เอ็ด" แม้ส่วนนี้จะมีหลักเดียว (1,000,001 = หนึ่งล้านเอ็ด)
    /// </summary>
    private static string ReadThaiBelowMillion(long value, bool hasHigher)
    {
        var digits = value.ToString(System.Globalization.CultureInfo.InvariantCulture).Select(ch => ch - '0').ToArray();
        var parts = digits.Select((digit, index) =>
        {
            var place = digits.Length - 1 - index;
            if (digit == 0) return "";
            if (place == 1)
            {
                if (digit == 1) return "สิบ";
                if (digit == 2) return "ยี่สิบ";
                return $"{ThDigits[digit]}สิบ";
            }
            if (place == 0 && digit == 1 && (hasHigher || value > 9)) return "เอ็ด";
            return ThDigits[digit] + ThPlaces[place];
        });
        return string.Concat(parts);
    }

    /// <summary>หลักล้านอ่านซ้ำแบบเดียวกับหลักหน่วย แล้วต่อด้วย "ล้าน" (ล้านล้าน ก็ได้จากการเวียนซ้ำ)</summary>
    private static string ReadThai(long value)
    {
        if (value < 1_000_000) return ReadThaiBelowMillion(value, false);
        var rest = value % 1_000_000;
        var head = $"{ReadThai(value / 1_000_000)}ล้าน";
        return rest != 0 ? head + ReadThaiBelowMillion(rest, true) : head;
    }

    /// <summary>560 → "ห้าร้อยหกสิบบาทถ้วน"</summary>
    public static string Thai(long amount)
    {
        AssertBaht(amount);
        if (amount == 0) return "ศูนย์บาทถ้วน";
        return $"{ReadThai(amount)}บาทถ้วน";
    }

    private static string ReadEnglishBelowThousand(long value)
    {
        var words = new List<string>();
        var hundreds = value / 100;
        var rest = value % 100;
        if (hundreds != 0) words.Add($"{EnOnes[hundreds]} Hundred");
        if (rest >= 20)
        {
            var tens = EnTens[rest / 10];
            words.Add(rest % 10 != 0 ? $"{tens}-{EnOnes[rest % 10]}" : tens);
        }
        else if (rest > 0)
        {
            words.Add(EnOnes[rest]);
        }
        return string.Join(' ', words);
    }

    /// <summary>560 → "Five Hundred Sixty Baht Only" (ตัวพิมพ์ใหญ่ทุกคำ ตามแบบใบเสร็จสองภาษาที่ใช้กันในไทย)</summary>
    public static string English(long amount)
    {
        AssertBaht(amount);
        if (amount == 0) return "Zero Baht Only";

        var groups = new List<string>();
        var remaining = amount;
        for (var scale = 0; remaining > 0; scale += 1)
        {
            var chunk = remaining % 1000;
            if (chunk != 0)
            {
                var unit = EnScales[scale].Length > 0 ? $" {EnScales[scale]}" : "";
                groups.Insert(0, $"{ReadEnglishBelowThousand(chunk)}{unit}");
            }
            remaining /= 1000;
        }
        return $"{string.Join(' ', groups)} Baht Only";
    }
}
