using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;

namespace CineBook.Web.Services;

/// <summary>
/// กติกาและรูปข้อมูลของการเปลี่ยนที่นั่งที่หลาย service ใช้ร่วมกัน
/// BookingService (การ์ดการจอง, ด่านยกเลิก) · SeatChangeService (ด่านขอเปลี่ยน) · PaymentService (คิวสลิปและคืนเงิน)
/// ไม่แตะฐานข้อมูล — แยกไฟล์ออกมาเพื่อไม่ให้ service ต้องพึ่งกันเป็นวง
/// </summary>
public static class SeatChangeRules
{
    /// <summary>คำขอเปลี่ยนที่นั่งที่ยังไม่จบ — การจองหนึ่งใบมีได้ทีละหนึ่งคำขอ</summary>
    public static readonly SeatChangeStatus[] OpenStatuses = [SeatChangeStatus.PENDING_PAYMENT, SeatChangeStatus.PENDING_VERIFICATION];

    /// <summary>คำขอที่ยังไม่จบของการจองนี้ (ไม่มี = null)</summary>
    public static SeatChange? OpenSeatChange(IEnumerable<SeatChange>? changes) =>
        (changes ?? []).FirstOrDefault(change => OpenStatuses.Contains(change.Status));

    /// <summary>คำขอที่นับโควตาของลูกค้า — หมดเวลา/ยกเลิกไม่นับเพราะไม่ได้ย้ายจริง ส่วนที่ผู้ดูแลย้ายให้ก็ไม่นับ</summary>
    public static bool CountsTowardQuota(SeatChange change) =>
        !change.ByAdmin && (OpenStatuses.Contains(change.Status) || change.Status == SeatChangeStatus.COMPLETED);

    /// <summary>ใช้โควตาเปลี่ยนที่นั่งไปแล้วกี่ครั้ง</summary>
    public static int Used(IEnumerable<SeatChange>? changes) => (changes ?? []).Count(CountsTowardQuota);

    /// <summary>
    /// ลูกค้าเปลี่ยนที่นั่งเองได้ตอนนี้ไหม — คืน null ถ้าได้ หรือรหัสเหตุผลที่ไม่ได้
    /// ใช้ทั้งตัดสินว่าหน้าเว็บจะโชว์ปุ่มไหม และเป็นด่านแรกของการขอเปลี่ยน (ด่านจริงอยู่ใน transaction อีกชั้น)
    /// booking ต้องโหลด Showtime และ SeatChanges มาแล้ว
    /// </summary>
    public static string? Blocker(Booking booking, AppConfig config, DateTime now)
    {
        if (booking.Status != BookingStatus.PAID) return "NOT_PAID";
        if (booking.Showtime.Status != ShowtimeStatus.SCHEDULED) return "SHOWTIME_CANCELLED";
        if (booking.Showtime.StartsAt - now < TimeSpan.FromMinutes(config.SeatChangeCutoffMinutes)) return "WINDOW_CLOSED";
        if (OpenSeatChange(booking.SeatChanges) is not null) return "PENDING";
        if (Used(booking.SeatChanges) >= config.MaxSeatChangesPerBooking) return "LIMIT";
        return null;
    }

    /// <summary>รายการเงินของส่วนต่าง — ลูกค้าเห็นสถานะโอนเพิ่ม/รอคืน และเปิดใบเสร็จหรือสลิปคืนเงินได้</summary>
    private static SeatChangePaymentInfo ShapePayment(Payment payment) => new(
        payment.Id,
        payment.Kind,
        payment.Status,
        payment.Amount,
        payment.RefundAmount,
        payment.ReceiptNo,
        payment.RejectReason,
        payment.RefundBankName,
        payment.RefundAccountNo,
        payment.RefundAccountName,
        payment.RefundedAt,
        payment.RefundNote,
        payment.RefundSlipPath is not null);

    public static SeatChangeResponse Shape(SeatChange change, DateTime now) => new(
        change.Id,
        change.Status,
        Seats.SeatLabels(change.FromSeats),
        Seats.SeatLabels(change.ToSeats),
        change.FromAmount,
        change.ToAmount,
        change.DiffAmount,
        change.ByAdmin,
        change.Reason,
        change.CloseReason,
        change.HoldExpiresAt,
        SlipService.HoldSecondsLeft(change.HoldExpiresAt, now),
        change.CreatedAt,
        change.CompletedAt,
        change.Payment is null ? null : ShapePayment(change.Payment));

    /// <summary>ส่วนเปลี่ยนที่นั่งของการ์ดการจอง — ปุ่มเปลี่ยนที่นั่ง โควตาที่เหลือ คำขอที่ค้าง และประวัติ</summary>
    public static SeatChangeInfo Info(Booking booking, AppConfig config, DateTime now)
    {
        var changes = booking.SeatChanges ?? [];
        var blocked = Blocker(booking, config, now);
        var open = OpenSeatChange(changes);
        return new SeatChangeInfo(
            blocked is null,
            blocked,
            Math.Max(config.MaxSeatChangesPerBooking - Used(changes), 0),
            config.MaxSeatChangesPerBooking,
            config.SeatChangeCutoffMinutes,
            open is null ? null : Shape(open, now),
            changes.Select(change => Shape(change, now)).ToList());
    }

    /// <summary>สรุปคำขอเปลี่ยนที่นั่งของรายการส่วนต่าง ให้ผู้ดูแลเห็นว่าเงินก้อนนี้ย้ายจากที่นั่งไหนไปไหน</summary>
    public static SeatChangeSummary? Summary(SeatChange? change) => change is null
        ? null
        : new SeatChangeSummary(
            change.Id, change.Status, Seats.SeatLabels(change.FromSeats), Seats.SeatLabels(change.ToSeats), change.DiffAmount, change.ByAdmin);
}
