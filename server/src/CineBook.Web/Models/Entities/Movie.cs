using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class Movie : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    public string TitleTh { get; set; } = "";
    public string TitleEn { get; set; } = "";
    public string SynopsisTh { get; set; } = "";
    public string SynopsisEn { get; set; } = "";
    public string PosterUrl { get; set; } = "";
    public string? BackdropUrl { get; set; }
    public int DurationMin { get; set; }
    public string Rating { get; set; } = "G";
    public List<string> Genres { get; set; } = [];
    public DateTime ReleaseDate { get; set; }
    public MovieStatus Status { get; set; } = MovieStatus.NOW_SHOWING;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<Showtime> Showtimes { get; set; } = [];
}
