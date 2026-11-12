using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api;

/// <summary>หนังที่ลูกค้าเห็น — ไม่ต้องล็อกอิน</summary>
[Route("api/movies")]
[AllowAnonymous]
public sealed class MoviesController(MovieService movies) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/movies
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] MovieListQuery query) =>
        Ok(new { movies = await movies.ListAsync(query.StatusValue, query.Q) });

    // @ENDPOINT GET http://localhost:4000/api/movies/:id
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id) => Ok(new { movie = await movies.GetByIdAsync(id) });
}

/// <summary>รอบฉายและผังที่นั่งที่ลูกค้าเห็น — ไม่ต้องล็อกอิน (เลือกที่นั่งก่อนแล้วค่อยล็อกอินตอนยืนยัน)</summary>
[Route("api/showtimes")]
[AllowAnonymous]
public sealed class ShowtimesController(ShowtimeService showtimes) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/showtimes
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] ShowtimeListQuery query) =>
        Ok(new { showtimes = await showtimes.ListAsync(query.MovieId, query.TheatreId, query.Date) });

    // @ENDPOINT GET http://localhost:4000/api/showtimes/:id
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id) => Ok(new { showtime = await showtimes.GetByIdAsync(id) });

    // @ENDPOINT GET http://localhost:4000/api/showtimes/:id/seats
    [HttpGet("{id}/seats")]
    public async Task<IActionResult> Seats(string id) => Ok(await showtimes.GetSeatMapAsync(id));
}

/// <summary>แจ้งเตือนของผู้ใช้ที่ล็อกอินอยู่ — แตะได้เฉพาะของตัวเอง</summary>
[Route("api/notifications")]
[Authorize]
public sealed class NotificationsController(NotificationService notifications) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/notifications
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] NotificationListQuery query)
    {
        var result = await notifications.ListAsync(Me.Id, query.UnreadOnly == "true", query.Limit ?? 50);
        return Ok(new { notifications = result.Notifications, unreadCount = result.UnreadCount });
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead() => Ok(new { updated = await notifications.MarkAllReadAsync(Me.Id) });

    [HttpPost("{id}/read")]
    public async Task<IActionResult> MarkRead(string id)
    {
        await notifications.MarkReadAsync(Me.Id, id);
        return Ok(new { ok = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await notifications.DeleteAsync(Me.Id, id);
        return Ok(new { ok = true });
    }
}
