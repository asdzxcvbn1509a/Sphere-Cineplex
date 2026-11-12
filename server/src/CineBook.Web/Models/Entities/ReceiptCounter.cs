namespace CineBook.Web.Models.Entities;

/// <summary>
/// ตัวนับเลขที่ใบเสร็จ แยกตามปี (ปี ค.ศ. ตามเวลาไทย) จึงขึ้นชุดใหม่ทุกปี
/// เพิ่มค่าใน transaction เดียวกับการอนุมัติสลิป ถ้าอนุมัติไม่สำเร็จค่าที่เพิ่มก็ย้อนกลับด้วย เลขจึงไม่ข้าม
/// (SEQUENCE ของ PostgreSQL ไม่ย้อนตาม rollback — ทุกครั้งที่อนุมัติไม่ผ่านจะมีเลขหายไปหนึ่งเลข)
/// </summary>
public class ReceiptCounter
{
    public int Year { get; set; }
    /// <summary>เลขล่าสุดที่ออกไปแล้วของปีนั้น</summary>
    public int LastNo { get; set; }
}
