using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>โรงภาพยนตร์ / ห้องฉาย</summary>
public class Theatre : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    public string Name { get; set; } = "";
    public string ScreenType { get; set; } = "2D";
    public int RowsCount { get; set; }
    public int ColsCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<Seat> Seats { get; set; } = [];
    public List<Showtime> Showtimes { get; set; } = [];
}
