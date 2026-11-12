using CineBook.Web.Models.Entities;

namespace CineBook.Web.Utils;

/// <summary>
/// คิดราคาที่นั่งจากราคาโซนของรอบฉายนั้น
/// ถ้าโซนไหนไม่ได้กำหนดราคาไว้ ให้ตกกลับไปใช้ basePrice ของรอบ
/// </summary>
public static class Pricing
{
    /// <summary>ตัวคูณราคาต่อโซน ใช้ตอนสร้างรอบฉายเพื่อ generate ZonePrice อัตโนมัติ</summary>
    public static readonly IReadOnlyDictionary<SeatZone, double> ZoneMultiplier = new Dictionary<SeatZone, double>
    {
        [SeatZone.NORMAL] = 1,
        [SeatZone.PREMIUM] = 1.4,
        [SeatZone.SOFA] = 2.2,
    };

    public static readonly IReadOnlyList<SeatZone> SeatZones = [SeatZone.NORMAL, SeatZone.PREMIUM, SeatZone.SOFA];

    /// <summary>
    /// ปัดราคาขึ้นเป็นหลักสิบบาท ให้ตัวเลขดูเป็นราคาตั๋วจริง (เช่น 180, 260, 400)
    /// คิดด้วย double แบบเดียวกับ JavaScript ผลจึงตรงกับราคาที่ฝั่ง Express เคยสร้างไว้ทุกค่า
    /// </summary>
    public static int ZonePriceFromBase(int basePrice, SeatZone zone)
    {
        var multiplier = ZoneMultiplier.TryGetValue(zone, out var m) ? m : 1;
        return (int)(Math.Ceiling(basePrice * multiplier / 10) * 10);
    }

    public static List<(SeatZone Zone, int Price)> BuildZonePrices(int basePrice) =>
        SeatZones.Select(zone => (zone, ZonePriceFromBase(basePrice, zone))).ToList();

    /// <summary>แปลง ZonePrice[] เป็น map { NORMAL: 180, ... } พร้อม fallback ทุกโซน</summary>
    public static Dictionary<SeatZone, int> ToPriceMap(IEnumerable<ZonePrice>? zonePrices, int basePrice) =>
        ToPriceMap(zonePrices?.Select(zp => (zp.Zone, zp.Price)), basePrice);

    public static Dictionary<SeatZone, int> ToPriceMap(IEnumerable<(SeatZone Zone, int Price)>? zonePrices, int basePrice)
    {
        var map = SeatZones.ToDictionary(zone => zone, _ => basePrice);
        foreach (var (zone, price) in zonePrices ?? []) map[zone] = price;
        return map;
    }

    /// <summary>คิดราคารวมของที่นั่งที่เลือก</summary>
    public static (List<(string SeatId, int Price)> Items, int Total) PriceSeats(
        IEnumerable<Seat> seats, IReadOnlyDictionary<SeatZone, int> priceMap)
    {
        var items = seats
            .Select(seat => (seat.Id, priceMap.TryGetValue(seat.Zone, out var price) ? price : 0))
            .ToList();
        return (items, items.Sum(item => item.Item2));
    }
}
