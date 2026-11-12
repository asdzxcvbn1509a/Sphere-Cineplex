using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Utils;

namespace CineBook.Tests.Unit;

/// <summary>port จาก utils/pricing.test.js, seatChange.test.js, trustProxy.test.js, proxySecret.test.js, loginIdentifier.test.js</summary>
[Trait("Category", "Unit")]
public sealed class PricingTests
{
    [Fact]
    public void ราคาต่อโซนคิดจากราคาฐานและปัดขึ้นเป็นหลักสิบ()
    {
        Assert.Equal(180, Pricing.ZonePriceFromBase(180, SeatZone.NORMAL));
        Assert.Equal(260, Pricing.ZonePriceFromBase(180, SeatZone.PREMIUM)); // 180 * 1.4 = 252 → 260
        Assert.Equal(400, Pricing.ZonePriceFromBase(180, SeatZone.SOFA)); // 180 * 2.2 = 396 → 400
    }

    [Fact]
    public void BuildZonePricesสร้างครบทุกโซน()
    {
        var prices = Pricing.BuildZonePrices(300);
        Assert.Equal(["NORMAL", "PREMIUM", "SOFA"], prices.Select(p => p.Zone.ToString()).Order().ToArray());
        Assert.Equal(300, prices.Single(p => p.Zone == SeatZone.NORMAL).Price);
    }

    [Fact]
    public void ToPriceMapใช้basePriceเป็นค่าสำรองเมื่อโซนนั้นไม่มีราคากำหนดไว้()
    {
        var map = Pricing.ToPriceMap([(SeatZone.PREMIUM, 999)], 150);
        Assert.Equal(999, map[SeatZone.PREMIUM]);
        Assert.Equal(150, map[SeatZone.NORMAL]);
        Assert.Equal(150, map[SeatZone.SOFA]);
    }

    [Fact]
    public void PriceSeatsรวมราคาข้ามโซนได้ถูกต้อง()
    {
        var priceMap = new Dictionary<SeatZone, int> { [SeatZone.NORMAL] = 180, [SeatZone.PREMIUM] = 260, [SeatZone.SOFA] = 400 };
        Seat[] seats =
        [
            new() { Id = "a", Zone = SeatZone.NORMAL },
            new() { Id = "b", Zone = SeatZone.PREMIUM },
            new() { Id = "c", Zone = SeatZone.SOFA },
        ];
        var (items, total) = Pricing.PriceSeats(seats, priceMap);
        Assert.Equal(840, total);
        Assert.Equal([("a", 180), ("b", 260), ("c", 400)], items);
        Assert.Equal(0, Pricing.PriceSeats([], priceMap).Total);
    }

    [Fact]
    public void ราคาที่คำนวณด้วยdoubleตรงกับJavaScriptทุกค่าในช่วงที่ใช้จริง()
    {
        // ค่าที่ JavaScript ได้จริง (Math.ceil(base * m / 10) * 10) — 200 × 2.2 = 440.00000000000006 จึงปัดเป็น 450
        // ราคาโซนในฐานเดิมคำนวณแบบนี้มาตลอด ฝั่ง C# ต้องได้เลขเดียวกันทุกตัว (คิดด้วย double ไม่ใช่ decimal)
        Assert.Equal(280, Pricing.ZonePriceFromBase(200, SeatZone.PREMIUM));
        Assert.Equal(450, Pricing.ZonePriceFromBase(200, SeatZone.SOFA));
        Assert.Equal(350, Pricing.ZonePriceFromBase(250, SeatZone.PREMIUM));
        Assert.Equal(550, Pricing.ZonePriceFromBase(250, SeatZone.SOFA));
    }
}

[Trait("Category", "Unit")]
public sealed class SeatChangePlannerTests
{
    /// <summary>แถว Seat จากฐานข้อมูล — id ตั้งให้เรียงตามป้ายที่นั่ง จะได้อ่านผลลัพธ์ง่าย</summary>
    private static Seat Row(string label, SeatZone zone) =>
        new() { Id = $"seat-{label}", RowLabel = label[..1], SeatNumber = int.Parse(label[1..]), Zone = zone };

    private static SeatSnapshot Paid(string label, SeatZone zone, int price) => Seats.SnapshotSeat(Row(label, zone), price);

    // ราคาปัจจุบันของรอบ — ผู้ดูแลขึ้นราคาไปแล้วหลังลูกค้าจอง (ตอนจอง NORMAL 200 / PREMIUM 280)
    private static readonly Dictionary<SeatZone, int> PriceMap = new()
    {
        [SeatZone.NORMAL] = 220,
        [SeatZone.PREMIUM] = 300,
        [SeatZone.SOFA] = 480,
    };

