using System.Text.Json;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Models.Entities;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>
/// ล็อกแถวและ error ของการเขียนพร้อมกัน — ใช้ร่วมกันทั้งการจอง การเปลี่ยนที่นั่ง และการตรวจสลิป
///
/// ลำดับล็อกทั้งระบบ: Showtime (FOR SHARE) → Booking → SeatChange → BookingSeat → Payment → ReceiptCounter
/// ทุกรายการล็อกตามลำดับนี้ และเขียนที่นั่งเรียงตาม id เสมอ สองรายการที่ชนกันจึงต่อคิวกัน ไม่รอกันเองจน deadlock
///
/// การเปลี่ยนสถานะทุกจุดเป็น compare-and-set — ใส่สถานะที่คาดไว้ใน where แล้วเช็กว่าโดนแถวจริง (ExecuteUpdateAsync คืนจำนวนแถว)
/// ไม่ได้อ่านมาเช็กก่อนแล้วค่อยเขียนทับ ถ้าอีกรายการชิงเปลี่ยนไปก่อน ฝั่งที่ช้ากว่าได้ 409 และ transaction ถูกยกเลิกทั้งก้อน
/// </summary>
public static class Locks
{
    /// <summary>
    /// ล็อกแถวรอบฉายแบบแชร์ไว้จนจบ transaction แล้วคืนสถานะล่าสุด (ไม่พบ = null)
    /// การจองหลายรายการถือล็อกแบบแชร์พร้อมกันได้ ส่วนการยกเลิกทั้งรอบต้องรอให้ทุกรายการจบก่อน
    /// </summary>
    public static async Task<ShowtimeStatus?> LockShowtimeAsync(AppDbContext db, string showtimeId)
    {
        var status = await Sql.ScalarAsync(
            db, "SELECT \"status\"::text FROM \"Showtime\" WHERE \"id\" = @id FOR SHARE", Sql.P("id", showtimeId));
        return status is string value ? Enum.Parse<ShowtimeStatus>(value) : null;
    }

    public sealed record LockedBooking(BookingStatus Status, List<SeatSnapshot> SeatSnapshot);

    /// <summary>
    /// ล็อกแถวการจองไว้จนจบ transaction แล้วคืนสถานะและที่นั่งล่าสุด (ไม่พบ = null)
    /// สองรายการที่แก้การจองเดียวกันพร้อมกันต่อคิวกันตรงนี้ รายการที่ช้ากว่าจึงเห็นสิ่งที่อีกรายการเพิ่งเขียนไป
    /// </summary>
    public static Task<LockedBooking?> LockBookingAsync(AppDbContext db, string bookingId) =>
        Sql.FirstOrDefaultAsync(
            db,
            "SELECT \"status\"::text, \"seatSnapshot\"::text FROM \"Booking\" WHERE \"id\" = @id FOR UPDATE",
            reader => new LockedBooking(
                Enum.Parse<BookingStatus>(reader.GetString(0)),
                JsonSerializer.Deserialize<List<SeatSnapshot>>(reader.GetString(1), JsonDefaults.Storage) ?? []),
            Sql.P("id", bookingId));

    /// <summary>ชนกับ unique (showtimeId, seatId) ของ BookingSeat = มีคนจองที่นั่งนั้นตัดหน้าไปแล้ว</summary>
    public static bool IsSeatConflict(Exception error) => ApiExceptionMiddleware.IsConstraint(error, AppDbContext.SeatUniqueConstraint);

    /// <summary>409 SEAT_TAKEN พร้อมบอกว่าที่นั่งไหนโดนตัดหน้าไป — ใช้ทั้งตอนจองและตอนเปลี่ยนที่นั่ง</summary>
    public static async Task<ApiException> SeatTakenErrorAsync(AppDbContext db, string showtimeId, IReadOnlyCollection<string> seatIds)
    {
        var ids = seatIds.ToList();
        var taken = await db.BookingSeats.AsNoTracking()
            .Where(bs => bs.ShowtimeId == showtimeId && ids.Contains(bs.SeatId))
            .Select(bs => bs.Seat)
            .ToListAsync();
        return ApiException.Conflict(
            "SEAT_TAKEN",
            "มีผู้อื่นจองที่นั่งนี้ไปก่อนแล้ว กรุณาเลือกที่นั่งใหม่",
            new { seats = Seats.SortSeats(taken).Select(Seats.SeatLabel).ToList() });
    }

    /// <summary>สถานะเปลี่ยนไประหว่างที่กำลังทำรายการ (อีกคนกดก่อน, หมดเวลาพอดี) — ให้ผู้ใช้รีเฟรชแล้วดูใหม่</summary>
    public static ApiException BookingStateChanged() =>
        ApiException.Conflict("BOOKING_STATE_CHANGED", "สถานะการจองเปลี่ยนไประหว่างทำรายการ กรุณารีเฟรชหน้าจอแล้วลองใหม่");

    /// <summary>สลิปถูกตรวจไปแล้ว หรือรายการที่ผูกอยู่เปลี่ยนสถานะไปก่อน (ผู้ดูแลสองคนกดพร้อมกัน, มีคนยกเลิกไปก่อนเสี้ยววินาที)</summary>
    public static ApiException PaymentNotPending() =>
        ApiException.Conflict("PAYMENT_NOT_PENDING", "รายการนี้ถูกตรวจสอบหรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ");
}
