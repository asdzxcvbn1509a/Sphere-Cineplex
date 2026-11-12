using CineBook.Web.Infrastructure.Auth;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api;

/// <summary>
/// ฐานของ controller ฝั่ง API — controller อ่าน request เรียก service หนึ่งตัว แล้วจัดรูป response เท่านั้น
/// ไม่แตะฐานข้อมูลเอง (กติกาเดิมของ controllers/*.js)
/// </summary>
[ApiController]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    /// <summary>ผู้ใช้ที่ล็อกอินอยู่ (ใช้ใน action ที่ [Authorize] แล้ว)</summary>
    protected CurrentUser Me => HttpContext.RequireUser();

    /// <summary>201 พร้อม body — แบบ res.status(201).json(...)</summary>
    protected ObjectResult Created201(object body) => StatusCode(StatusCodes.Status201Created, body);

    protected string? UserAgent => Request.Headers.UserAgent.ToString() is { Length: > 0 } agent ? agent : null;
}
