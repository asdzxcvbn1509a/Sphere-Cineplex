namespace CineBook.Web.Seed;

/// <summary>
/// ตัวสุ่มแบบกำหนด seed ได้ (mulberry32) — รัน seed กี่ครั้งก็ได้ข้อมูลหน้าตาเดิม
/// ที่ต่างกันมีแค่เวลา (อิงจากวันที่รัน) กับรหัสการจอง/เลขอ้างอิงที่ระบบสุ่มเองตามปกติ
/// จะได้เทียบผลก่อน/หลังแก้โค้ดได้ และบั๊กที่เจอจากข้อมูลชุดหนึ่งเรียกซ้ำได้
///
/// คำนวณด้วย uint ให้ได้บิตเดียวกับ Math.imul / &gt;&gt;&gt; ของ seed เดิม (JS) ทุกขั้น
/// ลำดับการเรียกตัวสุ่มในไฟล์อื่นของ seed จึงต้องตรงกับของเดิมด้วย ไม่งั้นข้อมูลชุดที่ได้จะไม่เหมือนกัน
/// </summary>
public sealed class SeedRandom(uint seed = 20261105)
{
    private uint _state = seed;

    public double Next()
    {
        unchecked
        {
            _state += 0x6d2b79f5;
            var t = _state;
            t = (t ^ (t >> 15)) * (t | 1);
            t ^= t + (t ^ (t >> 7)) * (t | 61);
            return (t ^ (t >> 14)) / 4294967296.0;
        }
    }

    /// <summary>จำนวนเต็มในช่วง [min, max] รวมปลายทั้งสองข้าง</summary>
    public int Int(int min, int max) => min + (int)Math.Floor(Next() * (max - min + 1));

    public T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(Next() * items.Count)];

    public bool Chance(double probability) => Next() < probability;

    /// <summary>สุ่มตามน้ำหนัก — คืนตำแหน่งที่ได้ หรือ −1 ถ้าน้ำหนักรวมเป็น 0 (ไม่มีใครมีสิทธิ์ถูกเลือก — ไม่เสียเลขสุ่ม)</summary>
    public int WeightedIndex<T>(IReadOnlyList<T> items, Func<T, double> weightOf)
    {
        var weights = new double[items.Count];
        var total = 0.0;
        for (var i = 0; i < items.Count; i += 1)
        {
            weights[i] = weightOf(items[i]);
            total += weights[i];
        }
        if (total <= 0) return -1;
        var roll = Next() * total;
        for (var i = 0; i < items.Count; i += 1)
        {
            roll -= weights[i];
            if (roll < 0) return i;
        }
        return items.Count - 1;
    }

    /// <summary>สุ่มตามน้ำหนัก — weightOf คืนค่า ≥ 0 (0 = ไม่มีสิทธิ์ถูกเลือก) · ไม่มีใครมีสิทธิ์ได้ null</summary>
    public T? Weighted<T>(IReadOnlyList<T> items, Func<T, double> weightOf) where T : class
    {
        var index = WeightedIndex(items, weightOf);
        return index < 0 ? null : items[index];
    }

    public List<T> Shuffle<T>(IReadOnlyList<T> items)
    {
        var copy = items.ToList();
        for (var i = copy.Count - 1; i > 0; i -= 1)
        {
            var j = (int)Math.Floor(Next() * (i + 1));
            (copy[i], copy[j]) = (copy[j], copy[i]);
        }
        return copy;
    }
}

/// <summary>เวลาแบบมิลลิวินาที (เหมือน Date ของ JS) — seed คำนวณเวลาเป็นตัวเลขทั้งหมด แล้วค่อยแปลงตอนเขียนลงฐาน</summary>
public static class SeedTime
{
    public const long Minute = 60 * 1000;
    public const long Hour = 60 * Minute;
    public const long Day = 24 * Hour;

    /// <summary>Math.round ของ JS — ปัดครึ่งขึ้นเสมอ (Math.Round ของ .NET ปัดครึ่งเข้าหาเลขคู่)</summary>
    public static double JsRound(double value)
    {
        var floor = Math.Floor(value);
        return value - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>new Date(Math.round(ms))</summary>
    public static DateTime At(double ms) => DateTimeOffset.FromUnixTimeMilliseconds((long)JsRound(ms)).UtcDateTime;

    public static long Ms(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    /// <summary>เวลาตอนนี้ตัดเหลือมิลลิวินาที (Date.now())</summary>
    public static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
