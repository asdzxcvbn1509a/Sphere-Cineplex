using System.Text.Json.Serialization;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Models.Responses;

public sealed record BookingMovie(string Id, string TitleTh, string TitleEn, string PosterUrl, int DurationMin);

public sealed record BookingShowtime(DateTime StartsAt, DateTime EndsAt, BookingMovie Movie, ShowtimeTheatre Theatre)
{
    public string Id { get; init; } = "";
}

/// <summary>showtime ของการ์ดการจอง — { id, startsAt, endsAt, movie, theatre }</summary>
public sealed record BookingShowtimeInfo(string Id, DateTime StartsAt, DateTime EndsAt, BookingMovie Movie, ShowtimeTheatre Theatre);

/// <summary>ใบชำระเงินหลักบนการ์ดการจอง</summary>
public sealed record BookingPaymentInfo(
    string Id,
    PaymentStatus Status,
    int Amount,
    string Reference,
    // มีค่าเมื่อออกใบเสร็จแล้ว — หน้าเว็บใช้ตัดสินว่าจะแสดงปุ่มใบเสร็จไหม (รวมใบที่ยกเลิก/คืนเงินภายหลัง)
    string? ReceiptNo,
    DateTime? SlipUploadedAt,
    string? RefundBankName,
    string? RefundAccountNo,
    string? RefundAccountName,
    bool HasSlip,
    string? RejectReason,
    DateTime? RefundedAt,
    string? RefundNote,
    bool HasRefundSlip);

/// <summary>ผู้จองในรูปที่ผู้ดูแลใช้ติดต่อกลับ</summary>
public sealed record UserContact(string Id, string Name, string Phone);

public sealed record SeatChangePaymentInfo(
    string Id,
    PaymentKind Kind,
    PaymentStatus Status,
    int Amount,
    int? RefundAmount,
    string? ReceiptNo,
    string? RejectReason,
    string? RefundBankName,
    string? RefundAccountNo,
    string? RefundAccountName,
    DateTime? RefundedAt,
    string? RefundNote,
    bool HasRefundSlip);

public sealed record SeatChangeResponse(
    string Id,
    SeatChangeStatus Status,
    List<string> FromSeats,
    List<string> ToSeats,
    int FromAmount,
    int ToAmount,
    int DiffAmount,
    bool ByAdmin,
    string? Reason,
    string? CloseReason,
    DateTime? HoldExpiresAt,
    long? HoldSecondsLeft,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    SeatChangePaymentInfo? Payment);

public sealed record SeatChangeInfo(
    bool CanChange,
    string? BlockedReason,
    int ChangesLeft,
    int MaxChanges,
    int CutoffMinutes,
    SeatChangeResponse? Open,
    List<SeatChangeResponse> History);

/// <summary>
/// การจองหนึ่งใบ (shapeBooking เดิม) — user มีเฉพาะคำตอบแบบใบเดียวและฝั่งผู้ดูแล
/// displayStatus มีเฉพาะรายการฝั่งผู้ดูแล · ticketQr มีเฉพาะ E-Ticket
/// </summary>
public sealed record BookingResponse(
    string Id,
    string Code,
    BookingStatus Status,
    int TotalAmount,
    DateTime? HoldExpiresAt,
    long? HoldSecondsLeft,
    List<SeatSnapshot> Seats,
    DateTime CreatedAt,
    DateTime? PaidAt,
    DateTime? CancelledAt,
    DateTime? ExpiredAt,
    string? CancelReason,
    // ส่งสลิปได้เฉพาะตอนรอชำระ — หมดเวลาแล้วไม่รับอีก
    bool CanUploadSlip,
    bool CanCancel,
    int CancelCutoffHours,
    SeatChangeInfo SeatChange,
    BookingShowtimeInfo Showtime,
    BookingPaymentInfo? Payment,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] UserContact? User = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayStatus = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TicketQr = null);

/// <summary>ข้อมูลหน้าชำระเงินของผู้ใช้ (รวม payload สำหรับ render QR ฝั่ง client)</summary>
public sealed record PaymentPageResponse(
    string BookingId,
    string BookingCode,
    BookingStatus BookingStatus,
    int Amount,
    string Reference,
    string? QrPayload,
    string PromptPayId,
    string MerchantName,
    PaymentStatus Status,
    DateTime? SlipUploadedAt,
    bool HasSlip,
    string? RejectReason,
    DateTime? HoldExpiresAt,
    long? HoldSecondsLeft,
    bool CanUploadSlip);

