using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>
/// รายการเงินของการจอง — ใบหลัก (ค่าตั๋วตอนจอง) มีใบเดียวต่อการจอง
/// ส่วนต่างจากการเปลี่ยนที่นั่งเป็นรายการแยก เพื่อให้ใช้คิวตรวจสลิป คิวคืนเงิน และเลขที่ใบเสร็จชุดเดียวกัน
/// </summary>
public class Payment : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    /// <summary>การจองที่เป็นเจ้าของรายการนี้ — ทุกรายการเงินผูกกับการจองเสมอ (คิวของผู้ดูแลอ่านผ่านตัวนี้)</summary>
    public string BookingId { get; set; } = "";
    /// <summary>ตั้งเฉพาะใบหลัก (kind = BOOKING) — booking.Payment จึงยังชี้ใบหลักได้ตรง ๆ แบบหนึ่งต่อหนึ่ง</summary>
    public string? MainBookingId { get; set; }
    public PaymentKind Kind { get; set; } = PaymentKind.BOOKING;
    /// <summary>คำขอเปลี่ยนที่นั่งที่ทำให้เกิดรายการนี้ — ตั้งเฉพาะรายการส่วนต่าง</summary>
    public string? SeatChangeId { get; set; }
    public string Method { get; set; } = "PROMPTPAY";
    public int Amount { get; set; }
    /// <summary>รายการคืนส่วนต่างไม่มีเงินขาเข้า จึงไม่มี QR</summary>
    public string? QrPayload { get; set; }
    public string Reference { get; set; } = "";
    public string? SlipPath { get; set; }
    public DateTime? SlipUploadedAt { get; set; }
    public PaymentStatus Status { get; set; } = PaymentStatus.AWAITING_SLIP;
    public string? VerifiedById { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public string? RejectReason { get; set; }

    // ---------- ใบเสร็จรับเงิน ----------
    /// <summary>เลขที่ใบเสร็จ เช่น RC-2026-000123 — ออกตอนผู้ดูแลอนุมัติสลิปแล้วการจองเป็น PAID เท่านั้น</summary>
    public string? ReceiptNo { get; set; }
    /// <summary>สำเนาชื่อผู้จ่าย ณ ตอนออกใบเสร็จ — ผู้ใช้แก้ชื่อทีหลังได้ แต่ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม</summary>
    public string? ReceiptName { get; set; }
    /// <summary>สำเนาที่นั่ง ณ ตอนออกใบเสร็จ (ใบหลัก) — เปลี่ยนที่นั่งทีหลังได้ แต่ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม</summary>
    public List<SeatSnapshot>? ReceiptSeats { get; set; }

    // ---------- การคืนเงิน ----------
    // ระบบไม่ได้ตัดเงินเอง ผู้ดูแลโอนคืนผ่านแอปธนาคารแล้วมาบันทึกหลักฐานที่นี่
    public DateTime? RefundDueAt { get; set; }
    /// <summary>
    /// ยอดที่ต้องโอนคืน — ตั้งทุกครั้งที่เข้า REFUND_PENDING และอาจไม่เท่า amount
    /// (ยกเลิกการจองที่เคยเปลี่ยนที่นั่ง = ยอดสุทธิของการจอง ซึ่งรวมส่วนต่างที่จ่ายเพิ่มและหักส่วนที่คืนไปแล้ว)
    /// </summary>
    public int? RefundAmount { get; set; }
    /// <summary>บัญชีที่ลูกค้าแจ้งไว้ตอนยกเลิก เพื่อให้ผู้ดูแลโอนคืนได้ถูกบัญชี</summary>
    public string? RefundBankName { get; set; }
    public string? RefundAccountNo { get; set; }
    /// <summary>
    /// ชื่อเจ้าของบัญชี — ผู้ดูแลเทียบกับชื่อที่แอปธนาคารแสดงก่อนกดโอน (บัญชีอาจไม่ใช่ชื่อผู้จอง)
    /// ไม่บังคับ: รายการก่อนมีช่องนี้ และ client รุ่นเก่าที่ยังไม่ส่งมา
    /// </summary>
    public string? RefundAccountName { get; set; }
    public DateTime? RefundedAt { get; set; }
    public string? RefundedById { get; set; }
    public string? RefundSlipPath { get; set; }
    public string? RefundNote { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Booking Booking { get; set; } = null!;
    public Booking? MainOf { get; set; }
    public SeatChange? SeatChange { get; set; }
    public User? VerifiedBy { get; set; }
    public User? RefundedBy { get; set; }
}
