using CineBook.Web.Models.Entities;

namespace CineBook.Web.Seed;

/// <summary>หนังที่บันทึกแล้ว พร้อมข้อมูลเสริมจาก SeedCatalog (ความนิยม ระบบฉาย วันฉาย)</summary>
public sealed class SeedMovie(Movie entity, SeedMovieData data)
{
    public Movie Entity { get; } = entity;
    public SeedMovieData Data { get; } = data;
    public string Id => Entity.Id;
}

/// <summary>โรงที่บันทึกแล้ว พร้อมที่นั่งและข้อมูลเสริมจาก SeedCatalog</summary>
public sealed class SeedTheatre(Theatre entity, SeedTheatreData data, List<Seat> seats)
{
    public Theatre Entity { get; } = entity;
    public SeedTheatreData Data { get; } = data;
    public List<Seat> Seats { get; } = seats;
    public string Id => Entity.Id;
    public string Name => Entity.Name;
    public string ScreenType => Entity.ScreenType;
}

/// <summary>รอบฉายหนึ่งรอบในตาราง (เวลาเป็นมิลลิวินาทีแบบ Date ของ JS)</summary>
public sealed class SeedShowtime
{
    public required SeedMovie Movie { get; init; }
    public required SeedTheatre Theatre { get; init; }
    public required long StartsAt { get; init; }
    public required long EndsAt { get; init; }
    public required int BasePrice { get; init; }
    public string Id { get; set; } = "";
    public List<(SeatZone Zone, int Price)> ZonePrices { get; set; } = [];
    public Dictionary<SeatZone, int> PriceMap { get; set; } = [];

    public DateTime StartsAtUtc => SeedTime.At(StartsAt);
}

public sealed class SeedUser(User entity, double activity)
{
    public User Entity { get; } = entity;
    public double Activity { get; } = activity;
    public string Id => Entity.Id;
    public string Name => Entity.Name;
}

/// <summary>ที่นั่งที่ขายได้ของโรงหนึ่ง จัดกลุ่มเป็น zone → แถว (ตามลำดับที่เจอ) → ที่นั่ง (เรียงตามเลข)</summary>
public sealed class SeatInventory
{
    public Dictionary<SeatZone, List<List<Seat>>> Zones { get; } = [];
    public int Total { get; set; }
}

/// <summary>สถานะของ seed ระหว่างสุ่มยอดขายและเดินสถานการณ์</summary>
public sealed class SeedWorld
{
    public required long Now { get; init; }
    public required SeedRandom Random { get; init; }
    public required User Admin { get; init; }
    public required User Staff { get; init; }
    public required Dictionary<string, SeedUser> Users { get; init; }
    public required List<SeedUser> Bookers { get; init; }
    public required List<SeedShowtime> Showtimes { get; init; }
    public required Dictionary<string, SeatInventory> Inventory { get; init; }

    /// <summary>ระหว่างสุ่มยอดขาย: รอบ → ที่นั่งที่ขายไปแล้ว (ดู SeedSales)</summary>
    public Dictionary<string, HashSet<string>> Taken { get; } = [];

    /// <summary>รอบ → ลูกค้าที่จองรอบนั้นแล้ว</summary>
    public Dictionary<string, HashSet<string>> BookedUsers { get; } = [];
}
