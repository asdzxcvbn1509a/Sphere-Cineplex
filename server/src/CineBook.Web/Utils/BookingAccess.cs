using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Utils;

/// <summary>
/// error ของการเข้าถึงการจองที่ทุก service ตอบเหมือนกัน
/// ข้อความของ NOT_BOOKING_OWNER บอกว่าทำอะไรไม่ได้ (ยกเลิก แก้ไข ดูสลิป ฯลฯ) จึงให้แต่ละจุดส่งข้อความของตัวเองมา
/// </summary>
public static class BookingAccess
{
    public static ApiException BookingNotFound() => ApiException.NotFound("BOOKING_NOT_FOUND", "ไม่พบรายการจองนี้");

    public static ApiException SeatChangeNotFound() =>
        ApiException.NotFound("SEAT_CHANGE_NOT_FOUND", "ไม่พบคำขอเปลี่ยนที่นั่งนี้");

    public static ApiException NotBookingOwner(string message = "ไม่มีสิทธิ์เข้าถึงรายการจองนี้") =>
        ApiException.Forbidden("NOT_BOOKING_OWNER", message);

    /// <summary>เป็นเจ้าของการจอง หรือเป็นผู้ดูแล (เปิดดูของลูกค้าได้ทุกรายการ)</summary>
    public static bool CanAccessBooking(CurrentUser requester, string ownerId) =>
        requester.Role == Role.ADMIN || ownerId == requester.Id;
}
