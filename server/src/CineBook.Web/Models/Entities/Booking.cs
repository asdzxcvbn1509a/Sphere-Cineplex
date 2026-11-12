using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class Booking : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    public string Code { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ShowtimeId { get; set; } = "";
    public BookingStatus Status { get; set; } = BookingStatus.PENDING_PAYMENT;
    public int TotalAmount { get; set; }
    /// <summary>null = หยุดนับถอยหลัง (เช่น ระหว่างรอ admin ตรวจสลิป) หรือจบสถานะแล้ว</summary>
    public DateTime? HoldExpiresAt { get; set; }
    /// <summary>สำเนาที่นั่ง ณ เวลาที่จอง ใช้แสดงประวัติหลัง BookingSeat ถูกลบตอนยกเลิก</summary>
    public List<SeatSnapshot> SeatSnapshot { get; set; } = [];
    public string? CancelReason { get; set; }
    public DateTime? ReminderSentAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    /// <summary>เวลาที่การจองปิดเป็น EXPIRED (หมดเวลาชำระ หรือสลิปถูกปฏิเสธหลังรอบเริ่มฉาย) — เก็บไว้เป็นประวัติ</summary>
    public DateTime? ExpiredAt { get; set; }

    public User User { get; set; } = null!;
    public Showtime Showtime { get; set; } = null!;
    public List<BookingSeat> Seats { get; set; } = [];
    /// <summary>ค่าตั๋วตอนจอง — ใบหลักที่หน้าชำระเงิน การยกเลิก และใบเสร็จอ้างถึง</summary>
    public Payment? Payment { get; set; }
    /// <summary>ทุกรายการเงินของการจองนี้ (ใบหลัก + ส่วนต่างจากการเปลี่ยนที่นั่ง)</summary>
    public List<Payment> Payments { get; set; } = [];
    public List<SeatChange> SeatChanges { get; set; } = [];
}