    [Fact]
    public void ย้ายในโซนเดิมฟรีเสมอ_แม้ราคารอบเปลี่ยนไปแล้ว()
    {
        var plan = SeatChangePlanner.Plan(
            [Paid("A1", SeatZone.NORMAL, 200), Paid("A2", SeatZone.NORMAL, 200)],
            [Row("A5", SeatZone.NORMAL), Row("A6", SeatZone.NORMAL)],
            PriceMap);
        Assert.Equal(0, plan.DiffAmount);
        Assert.Equal(400, plan.ToAmount);
        Assert.Equal([("A5", 200), ("A6", 200)], plan.ToSeats.Select(s => (s.Label, s.Price)));
        Assert.Equal(["seat-A1", "seat-A2"], plan.Released);
    }

    [Fact]
    public void ย้ายไปโซนที่แพงกว่า_คิดราคาปัจจุบันของโซนใหม่()
    {
        var plan = SeatChangePlanner.Plan(
            [Paid("A1", SeatZone.NORMAL, 200), Paid("A2", SeatZone.NORMAL, 200)],
            [Row("A1", SeatZone.NORMAL), Row("B3", SeatZone.PREMIUM)],
            PriceMap);
        Assert.Equal(400, plan.FromAmount);
        Assert.Equal(500, plan.ToAmount);
        Assert.Equal(100, plan.DiffAmount);
        Assert.Equal([("seat-B3", 300)], plan.Added);
        Assert.Equal(["seat-A2"], plan.Released);
    }

    [Fact]
    public void ที่นั่งที่คงไว้ใช้รายการเดิมทั้งก้อน()
    {
        var kept = Paid("B1", SeatZone.PREMIUM, 280);
        var plan = SeatChangePlanner.Plan(
            [kept, Paid("B2", SeatZone.PREMIUM, 280)],
            [Row("B1", SeatZone.PREMIUM), Row("C4", SeatZone.SOFA)],
            PriceMap);
        Assert.Equal(kept, plan.ToSeats[0]);
        Assert.Equal(480 - 280, plan.DiffAmount);
    }

    [Fact]
    public void ย้ายไปโซนที่ถูกกว่า_ส่วนต่างติดลบ()
    {
        var plan = SeatChangePlanner.Plan([Paid("B1", SeatZone.PREMIUM, 280)], [Row("A3", SeatZone.NORMAL)], PriceMap);
        Assert.Equal(220, plan.ToAmount);
        Assert.Equal(-60, plan.DiffAmount);
    }

    [Fact]
    public void ย้ายไปโซนที่มีอยู่แล้วในการจองเดียวกัน_ใช้ราคาที่จ่ายไว้ของโซนนั้น()
    {
        var plan = SeatChangePlanner.Plan(
            [Paid("A1", SeatZone.NORMAL, 200), Paid("B1", SeatZone.PREMIUM, 280)],
            [Row("A1", SeatZone.NORMAL), Row("A2", SeatZone.NORMAL)],
            PriceMap);
        Assert.Equal(200, plan.ToSeats[1].Price);
        Assert.Equal(-80, plan.DiffAmount);
    }

    [Fact]
    public void ที่นั่งใหม่เรียงตามidเสมอ()
    {
        var plan = SeatChangePlanner.Plan(
            [Paid("A1", SeatZone.NORMAL, 200), Paid("A2", SeatZone.NORMAL, 200)],
            [Row("A9", SeatZone.NORMAL), Row("A7", SeatZone.NORMAL)],
            PriceMap);
        Assert.Equal(["seat-A7", "seat-A9"], plan.Added.Select(a => a.SeatId));
    }

    [Fact]
    public void จำนวนที่นั่งไม่เท่าเดิม_หรือเลือกชุดเดิม_ไม่ผ่าน()
    {
        SeatSnapshot[] from = [Paid("A1", SeatZone.NORMAL, 200), Paid("A2", SeatZone.NORMAL, 200)];
        var mismatch = Assert.Throws<ApiException>(() => SeatChangePlanner.Plan(from, [Row("A1", SeatZone.NORMAL)], PriceMap));
        Assert.Equal("SEAT_COUNT_MISMATCH", mismatch.Code);
        Assert.Equal(2, (int)mismatch.Details!.GetType().GetProperty("required")!.GetValue(mismatch.Details)!);

        var same = Assert.Throws<ApiException>(() =>
            SeatChangePlanner.Plan(from, [Row("A2", SeatZone.NORMAL), Row("A1", SeatZone.NORMAL)], PriceMap));
        Assert.Equal("NO_SEAT_CHANGE", same.Code);
    }

