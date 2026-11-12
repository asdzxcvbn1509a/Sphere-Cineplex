namespace CineBook.Web.Infrastructure;

public static class Clock
{
    /// <summary>
    /// เวลาปัจจุบันแบบ UTC ตัดเหลือระดับมิลลิวินาที — คอลัมน์เวลาเป็น timestamp(3) และ Date ของ JavaScript เดิมก็ละเอียดแค่นั้น
    /// ไม่ตัดไว้ก่อน ค่าที่อยู่ในหน่วยความจำ (เช่น response ของคำขอที่เพิ่งสร้าง) จะไม่ตรงกับค่าที่อ่านกลับจากฐาน
    /// </summary>
    public static DateTime UtcNowMs(this TimeProvider time) => TruncateToMs(time.GetUtcNow().UtcDateTime);

    public static DateTime TruncateToMs(DateTime value) =>
        new(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
}
