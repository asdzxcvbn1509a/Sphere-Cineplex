using CineBook.Web.Models.Entities;

namespace CineBook.Web.Seed;

/// <summary>
/// เลือกที่นั่งให้การจองตัวอย่าง (port จาก prisma/seed/seating.js) — คนที่มาด้วยกันได้ที่นั่งติดกันในแถวเดียวกัน ค่อนไปทางกลางแถว
/// ใช้ทั้งตอนสุ่มยอดขาย (SeedSales) และตอนหาที่นั่งว่างให้สถานการณ์ที่เรียก service จริง (SeedScenarios)
/// </summary>
public static class SeedSeating
{
    /// <summary>
    /// ที่นั่งที่ขายได้ของโรงหนึ่ง — ที่นั่งที่ปิดใช้งานไม่อยู่ในผัง
    /// seats ต้องเรียงตามแถวแล้วเลขที่ (ลำดับเดียวกับที่สร้าง) ลำดับแถวในโซนมีผลกับลำดับการสุ่ม
    /// </summary>
    public static SeatInventory BuildInventory(IEnumerable<Seat> seats)
    {
        var inventory = new SeatInventory();
        var rowsByKey = new Dictionary<(SeatZone, string), List<Seat>>();
        foreach (var seat in seats)
        {
            if (!seat.IsActive) continue;
            if (!inventory.Zones.TryGetValue(seat.Zone, out var rows))
            {
                rows = [];
                inventory.Zones[seat.Zone] = rows;
            }
            if (!rowsByKey.TryGetValue((seat.Zone, seat.RowLabel), out var row))
            {
                row = [];
                rowsByKey[(seat.Zone, seat.RowLabel)] = row;
                rows.Add(row);
            }
            row.Add(seat);
            inventory.Total += 1;
        }
        foreach (var rows in inventory.Zones.Values)
        {
            foreach (var row in rows) row.Sort((a, b) => a.SeatNumber - b.SeatNumber);
        }
        return inventory;
    }

    /// <summary>ช่วงที่นั่งว่างที่เลขติดกันในแถวเดียว</summary>
    private static List<List<Seat>> FreeRuns(List<Seat> row, IReadOnlySet<string> taken)
    {
        var runs = new List<List<Seat>>();
        var run = new List<Seat>();
        foreach (var seat in row)
        {
            var breaks = taken.Contains(seat.Id) || (run.Count > 0 && seat.SeatNumber != run[^1].SeatNumber + 1);
            if (breaks && run.Count > 0)
            {
                runs.Add(run);
                run = [];
            }
            if (!taken.Contains(seat.Id)) run.Add(seat);
        }
        if (run.Count > 0) runs.Add(run);
        return runs;
    }

    /// <summary>
    /// เลือก count ที่นั่งในโซน zone ที่ยังไม่อยู่ใน taken — ติดกันและใกล้กลางแถวก่อน ไม่มีค่อยยอมนั่งแยกกัน
    /// คืน null ถ้าโซนนั้นเหลือไม่พอ (ไม่แตะ taken — ผู้เรียกเป็นคนจองที่นั่งเอง)
    /// </summary>
    public static List<Seat>? PickSeats(SeatInventory inventory, IReadOnlySet<string> taken, SeatZone zone, int count, SeedRandom random)
    {
        if (!inventory.Zones.TryGetValue(zone, out var rows) || count < 1) return null;

        List<Seat>? best = null;
        var bestScore = 0.0;
        foreach (var row in rows)
        {
            var center = (row[0].SeatNumber + row[^1].SeatNumber) / 2.0;
            foreach (var run in FreeRuns(row, taken))
            {
                for (var i = 0; i + count <= run.Count; i += 1)
                {
                    var block = run.GetRange(i, count);
                    var middle = (block[0].SeatNumber + block[count - 1].SeatNumber) / 2.0;
                    // สุ่มบวกเพิ่มนิดหน่อย ไม่งั้นทุกการจองไปกองที่กลางแถวหน้าสุดเหมือนกันหมด
                    var score = Math.Abs(middle - center) + random.Next() * 4;
                    if (best is null || score < bestScore)
                    {
                        best = block;
                        bestScore = score;
                    }
                }
            }
        }
        if (best is not null) return best;

        var free = rows.SelectMany(row => row).Where(seat => !taken.Contains(seat.Id)).ToList();
        if (free.Count < count) return null;
        return random.Shuffle(free).Take(count).ToList();
    }
}
