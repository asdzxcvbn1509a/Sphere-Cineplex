namespace CineBook.Web.Models.Entities;

/// <summary>แถวที่มี createdAt — ตัวดักตอนบันทึก (Data/TimestampInterceptor) เติมให้ถ้าโค้ดไม่ได้ตั้งเอง</summary>
public interface ICreatedAt
{
    DateTime CreatedAt { get; set; }
}

/// <summary>แถวที่มี updatedAt แบบ @updatedAt ของ Prisma — ตั้งใหม่ทุกครั้งที่บันทึกการแก้ไข</summary>
public interface ITimestamped : ICreatedAt
{
    DateTime UpdatedAt { get; set; }
}
