using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class Seat
{
    public string Id { get; set; } = Cuid.New();
    public string TheatreId { get; set; } = "";
    public string RowLabel { get; set; } = "";
    public int SeatNumber { get; set; }
    public SeatZone Zone { get; set; } = SeatZone.NORMAL;
    public bool IsActive { get; set; } = true;

    public Theatre Theatre { get; set; } = null!;
    public List<BookingSeat> BookingSeats { get; set; } = [];
}
