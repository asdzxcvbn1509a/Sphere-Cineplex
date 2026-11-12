using System.Text.Json.Nodes;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Models.Responses;

/// <summary>หนังหนึ่งเรื่อง — ทุกฟิลด์ของตาราง Movie ตามลำดับเดิม</summary>
public record MovieResponse(
    string Id,
    string TitleTh,
    string TitleEn,
    string SynopsisTh,
    string SynopsisEn,
    string PosterUrl,
    string? BackdropUrl,
    int DurationMin,
    string Rating,
    List<string> Genres,
    DateTime ReleaseDate,
    MovieStatus Status,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static MovieResponse From(Movie m) => new(
        m.Id, m.TitleTh, m.TitleEn, m.SynopsisTh, m.SynopsisEn, m.PosterUrl, m.BackdropUrl,
        m.DurationMin, m.Rating, m.Genres ?? [], m.ReleaseDate, m.Status, m.CreatedAt, m.UpdatedAt);
}

/// <summary>รายละเอียดหนัง + วันที่ที่ยังมีรอบฉายให้เลือก (ตามเวลาไทย)</summary>
public sealed record MovieDetailResponse(
    string Id,
    string TitleTh,
    string TitleEn,
    string SynopsisTh,
    string SynopsisEn,
    string PosterUrl,
    string? BackdropUrl,
    int DurationMin,
    string Rating,
    List<string> Genres,
    DateTime ReleaseDate,
    MovieStatus Status,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    List<string> AvailableDates);

public sealed record TheatreListItem(
    string Id,
    string Name,
    string ScreenType,
    int RowsCount,
    int ColsCount,
    bool IsActive,
    int SeatCount,
    int ShowtimeCount);

public sealed record TheatreSeatResponse(string Id, string TheatreId, string RowLabel, int SeatNumber, SeatZone Zone, bool IsActive);

public sealed record TheatreRowResponse(string RowLabel, List<TheatreSeatResponse> Seats);

public sealed record TheatreDetailResponse(
    string Id,
    string Name,
    string ScreenType,
    int RowsCount,
    int ColsCount,
    bool IsActive,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    List<TheatreRowResponse> Rows);

public sealed record ShowtimeMovie(string Id, string TitleTh, string TitleEn, string PosterUrl, int DurationMin);

public sealed record ShowtimeTheatre(string Id, string Name, string ScreenType);

public sealed record ShowtimeResponse(
    string Id,
    string MovieId,
    ShowtimeMovie Movie,
    ShowtimeTheatre Theatre,
    DateTime StartsAt,
    DateTime EndsAt,
    int BasePrice,
    ShowtimeStatus Status,
    Dictionary<SeatZone, int> Prices,
    int TotalSeats,
    int AvailableSeats);

public sealed record SeatMapShowtime(
    string Id,
    DateTime StartsAt,
    DateTime EndsAt,
    int BasePrice,
    ShowtimeMovie Movie,
    ShowtimeTheatre Theatre);

public sealed record SeatMapSeat(string Id, int SeatNumber, SeatZone Zone, int Price, string Status);

public sealed record SeatMapRow(string RowLabel, List<SeatMapSeat> Seats);

public sealed record SeatMapStats(int Total, int Available);

public sealed record SeatMapResponse(
    SeatMapShowtime Showtime,
    Dictionary<SeatZone, int> Prices,
    List<SeatMapRow> Rows,
    SeatMapStats Stats);

public sealed record AvailabilityMovie(string TitleTh, string TitleEn);

public sealed record AvailabilityBusy(string Id, DateTime StartsAt, DateTime EndsAt, AvailabilityMovie Movie);

public sealed record AvailabilityResponse(
    int TurnaroundMinutes,
    int DurationMin,
    int SlotStepMinutes,
    List<AvailabilityBusy> Busy,
    List<string> FreeSlots);

public sealed record NotificationResponse(
    string Id,
    string UserId,
    NotificationType Type,
    string TitleTh,
    string TitleEn,
    string BodyTh,
    string BodyEn,
    JsonObject? Data,
    DateTime? ReadAt,
    DateTime CreatedAt)
{
    public static NotificationResponse From(Notification n) =>
        new(n.Id, n.UserId, n.Type, n.TitleTh, n.TitleEn, n.BodyTh, n.BodyEn, n.Data, n.ReadAt, n.CreatedAt);
}
