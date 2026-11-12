using CineBook.Web.Models.Entities;

namespace CineBook.Web.Utils;

/// <summary>
/// ที่นั่งในรูปที่เก็บลง Booking.seatSnapshot และ SeatChange.fromSeats/toSeats
/// ใช้ร่วมกันทั้งตอนจองและตอนเปลี่ยนที่นั่ง รูปแบบจึงตรงกันเสมอ
/// </summary>
public static class Seats
{
    public static string SeatLabel(string rowLabel, int seatNumber) => $"{rowLabel}{seatNumber}";

    public static string SeatLabel(Seat seat) => SeatLabel(seat.RowLabel, seat.SeatNumber);

    /// <summary>เรียงตามแถวแล้วตามเลขที่นั่ง (A1, A2, …, B1)</summary>
    public static List<Seat> SortSeats(IEnumerable<Seat> seats) =>
        seats.OrderBy(s => s.RowLabel, StringComparer.Ordinal).ThenBy(s => s.SeatNumber).ToList();

    /// <summary>ป้ายของที่นั่งใน snapshot (A1, A2, …) — ไม่มี snapshot ได้รายการว่าง</summary>
    public static List<string> SeatLabels(IEnumerable<SeatSnapshot>? seats) =>
        (seats ?? []).Select(seat => seat.Label).ToList();

    /// <summary>
    /// เทียบ id ให้ได้ลำดับคงที่ — ทุกรายการเขียนที่นั่งเรียงตามลำดับนี้
    /// สองรายการที่แย่งที่นั่งชุดเดียวกันจึงชนกันที่ที่นั่งแรกเหมือนกัน แทนที่จะรอกันเองจน deadlock
    /// (ordinal = ลำดับเดียวกับการเทียบสตริงด้วย &lt; ของ JavaScript)
    /// </summary>
    public static int CompareIds(string a, string b) => Math.Sign(string.CompareOrdinal(a, b));

    /// <summary>หนึ่งรายการใน seatSnapshot — price คือราคาที่ลูกค้าจ่ายจริงของที่นั่งนั้น</summary>
    public static SeatSnapshot SnapshotSeat(Seat seat, int price) =>
        new(seat.Id, seat.RowLabel, seat.SeatNumber, SeatLabel(seat), seat.Zone, price);
}
