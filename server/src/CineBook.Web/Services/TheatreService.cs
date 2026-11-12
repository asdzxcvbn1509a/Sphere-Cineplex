using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Requests;
using CineBook.Web.Models.Responses;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>โรงภาพยนตร์และผังที่นั่ง (port จาก services/theatres.js)</summary>
public sealed class TheatreService(AppDbContext db, TimeProvider time)
{
    private const int MaxRows = 26; // A–Z

    public static string RowLabelFor(int index) => ((char)('A' + index)).ToString();

    /// <summary>
    /// ผังที่นั่งมาตรฐาน: แถวหน้าเป็นที่นั่งธรรมดา แถวกลางค่อนไปหลังเป็น Premium
    /// และแถวสุดท้ายเป็นโซฟาคู่ (เลียนแบบผังโรงหนังจริง)
    /// </summary>
    public static SeatZone ZoneForRow(int rowIndex, int rowsCount)
    {
        if (rowsCount >= 4 && rowIndex == rowsCount - 1) return SeatZone.SOFA;
        if (rowIndex >= (int)Math.Floor(rowsCount * 0.45)) return SeatZone.PREMIUM;
        return SeatZone.NORMAL;
    }

    public static List<(string RowLabel, int SeatNumber, SeatZone Zone)> BuildSeatGrid(int rowsCount, int colsCount)
    {
        var seats = new List<(string, int, SeatZone)>();
        for (var r = 0; r < rowsCount; r += 1)
        {
            var zone = ZoneForRow(r, rowsCount);
            // โซฟาเป็นที่นั่งคู่ จึงมีจำนวนต่อแถวครึ่งเดียว
            var seatsInRow = zone == SeatZone.SOFA ? (int)Math.Ceiling(colsCount / 2.0) : colsCount;
            for (var c = 1; c <= seatsInRow; c += 1) seats.Add((RowLabelFor(r), c, zone));
        }
        return seats;
    }

    private static ApiException TheatreNotFound() => ApiException.NotFound("THEATRE_NOT_FOUND", "ไม่พบโรงภาพยนตร์นี้");

    public Task<List<TheatreListItem>> ListAsync() =>
        db.Theatres.AsNoTracking()
            .OrderBy(t => t.Name)
            .Select(t => new TheatreListItem(
                t.Id, t.Name, t.ScreenType, t.RowsCount, t.ColsCount, t.IsActive, t.Seats.Count, t.Showtimes.Count))
            .ToListAsync();

    public async Task<TheatreDetailResponse> GetByIdAsync(string id)
    {
        var theatre = await db.Theatres.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id) ?? throw TheatreNotFound();
        var seats = await db.Seats.AsNoTracking()
            .Where(s => s.TheatreId == id)
            .OrderBy(s => s.RowLabel).ThenBy(s => s.SeatNumber)
            .ToListAsync();

        var rows = seats
            .GroupBy(s => s.RowLabel)
            .Select(g => new TheatreRowResponse(
                g.Key,
                g.Select(s => new TheatreSeatResponse(s.Id, s.TheatreId, s.RowLabel, s.SeatNumber, s.Zone, s.IsActive)).ToList()))
            .ToList();

