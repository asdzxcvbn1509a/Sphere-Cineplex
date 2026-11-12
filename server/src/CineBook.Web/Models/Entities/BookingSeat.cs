using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>
/// ที่นั่งที่ถูกจอง — unique (showtimeId, seatId) คือด่านกันจองซ้ำระดับฐานข้อมูล
/// เมื่อ booking ถูกยกเลิก/หมดอายุ แถวเหล่านี้จะถูกลบเพื่อคืนที่นั่งเข้าระบบ
/// </summary>
public class BookingSeat
{
    public string Id { get; set; } = Cuid.New();
    public string BookingId { get; set; } = "";
    public string ShowtimeId { get; set; } = "";
    public string SeatId { get; set; } = "";
    public int Price { get; set; }
    /// <summary>
    /// ไม่ว่าง = ที่นั่งใหม่ที่กันไว้ให้คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง (ยังไม่ใช่ที่นั่งของการจองจริง)
    /// ย้ายสำเร็จแล้วค่าจะถูกล้างเป็น null ส่วนคำขอที่ไม่สำเร็จแถวจะถูกลบทิ้ง
    /// </summary>
    public string? SeatChangeId { get; set; }

    public Booking Booking { get; set; } = null!;
    public Showtime Showtime { get; set; } = null!;
    public Seat Seat { get; set; } = null!;
    public SeatChange? SeatChange { get; set; }
}
