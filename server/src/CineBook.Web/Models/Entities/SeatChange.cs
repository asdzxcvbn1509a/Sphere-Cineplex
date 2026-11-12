using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>
/// คำขอเปลี่ยนที่นั่งของการจองที่จ่ายแล้ว — หนึ่งแถวต่อหนึ่งครั้ง และเก็บไว้เป็นประวัติ (ใครย้าย จากไหนไปไหน ส่วนต่างเท่าไหร่)
/// ลูกค้าย้ายเองได้จำกัดครั้งต่อการจอง (นับจากตารางนี้) ส่วนผู้ดูแลย้ายแทนได้โดยไม่นับโควตา
/// </summary>
public class SeatChange : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    public string BookingId { get; set; } = "";
    public SeatChangeStatus Status { get; set; }
    /// <summary>seatSnapshot ก่อนและหลังย้าย — รูปแบบเดียวกับ Booking.SeatSnapshot</summary>
    public List<SeatSnapshot> FromSeats { get; set; } = [];
    public List<SeatSnapshot> ToSeats { get; set; } = [];
    public int FromAmount { get; set; }
    public int ToAmount { get; set; }
    /// <summary>toAmount − fromAmount: บวก = ลูกค้าโอนเพิ่ม · ลบ = คืนให้ลูกค้า · 0 = ย้ายฟรี</summary>
    public int DiffAmount { get; set; }
    /// <summary>นับถอยหลังเฉพาะตอนรอโอนส่วนต่าง — null = ไม่ได้นับ</summary>
    public DateTime? HoldExpiresAt { get; set; }
    /// <summary>เวลาที่คำขอปิดเป็น EXPIRED (หมดเวลาโอนส่วนต่าง หรือสลิปถูกปฏิเสธหลังรอบเริ่มฉาย) — เก็บไว้เป็นประวัติ</summary>
    public DateTime? ExpiredAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    /// <summary>เหตุผลที่ผู้ดูแลย้ายให้ (ลูกค้าเห็นในแจ้งเตือน)</summary>
    public string? Reason { get; set; }
    /// <summary>เหตุที่คำขอจบโดยไม่ได้ย้าย</summary>
    public string? CloseReason { get; set; }
    public bool ByAdmin { get; set; }
    public string? AdminId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Booking Booking { get; set; } = null!;
    public User? Admin { get; set; }
    /// <summary>ส่วนต่างที่ต้องโอนเพิ่มหรือคืน — ย้ายฟรีไม่มีรายการเงิน</summary>
    public Payment? Payment { get; set; }
    /// <summary>ที่นั่งใหม่ที่กันไว้ระหว่างรอโอนส่วนต่าง</summary>
    public List<BookingSeat> HeldSeats { get; set; } = [];
}
