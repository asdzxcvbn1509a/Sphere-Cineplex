using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>ราคาต่อโซนของแต่ละรอบฉาย</summary>
public class ZonePrice
{
    public string Id { get; set; } = Cuid.New();
    public string ShowtimeId { get; set; } = "";
    public SeatZone Zone { get; set; }
    public int Price { get; set; }

    public Showtime Showtime { get; set; } = null!;
}
