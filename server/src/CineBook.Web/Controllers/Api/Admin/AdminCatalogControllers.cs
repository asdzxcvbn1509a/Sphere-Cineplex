using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api.Admin;

/// <summary>จัดการภาพยนตร์ — ผู้ดูแลเห็นเรื่องที่ ARCHIVED ด้วย</summary>
[Route("api/admin/movies")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminMoviesController(MovieService movies) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/movies
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] MovieListQuery query) =>
        Ok(new { movies = await movies.ListAsync(query.StatusValue, query.Q, includeArchived: true) });

    // @ENDPOINT POST http://localhost:4000/api/admin/movies
    [HttpPost]
    public async Task<IActionResult> Create(CreateMovieRequest body) => Created201(new { movie = await movies.CreateAsync(body) });

    // @ENDPOINT PATCH http://localhost:4000/api/admin/movies/:id
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id, UpdateMovieRequest body) => Ok(new { movie = await movies.UpdateAsync(id, body) });

    /// <summary>ส่ง ?force=true มาเมื่อผู้ดูแลยืนยันแล้วว่ายอมให้ประวัติการจองหายไปด้วย</summary>
    // @ENDPOINT DELETE http://localhost:4000/api/admin/movies/:id
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, [FromQuery] DeleteMovieQuery query)
    {
        var result = await movies.DeleteAsync(id, query.Force == "true");
        return Ok(new { deleted = result.Deleted, bookingCount = result.BookingCount, showtimeCount = result.ShowtimeCount });
    }
}

/// <summary>จัดการโรงภาพยนตร์และผังที่นั่ง</summary>
[Route("api/admin/theatres")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminTheatresController(TheatreService theatres) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/theatres
    [HttpGet]
    public async Task<IActionResult> List() => Ok(new { theatres = await theatres.ListAsync() });

    // @ENDPOINT GET http://localhost:4000/api/admin/theatres/:id
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id) => Ok(new { theatre = await theatres.GetByIdAsync(id) });

    // @ENDPOINT POST http://localhost:4000/api/admin/theatres
    [HttpPost]
    public async Task<IActionResult> Create(CreateTheatreRequest body) =>
        Created201(new { theatre = await theatres.CreateAsync(body.Name!, body.ScreenType, body.RowsCount!.Value, body.ColsCount!.Value) });

    // @ENDPOINT PATCH http://localhost:4000/api/admin/theatres/:id
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id, UpdateTheatreRequest body) => Ok(new { theatre = await theatres.UpdateAsync(id, body) });

    // @ENDPOINT DELETE http://localhost:4000/api/admin/theatres/:id
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await theatres.DeleteAsync(id);
        return Ok(new { ok = true });
    }

    // @ENDPOINT PATCH http://localhost:4000/api/admin/theatres/:id/seats
    [HttpPatch("{id}/seats")]
    public async Task<IActionResult> UpdateSeats(string id, SeatUpdateRequest body)
    {
        var updated = await theatres.UpdateSeatsAsync(id, body.SeatIds!, body.ZoneValue, body.IsActive);
        var theatre = await theatres.GetByIdAsync(id);
        return Ok(new { updated, theatre });
    }
}

/// <summary>จัดการรอบฉาย — ยกเลิกทั้งรอบอยู่ที่ AdminShowtimeCancelController (ใช้ BookingService)</summary>
[Route("api/admin/showtimes")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminShowtimesController(ShowtimeService showtimes, BookingService bookings) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/showtimes
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] ShowtimeListQuery query) =>
        // ผู้ดูแลต้องเห็นรอบที่ยกเลิกแล้วด้วย ไม่งั้นรอบหายจากตารางจนไม่รู้ว่าเกิดอะไรขึ้น
        Ok(new
        {
            showtimes = await showtimes.ListAsync(
                query.MovieId, query.TheatreId, query.Date, includePast: query.IncludePast != "false", includeCancelled: true),
        });

    /// <summary>ช่วงเวลาว่างของโรง สำหรับให้หน้าเพิ่มรอบฉายเลือกเวลาที่ไม่ชนกับรอบอื่น</summary>
    // @ENDPOINT GET http://localhost:4000/api/admin/showtimes/availability
    [HttpGet("availability")]
    public async Task<IActionResult> Availability([FromQuery] AvailabilityQuery query) =>
        Ok(await showtimes.GetAvailabilityAsync(query.TheatreId!, query.Date!, query.MovieId!, query.ExcludeId));

    // @ENDPOINT POST http://localhost:4000/api/admin/showtimes
    [HttpPost]
    public async Task<IActionResult> Create(ShowtimeCreateRequest body) =>
        Created201(new { showtime = await showtimes.CreateAsync(body.MovieId!, body.TheatreId!, body.StartsAt!.Value, body.BasePrice!.Value) });

    // @ENDPOINT PATCH http://localhost:4000/api/admin/showtimes/:id
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id, ShowtimeUpdateRequest body) =>
        Ok(new { showtime = await showtimes.UpdateAsync(id, body.TheatreId, body.StartsAt, body.BasePrice) });

    /// <summary>ยกเลิกทั้งรอบ — ปิดทุกการจอง ใบที่จ่ายแล้วเข้าคิวคืนเงิน และแจ้งเตือนลูกค้าทุกคน</summary>
    // @ENDPOINT POST http://localhost:4000/api/admin/showtimes/:id/cancel
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(string id, ReasonRequest body) =>
        Ok(await bookings.CancelShowtimeAsync(id, body.Reason, showtimes));

    // @ENDPOINT DELETE http://localhost:4000/api/admin/showtimes/:id
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await showtimes.DeleteAsync(id);
        return Ok(new { ok = true });
    }
}
