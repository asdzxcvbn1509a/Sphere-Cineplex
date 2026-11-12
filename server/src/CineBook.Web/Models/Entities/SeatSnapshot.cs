using System.Text.Json.Serialization;

namespace CineBook.Web.Models.Entities;

/// <summary>
/// ที่นั่งหนึ่งที่ในรูปที่เก็บลง Booking.seatSnapshot, Payment.receiptSeats และ SeatChange.fromSeats/toSeats (jsonb)
/// price คือราคาที่ลูกค้าจ่ายจริงของที่นั่งนั้น — ใช้ร่วมกันทั้งตอนจองและตอนเปลี่ยนที่นั่ง รูปแบบจึงตรงกันเสมอ
///
/// ลำดับ key ใน JSON = ลำดับที่ jsonb ของ PostgreSQL เก็บ (key สั้นก่อน แล้วเรียงตามตัวอักษร)
/// API เดิมส่งค่าจาก jsonb ออกไปตรง ๆ จึงได้ลำดับนี้ — ตั้งไว้ให้ response เหมือนเดิมทุกไบต์
/// </summary>
public sealed record SeatSnapshot(
    [property: JsonPropertyOrder(0)] string Id,
    [property: JsonPropertyOrder(4)] string RowLabel,
    [property: JsonPropertyOrder(5)] int SeatNumber,
    [property: JsonPropertyOrder(2)] string Label,
    [property: JsonPropertyOrder(1)] SeatZone Zone,
    [property: JsonPropertyOrder(3)] int Price);
