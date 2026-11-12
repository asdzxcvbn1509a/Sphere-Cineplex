using CineBook.Web.Models.Entities;

namespace CineBook.Web.Models.Responses;

/// <summary>ข้อมูลใบเสร็จที่ส่งให้หน้าเว็บ (GET /api/bookings/:id/receipt) และใช้ทำอีเมลใบเสร็จ</summary>
public sealed record ReceiptResponse(
    string? ReceiptNo,
    PaymentKind Kind,
    DateTime? IssuedAt,
    ReceiptIssuer Issuer,
    ReceiptCustomer Customer,
    ReceiptBookingRef Booking,
    ReceiptShowtime Showtime,
    // บรรทัดมีสองรูป (SeatsReceiptLine / SeatChangeReceiptLine) — ประกาศเป็น object ให้ JSON เขียนตามชนิดจริงของแต่ละบรรทัด
    List<object> Lines,
    List<string>? SeatsChangedTo,
    int TotalAmount,
    string AmountTextTh,
    string AmountTextEn,
    ReceiptPayment Payment,
    ReceiptRefund? Refund);

public sealed record ReceiptIssuer(string Name, string? Address);

public sealed record ReceiptCustomer(string Name);

public sealed record ReceiptBookingRef(string Id, string Code, BookingStatus Status, string UserId);

public sealed record ReceiptShowtime(DateTime StartsAt, ReceiptMovie Movie, ReceiptTheatre Theatre);

public sealed record ReceiptMovie(string TitleTh, string TitleEn);

public sealed record ReceiptTheatre(string Name);

/// <summary>ที่นั่งโซนเดียวกันราคาเดียวกันรวมเป็นบรรทัดเดียว เช่น "พรีเมียม B1, B2 × 2"</summary>
public sealed record SeatsReceiptLine(string Kind, SeatZone Zone, int UnitPrice, int Quantity, int Amount, List<string> Seats);

/// <summary>ใบเสร็จส่วนต่างจากการเปลี่ยนที่นั่ง — บรรทัดเดียว บอกว่าย้ายจากที่นั่งไหนไปไหน</summary>
public sealed record SeatChangeReceiptLine(
    string Kind,
    List<string> FromSeats,
    List<string> ToSeats,
    int Quantity,
    int UnitPrice,
    int Amount);

public sealed record ReceiptPayment(string Method, string Reference);

public sealed record ReceiptRefund(PaymentStatus Status, DateTime? RefundedAt);
