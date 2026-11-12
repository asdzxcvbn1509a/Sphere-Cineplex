using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class Showtime : ITimestamped
{
    public string Id { get; set; } = Cuid.New();
    public string MovieId { get; set; } = "";
    public string TheatreId { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public int BasePrice { get; set; }
    public ShowtimeStatus Status { get; set; } = ShowtimeStatus.SCHEDULED;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Movie Movie { get; set; } = null!;
    public Theatre Theatre { get; set; } = null!;
    public List<ZonePrice> ZonePrices { get; set; } = [];
    public List<Booking> Bookings { get; set; } = [];
    public List<BookingSeat> BookingSeats { get; set; } = [];
}