        return new TheatreDetailResponse(
            theatre.Id, theatre.Name, theatre.ScreenType, theatre.RowsCount, theatre.ColsCount, theatre.IsActive,
            theatre.CreatedAt, theatre.UpdatedAt, rows);
    }

    private static List<Seat> NewSeats(string theatreId, int rowsCount, int colsCount) =>
        BuildSeatGrid(rowsCount, colsCount)
            .Select(s => new Seat { TheatreId = theatreId, RowLabel = s.RowLabel, SeatNumber = s.SeatNumber, Zone = s.Zone })
            .ToList();

    public async Task<TheatreDetailResponse> CreateAsync(string name, string? screenType, int rowsCount, int colsCount)
    {
        AssertGridSize(rowsCount, colsCount);
        var theatre = new Theatre
        {
            Name = name,
            ScreenType = screenType ?? "2D",
            RowsCount = rowsCount,
            ColsCount = colsCount,
        };
        theatre.Seats = NewSeats(theatre.Id, rowsCount, colsCount);
        db.Theatres.Add(theatre);
        await db.SaveChangesAsync();
        return await GetByIdAsync(theatre.Id);
    }

    public async Task<TheatreDetailResponse> UpdateAsync(string id, TheatreRequest body)
    {
        var theatre = await db.Theatres.FirstOrDefaultAsync(t => t.Id == id) ?? throw TheatreNotFound();

        var resizing =
            (body.RowsCount is not null && body.RowsCount != theatre.RowsCount) ||
            (body.ColsCount is not null && body.ColsCount != theatre.ColsCount);

        if (resizing)
        {
            var activeBookings = await db.BookingSeats.CountAsync(bs => bs.Seat.TheatreId == id);
            if (activeBookings > 0)
            {
                throw ApiException.Conflict("THEATRE_HAS_BOOKINGS", "โรงนี้มีที่นั่งที่ถูกจองอยู่ ไม่สามารถเปลี่ยนขนาดผังได้");
            }
            var rowsCount = body.RowsCount ?? theatre.RowsCount;
            var colsCount = body.ColsCount ?? theatre.ColsCount;
            AssertGridSize(rowsCount, colsCount);

            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Seats.Where(s => s.TheatreId == id).ExecuteDeleteAsync();
            Apply(theatre, body);
            db.Seats.AddRange(NewSeats(id, rowsCount, colsCount));
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return await GetByIdAsync(id);
        }

        Apply(theatre, body);
        await db.SaveChangesAsync();
        return await GetByIdAsync(id);
    }

    /// <summary>แก้เฉพาะช่องที่ส่งมา (ไม่เติมค่าเริ่มต้นให้ช่องที่ไม่ได้ส่ง)</summary>
    private void Apply(Theatre theatre, TheatreRequest body)
    {
        if (body.Name is not null) theatre.Name = body.Name;
        if (body.ScreenType is not null) theatre.ScreenType = body.ScreenType;
        if (body.RowsCount is not null) theatre.RowsCount = body.RowsCount.Value;
        if (body.ColsCount is not null) theatre.ColsCount = body.ColsCount.Value;
        if (body.IsActive is not null) theatre.IsActive = body.IsActive.Value;
        db.Entry(theatre).Property(t => t.UpdatedAt).CurrentValue = time.UtcNowMs();
    }

    /// <summary>
    /// ลบโรงได้เฉพาะโรงที่ไม่เคยมีการจองเลย — เหตุผลเดียวกับการลบรอบฉาย
    /// (ลบโรง = cascade ลบรอบ → การจอง → รายการชำระเงินและคิวคืนเงิน) โรงที่เลิกใช้ให้ปิดใช้งานแทน
    /// </summary>
    public async Task DeleteAsync(string id)
    {
        var bookingCount = await db.Bookings.CountAsync(b => b.Showtime.TheatreId == id);
        if (bookingCount > 0)
        {
            throw ApiException.Conflict(
                "THEATRE_HAS_BOOKINGS",
                "โรงนี้มีประวัติการจอง ลบไม่ได้เพราะประวัติและรายการคืนเงินจะหายไปด้วย — ปิดใช้งานโรงแทน",
                new { bookingCount });
        }
        var deleted = await db.Theatres.Where(t => t.Id == id).ExecuteDeleteAsync();
        if (deleted == 0) throw ApiException.NotFound();
    }

    /// <summary>แก้โซน/เปิด-ปิดที่นั่งทีละหลายที่ (ใช้กับตัวแก้ผังฝั่ง admin)</summary>
    public Task<int> UpdateSeatsAsync(string theatreId, List<string> seatIds, SeatZone? zone, bool? isActive)
    {
        var query = db.Seats.Where(s => seatIds.Contains(s.Id) && s.TheatreId == theatreId);
        return (zone, isActive) switch
        {
            ({ } z, { } a) => query.ExecuteUpdateAsync(s => s.SetProperty(x => x.Zone, z).SetProperty(x => x.IsActive, a)),
            ({ } z, null) => query.ExecuteUpdateAsync(s => s.SetProperty(x => x.Zone, z)),
            (null, { } a) => query.ExecuteUpdateAsync(s => s.SetProperty(x => x.IsActive, a)),
            _ => query.CountAsync(),
        };
    }

    private static void AssertGridSize(int rowsCount, int colsCount)
    {
        if (rowsCount is < 1 or > MaxRows)
        {
            throw ApiException.BadRequest("INVALID_GRID", $"จำนวนแถวต้องอยู่ระหว่าง 1–{MaxRows}");
        }
        if (colsCount is < 1 or > 30)
        {
            throw ApiException.BadRequest("INVALID_GRID", "จำนวนที่นั่งต่อแถวต้องอยู่ระหว่าง 1–30");
        }
    }
}