    [Fact]
    public void SameZonesเทียบโซนครบทุกที่โดยไม่สนลำดับ()
    {
        SeatSnapshot[] a = [Paid("A1", SeatZone.NORMAL, 200), Paid("B1", SeatZone.PREMIUM, 280)];
        Assert.True(SeatChangePlanner.SameZones(a, [Paid("B4", SeatZone.PREMIUM, 280), Paid("A7", SeatZone.NORMAL, 200)]));
        Assert.False(SeatChangePlanner.SameZones(a, [Paid("A4", SeatZone.NORMAL, 200), Paid("A7", SeatZone.NORMAL, 200)]));
    }
}

[Trait("Category", "Unit")]
public sealed class TrustProxyAndSecretTests
{
    [Fact]
    public void ค่าที่เป็นตัวเลขแปลงเป็นจำนวนhop()
    {
        Assert.Equal(new TrustProxySetting(TrustProxyMode.Hops, 1, []).Hops, TrustProxy.Parse("1").Hops);
        Assert.Equal(TrustProxyMode.Hops, TrustProxy.Parse(" 2 ").Mode);
        Assert.Equal(2, TrustProxy.Parse(" 2 ").Hops);
    }

    [Fact]
    public void trueและfalseและค่าว่าง()
    {
        Assert.Equal(TrustProxyMode.All, TrustProxy.Parse("true").Mode);
        Assert.Equal(TrustProxyMode.None, TrustProxy.Parse("false").Mode);
        Assert.Equal(TrustProxyMode.None, TrustProxy.Parse("").Mode);
        Assert.Equal(TrustProxyMode.None, TrustProxy.Parse(null).Mode);
    }

    [Fact]
    public void ชื่อและsubnetตัดช่องว่างรอบจุลภาค()
    {
        Assert.Equal(["loopback"], TrustProxy.Parse("loopback").Entries);
        var setting = TrustProxy.Parse("loopback, 10.0.0.0/8");
        Assert.Equal(["loopback", "10.0.0.0/8"], setting.Entries);
        Assert.Equal(3, setting.Networks().Count);
        Assert.False(TrustProxy.TryValidate("not-an-ip", out _));
    }

    private static readonly string Secret = new string('a', 32) + new string('b', 32);

    [Fact]
    public void ProxySecretผ่านเฉพาะค่าที่ตรงทุกตัวอักษร()
    {
        var matches = ProxySecret.CreateMatcher(Secret);
        Assert.True(matches(Secret));
        Assert.False(matches(Secret[..^1]));
        Assert.False(matches($"{Secret}x"));
        Assert.False(matches(""));
        Assert.False(matches(null));
    }

    [Fact]
    public void ยังไม่ได้ตั้งsecretไม่มีค่าไหนผ่าน()
    {
        foreach (var secret in new string?[] { null, "" })
        {
            var matches = ProxySecret.CreateMatcher(secret);
            Assert.False(matches(""));
            Assert.False(matches(null));
            Assert.False(matches(Secret));
        }
    }
}

[Trait("Category", "Unit")]
public sealed class LoginIdentifierTests
{
    [Fact]
    public void มีแอทเป็นอีเมล_ตัดช่องว่างและทำเป็นตัวพิมพ์เล็ก()
    {
        Assert.Equal("somchai@example.test", LoginIdentifier.NormalizeEmail("  Somchai@Example.TEST "));
        Assert.Equal(new LoginLookup("somchai@example.test", null), LoginIdentifier.Lookup(" Somchai@Example.test"));
    }

    [Theory]
    [InlineData("0812345678")]
    [InlineData("081-234-5678")]
    [InlineData("081 234 5678")]
    [InlineData("+66812345678")]
    [InlineData("66812345678")]
    [InlineData("(081)2345678")]
    public void เบอร์โทรทุกรูปแบบของเบอร์เดียวกันได้ผลเดียวกัน(string raw)
    {
        Assert.Equal(new LoginLookup(null, "0812345678"), LoginIdentifier.Lookup(raw));
        Assert.Equal("phone:0812345678", LoginIdentifier.Key(raw));
    }

    [Fact]
    public void กุญแจของอีเมลกับเบอร์ไม่ชนกัน_และค่าว่างได้กุญแจว่าง()
    {
        Assert.Equal("email:a@b.test", LoginIdentifier.Key("A@B.test"));
        Assert.Null(LoginIdentifier.Lookup("   "));
        Assert.Null(LoginIdentifier.Lookup(null));
        Assert.Equal("", LoginIdentifier.Key("---"));
    }

    [Fact]
    public void เลขไทยไม่นับเป็นตัวเลขของเบอร์โทร()
    {
        // \d ของ .NET นับเลขไทยด้วย แต่ JavaScript เดิมไม่นับ — ต้องได้ผลเหมือนเดิม
        Assert.Equal("", Phone.Normalize("๐๘๑๒๓๔๕๖๗๘"));
    }
}