public sealed record SeatChangeSummary(
    string Id,
    SeatChangeStatus Status,
    List<string> FromSeats,
    List<string> ToSeats,
    int DiffAmount,
    bool ByAdmin);

public sealed record QueueMovie(string TitleTh, string TitleEn, string PosterUrl);

public sealed record QueueTheatre(string Name);

public sealed record QueueShowtime(string Id, DateTime StartsAt, QueueMovie Movie, QueueTheatre Theatre);

public sealed record PersonRef(string Id, string Name);

/// <summary>การจองที่คิวสลิปแสดงคู่กับรายการเงิน — ชื่อผู้จอง เบอร์ติดต่อ และรอบที่จอง</summary>
public sealed record PaymentQueueBooking(
    string Id,
    string Code,
    BookingStatus Status,
    int TotalAmount,
    List<SeatSnapshot> Seats,
    UserContact User,
    QueueShowtime Showtime,
    DateTime CreatedAt);

public sealed record PaymentQueueItem(
    string Id,
    PaymentKind Kind,
    SeatChangeSummary? SeatChange,
    PaymentStatus Status,
    int Amount,
    string Reference,
    DateTime? SlipUploadedAt,
    bool HasSlip,
    string? RejectReason,
    DateTime? VerifiedAt,
    PersonRef? VerifiedBy,
    PaymentQueueBooking Booking);

/// <summary>การจองที่คิวคืนเงินแสดงคู่กับรายการเงิน</summary>
public sealed record RefundQueueBooking(
    string Id,
    string Code,
    BookingStatus Status,
    int TotalAmount,
    List<SeatSnapshot> Seats,
    UserContact User,
    QueueShowtime Showtime,
    DateTime? CancelledAt,
    string? CancelReason);

public sealed record RefundQueueItem(
    string Id,
    PaymentKind Kind,
    SeatChangeSummary? SeatChange,
    PaymentStatus Status,
    int Amount,
    // ยอดที่ต้องโอนคืนจริง — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
    int RefundAmount,
    string Reference,
    DateTime? PaidAt,
    // เวลาที่ลูกค้าส่งสลิปของเงินก้อนนี้ (ส่วนต่างที่คืนจากการย้ายไปที่ถูกกว่าไม่มีสลิป = null)
    DateTime? SlipUploadedAt,
    DateTime? RefundDueAt,
    DateTime? RefundedAt,
    PersonRef? RefundedBy,
    string? RefundNote,
    string? RefundBankName,
    string? RefundAccountNo,
    string? RefundAccountName,
    bool HasRefundSlip,
    RefundQueueBooking Booking);

public sealed record SeatChangeDetailMovie(string Id, string TitleTh, string TitleEn, string PosterUrl);

public sealed record SeatChangeDetailShowtime(string Id, DateTime StartsAt, SeatChangeDetailMovie Movie, ShowtimeTheatre Theatre);

public sealed record SeatChangeDetailBooking(string Id, string Code, BookingStatus Status, SeatChangeDetailShowtime Showtime);

/// <summary>รายการเงินของส่วนต่างบนหน้าชำระส่วนต่าง — รวม QR และสถานะสลิป</summary>
public sealed record SeatChangeDetailPayment(
    string Id,
    PaymentKind Kind,
    PaymentStatus Status,
    int Amount,
    int? RefundAmount,
    string? ReceiptNo,
    string? RejectReason,
    string? RefundBankName,
    string? RefundAccountNo,
    string? RefundAccountName,
    DateTime? RefundedAt,
    string? RefundNote,
    bool HasRefundSlip,
    string Reference,
    string? QrPayload,
    string PromptPayId,
    string MerchantName,
    DateTime? SlipUploadedAt,
    bool HasSlip);

public sealed record SeatChangeDetailResponse(
    string Id,
    SeatChangeStatus Status,
    List<string> FromSeats,
    List<string> ToSeats,
    int FromAmount,
    int ToAmount,
    int DiffAmount,
    bool ByAdmin,
    string? Reason,
    string? CloseReason,
    DateTime? HoldExpiresAt,
    long? HoldSecondsLeft,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    SeatChangeDetailPayment? Payment,
    bool CanUploadSlip,
    SeatChangeDetailBooking Booking);
