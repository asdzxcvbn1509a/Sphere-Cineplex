using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Utils;

public sealed record SeatChangePlan(
    List<SeatSnapshot> ToSeats,
    int FromAmount,
    int ToAmount,
    int DiffAmount,
    List<(string SeatId, int Price)> Added,
    List<string> Released);

/// <summary>
/// คำนวณการเปลี่ยนที่นั่ง — ส่วนที่ไม่แตะฐานข้อมูล เทสต์ได้ตรง ๆ (ตรวจสิทธิ์ ล็อก และบันทึกอยู่ที่ Services/SeatChangeService)
/// หน้าเว็บมีสำเนากติการาคาชุดเดียวกันไว้แสดงส่วนต่างก่อนกดยืนยัน (client/src/utils/seatChange.js) — แก้ที่นี่ต้องแก้ที่นั่นด้วย
///
/// กติการาคา
/// - ที่นั่งที่คงไว้ ใช้รายการเดิมใน snapshot ทั้งก้อน (ราคาที่จ่ายไว้)
/// - ที่นั่งใหม่ในโซนที่ลูกค้ามีอยู่แล้ว คิดราคาที่จ่ายไว้ของโซนนั้น → ย้ายในโซนเดิมฟรีเสมอ แม้ผู้ดูแลจะปรับราคารอบภายหลัง
/// - ที่นั่งใหม่ในโซนที่ยังไม่มี คิดราคาปัจจุบันของรอบ
/// ส่วนต่าง = ยอดใหม่ − ยอดเดิม (บวก = ลูกค้าโอนเพิ่ม · ลบ = คืนให้ลูกค้า)
/// </summary>
public static class SeatChangePlanner
{
    /// <param name="fromSeats">seatSnapshot ปัจจุบันของการจอง</param>
    /// <param name="newSeats">แถว Seat ของชุดใหม่ทั้งหมด (รวมที่นั่งที่คงไว้) — ไม่ซ้ำกัน</param>
    /// <param name="priceMap">ราคาปัจจุบันของรอบต่อโซน (Pricing.ToPriceMap)</param>
    public static SeatChangePlan Plan(
        IReadOnlyList<SeatSnapshot> fromSeats,
        IReadOnlyList<Seat> newSeats,
        IReadOnlyDictionary<SeatZone, int> priceMap)
    {
        if (newSeats.Count != fromSeats.Count)
        {
            throw ApiException.BadRequest(
                "SEAT_COUNT_MISMATCH",
                $"ต้องเลือกที่นั่งให้ครบ {fromSeats.Count} ที่ เท่ากับที่จองไว้",
                new { required = fromSeats.Count });
        }

        var fromById = new Dictionary<string, SeatSnapshot>();
        foreach (var seat in fromSeats) fromById[seat.Id] = seat;
        var newIds = newSeats.Select(seat => seat.Id).ToHashSet();
        var released = fromSeats.Where(seat => !newIds.Contains(seat.Id)).Select(seat => seat.Id).ToList();
        // จำนวนเท่ากันและไม่มีที่นั่งไหนถูกปล่อย = ชุดเดิมทุกที่
        if (released.Count == 0)
        {
            throw ApiException.BadRequest("NO_SEAT_CHANGE", "ที่นั่งที่เลือกเป็นชุดเดิม ยังไม่ได้เปลี่ยนที่นั่ง");
        }

        // หนึ่งการจองมีราคาเดียวต่อโซนเสมอ (ทั้งตอนจองและหลังเปลี่ยนที่นั่ง) จึงหยิบราคาแรกที่เจอของแต่ละโซนได้เลย
        var paidByZone = new Dictionary<SeatZone, int>();
        foreach (var seat in fromSeats) paidByZone.TryAdd(seat.Zone, seat.Price);

        var toSeats = Seats.SortSeats(newSeats)
            .Select(seat => fromById.TryGetValue(seat.Id, out var kept)
                ? kept
                : Seats.SnapshotSeat(seat, paidByZone.TryGetValue(seat.Zone, out var paid) ? paid : priceMap[seat.Zone]))
            .ToList();
        // บันทึกที่นั่งใหม่เรียงตาม id เสมอ แบบเดียวกับตอนจอง — สองรายการที่แย่งที่นั่งชุดเดียวกันจะชนกันที่ที่นั่งแรกเหมือนกัน
        // แทนที่จะรอกันเองจนเกิด deadlock
        var added = toSeats
            .Where(seat => !fromById.ContainsKey(seat.Id))
            .Select(seat => (SeatId: seat.Id, seat.Price))
            .OrderBy(item => item.SeatId, StringComparer.Ordinal)
            .ToList();

        var fromAmount = fromSeats.Sum(seat => seat.Price);
        var toAmount = toSeats.Sum(seat => seat.Price);
        return new SeatChangePlan(toSeats, fromAmount, toAmount, toAmount - fromAmount, added, released);
    }

    /// <summary>สองชุดมีโซนตรงกันครบทุกที่ (ไม่สนลำดับ) — ผู้ดูแลย้ายแทนได้เฉพาะแบบนี้ จึงไม่มีส่วนต่างราคา</summary>
    public static bool SameZones(IEnumerable<SeatSnapshot> a, IEnumerable<SeatSnapshot> b)
    {
        static string Zones(IEnumerable<SeatSnapshot> seats) =>
            string.Join(',', seats.Select(seat => seat.Zone.ToString()).OrderBy(z => z, StringComparer.Ordinal));
        return Zones(a) == Zones(b);
    }
}
