using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api.Admin;

/// <summary>จัดการบัญชีผู้ใช้ — ผู้ดูแลระบบเท่านั้น</summary>
[Route("api/admin/users")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminUsersController(UserService users) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/users
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] UserListQuery query)
    {
        var page = await users.ListUsersAsync(query.Q, query.RoleValue, query.Page, query.PageSize);
        return Ok(new { users = page.Rows, total = page.Total, page = page.Page, pageSize = page.PageSize });
    }

    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id, UserUpdateRequest body)
    {
        var user = await users.UpdateUserAsync(id, Me.Id, body.Name, body.Email, body.Phone, body.RoleValue);
        return Ok(new { user });
    }

    [HttpPost("{id}/password")]
    public async Task<IActionResult> SetPassword(string id, SetUserPasswordRequest body)
    {
        await users.ResetUserPasswordAsync(id, Me.Id, body.NewPassword!);
        return Ok(new { ok = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await users.DeleteUserAsync(id, Me.Id);
        return Ok(new { ok = true });
    }
}
