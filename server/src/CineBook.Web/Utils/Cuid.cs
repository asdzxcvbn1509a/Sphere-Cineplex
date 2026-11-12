using System.Security.Cryptography;

namespace CineBook.Web.Utils;

/// <summary>
/// id แบบ cuid (ขึ้นต้นด้วย c ยาว 25 ตัว ตัวพิมพ์เล็กกับตัวเลข) แบบเดียวกับที่ Prisma สร้างให้แถวเดิมทั้งหมด
/// หน้าเว็บถือ id เป็นสตริงทึบ ๆ แต่ให้หน้าตาเหมือนเดิม แถวใหม่กับแถวเก่าในฐานเดียวกันจะได้ไม่ดูต่างกัน
/// ส่วนหน้าเป็นเวลา (base36) id ที่สร้างทีหลังจึงมักเรียงต่อท้าย — ไม่มีโค้ดไหนพึ่งลำดับนี้ ใช้แค่เป็นกุญแจเรียงที่คงที่
/// </summary>
public static class Cuid
{
    private const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    private const int BlockSize = 4;
    private const int Base = 36;
    private static readonly long DiscreteValues = (long)Math.Pow(Base, BlockSize);
    private static long _counter = RandomNumberGenerator.GetInt32(int.MaxValue) % DiscreteValues;
    private static readonly string Fingerprint = BuildFingerprint();

    public static string New()
    {
        var timestamp = ToBase36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var count = Pad(ToBase36(NextCounter()), BlockSize);
        var random = RandomBlock() + RandomBlock();
        return $"c{timestamp}{count}{Fingerprint}{random}";
    }

    private static long NextCounter()
    {
        var next = Interlocked.Increment(ref _counter);
        return ((next % DiscreteValues) + DiscreteValues) % DiscreteValues;
    }

    private static string RandomBlock() =>
        Pad(ToBase36(RandomNumberGenerator.GetInt32((int)DiscreteValues)), BlockSize);

    private static string BuildFingerprint()
    {
        var pid = Environment.ProcessId;
        var host = Environment.MachineName;
        var hostSum = host.Aggregate(host.Length + Base, (sum, ch) => sum + ch);
        return Pad(ToBase36(pid), 2) + Pad(ToBase36(hostSum), 2);
    }

    private static string ToBase36(long value)
    {
        if (value == 0) return "0";
        Span<char> buffer = stackalloc char[16];
        var index = buffer.Length;
        while (value > 0)
        {
            buffer[--index] = Alphabet[(int)(value % Base)];
            value /= Base;
        }
        return new string(buffer[index..]);
    }

    /// <summary>เติมศูนย์ข้างหน้าแล้วตัดเหลือ size ตัวท้าย (แบบ cuid ต้นฉบับ)</summary>
    private static string Pad(string value, int size)
    {
        var padded = value.PadLeft(size, '0');
        return padded[^size..];
    }
}
