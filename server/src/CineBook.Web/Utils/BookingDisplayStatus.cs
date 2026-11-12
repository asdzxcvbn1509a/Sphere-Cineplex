using System.Linq.Expressions;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Utils;

/// <summary>
/// สถานะที่หน้า "การจอง" ของผู้ดูแลแสดงเป็นป้ายและใช้กรอง — ละเอียดกว่าสถานะของการจองเอง
/// เรื่องเงินที่ยังค้าง (ส่วนต่างเปลี่ยนที่นั่ง เงินที่รอโอนคืน) ไม่ได้ทำให้สถานะการจองเปลี่ยน
/// แต่ผู้ดูแลต้องเห็นจากตารางเลยว่าใบนี้รออะไรอยู่ โดยไม่ต้องเปิดดูทีละใบ
///
/// กฎเรียงตามลำดับ ข้อแรกที่ตรงชนะ: ลูกค้าต้องจ่าย → สลิปรอตรวจ → เงินรอโอนคืน → คืนแล้ว → สถานะของการจอง
/// แต่ละข้อเขียนเงื่อนไขไว้สองแบบติดกัน — Matches ใช้กับแถวที่โหลดมาแล้ว (ป้ายในตาราง) · Where ใช้กรองในฐานข้อมูล
/// สองแบบต้องตรงกันเสมอ ไม่งั้นเลือกตัวกรองแล้วจะได้แถวที่ป้ายไม่ตรงกับที่เลือก (integration test ตรวจทุกค่า)
/// </summary>
public static class BookingDisplayStatus
{
    private sealed record Rule(string Status, Func<Booking, bool> Matches, Expression<Func<Booking, bool>> Where);

    /// <summary>รายการเงินทั้งหมดของการจอง = ใบหลัก + ส่วนต่างของคำขอเปลี่ยนที่นั่ง (ชุดเดียวกับ relation Payments ใน Where)</summary>
    private static IEnumerable<Payment> PaymentsOf(Booking booking)
    {
        if (booking.Payment is not null) yield return booking.Payment;
        foreach (var change in booking.SeatChanges ?? [])
        {
            if (change.Payment is not null) yield return change.Payment;
        }
    }

    private static bool HasPayment(Booking booking, Func<Payment, bool> predicate) => PaymentsOf(booking).Any(predicate);

    /// <summary>ป้ายที่มาจากสถานะของการจองตรง ๆ</summary>
    private static Rule ByBookingStatus(BookingStatus status) =>
        new(status.ToString(), booking => booking.Status == status, booking => booking.Status == status);

    /// <summary>
    /// มีเงินรอโอนคืน — แยกป้ายตามสถานะการจอง
    /// ใบที่ยังใช้ได้ (PAID) ใบหลักยัง APPROVED อยู่ เงินที่รอคืนจึงเป็นส่วนต่างเปลี่ยนที่นั่งเสมอ
    /// </summary>
    private static Rule RefundPending(string status, BookingStatus bookingStatus) =>
        new(
            status,
            booking => booking.Status == bookingStatus && HasPayment(booking, p => p.Status == PaymentStatus.REFUND_PENDING),
            booking => booking.Status == bookingStatus && booking.Payments.Any(p => p.Status == PaymentStatus.REFUND_PENDING));

    private static readonly Rule[] Rules =
    [
        ByBookingStatus(BookingStatus.PENDING_PAYMENT),
        ByBookingStatus(BookingStatus.PENDING_VERIFICATION),
        new(
            "TOPUP_PENDING_PAYMENT",
            booking => booking.Status == BookingStatus.PAID &&
                (booking.SeatChanges ?? []).Any(c => c.Status == SeatChangeStatus.PENDING_PAYMENT),
            booking => booking.Status == BookingStatus.PAID &&
                booking.SeatChanges.Any(c => c.Status == SeatChangeStatus.PENDING_PAYMENT)),
        // สลิปส่วนต่างเปลี่ยนที่นั่งรอผู้ดูแลตรวจ (การจองยัง PAID ระหว่างนั้น)
        new(
            "TOPUP_PENDING_VERIFICATION",
            booking => HasPayment(booking,
                p => p.Kind == PaymentKind.SEAT_CHANGE_TOPUP && p.Status == PaymentStatus.PENDING_VERIFICATION),
            booking => booking.Payments.Any(
                p => p.Kind == PaymentKind.SEAT_CHANGE_TOPUP && p.Status == PaymentStatus.PENDING_VERIFICATION)),
        RefundPending("DIFF_REFUND_PENDING", BookingStatus.PAID),
        RefundPending("CANCELLED_REFUND_PENDING", BookingStatus.CANCELLED),
        // โอนคืนครบแล้ว — ใบที่ปิดไปแล้ว หรือใบที่ยังใช้ได้แต่คืนส่วนต่างเปลี่ยนที่นั่งไปแล้ว (ใบนี้ยังยกเลิกได้ตามปกติ)
        new(
            "REFUNDED",
            booking => HasPayment(booking, p => p.Status == PaymentStatus.REFUNDED),
            booking => booking.Payments.Any(p => p.Status == PaymentStatus.REFUNDED)),
        ByBookingStatus(BookingStatus.PAID),
        ByBookingStatus(BookingStatus.CANCELLED),
        ByBookingStatus(BookingStatus.EXPIRED),
    ];

    /// <summary>ค่าที่เป็นไปได้ทั้งหมด (เรียงตามลำดับกฎ) — ใช้ตรวจ query ของ GET /api/admin/bookings</summary>
    public static readonly IReadOnlyList<string> All = Rules.Select(rule => rule.Status).ToList();

    /// <summary>booking ต้องโหลด Payment และ SeatChanges.Payment มาแล้ว</summary>
    public static string Of(Booking booking) =>
        Rules.FirstOrDefault(rule => rule.Matches(booking))?.Status ?? booking.Status.ToString();

    /// <summary>เงื่อนไขในฐานข้อมูลของป้ายนี้ = ตรงกฎของตัวเอง และไม่ตรงกฎข้อไหนที่มาก่อน</summary>
    public static Expression<Func<Booking, bool>> Where(string status)
    {
        var index = Array.FindIndex(Rules, rule => rule.Status == status);
        if (index == -1) throw new ArgumentException($"Unknown booking display status: {status}", nameof(status));
        var where = Rules[index].Where;
        foreach (var earlier in Rules.Take(index)) where = where.And(earlier.Where.Not());
        return where;
    }

    /// <summary>
    /// ตรงป้ายใดป้ายหนึ่งในรายการ — ตัวกรองของหน้าการจองส่งมาเป็นกลุ่ม (เช่น "ที่ต้องชำระ" = รอชำระเงิน + รอชำระส่วนต่าง)
    /// ป้ายของแต่ละใบมีได้ป้ายเดียว เงื่อนไขของแต่ละป้ายจึงไม่ทับกัน OR กันได้ตรง ๆ
    /// </summary>
    public static Expression<Func<Booking, bool>> AnyWhere(IEnumerable<string> statuses) =>
        Predicates.AnyOf(statuses.Distinct().Select(Where).ToList());
}
