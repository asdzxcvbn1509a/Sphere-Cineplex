using System.Text.Json;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api.Admin;

/// <summary>การจองทั้งหมด — ผู้ดูแลระบบเท่านั้น</summary>
[Route("api/admin/bookings")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminBookingsController(BookingService bookings, SeatChangeService seatChanges) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/bookings
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] AdminBookingListQuery query)
    {
        var page = await bookings.ListAllAsync(
            query.Status is null ? null : Enum.Parse<BookingStatus>(query.Status),
            query.DisplayStatuses,
            query.Date,
            query.Q,
            query.Page,
            query.PageSize);
        return Ok(new { bookings = page.Rows, total = page.Total, page = page.Page, pageSize = page.PageSize });
    }

    // @ENDPOINT POST http://localhost:4000/api/admin/bookings/:id/cancel
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(string id, ReasonRequest body) =>
        Ok(new { booking = await bookings.CancelAsync(id, userId: null, byAdmin: true, body.Reason, RefundAccount.None) });

    /// <summary>ย้ายที่นั่งแทนลูกค้า (ที่นั่งชำรุด ลูกค้าโทรมาขอ) — โซนเดิมเท่านั้น ไม่ติดเส้นตาย/โควตาของลูกค้า</summary>
    // @ENDPOINT POST http://localhost:4000/api/admin/bookings/:id/change-seats
    [HttpPost("{id}/change-seats")]
    public async Task<IActionResult> ChangeSeats(string id, AdminChangeSeatsRequest body)
    {
        var result = await seatChanges.AdminChangeAsync(id, Me.Id, body.SeatIds!, body.Reason);
        return Ok(new { booking = result.Booking, seatChange = result.SeatChange });
    }
}

/// <summary>ตรวจสลิป — ผู้ดูแลระบบเท่านั้น</summary>
[Route("api/admin/payments")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminPaymentsController(PaymentService payments) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/payments
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] PaymentListQuery query)
    {
        var page = await payments.ListAsync(query.Status, query.Sort, query.Page, query.PageSize);
        return Ok(new { payments = page.Rows, total = page.Total, page = page.Page, pageSize = page.PageSize });
    }

    // @ENDPOINT POST http://localhost:4000/api/admin/payments/:id/approve
    [HttpPost("{id}/approve")]
    public async Task<IActionResult> Approve(string id) =>
        Ok(new { booking = await payments.ApproveAsync(id, Me.Id) });

    // @ENDPOINT POST http://localhost:4000/api/admin/payments/:id/reject
    [HttpPost("{id}/reject")]
    public async Task<IActionResult> Reject(string id, RejectPaymentRequest body) =>
        Ok(new { booking = await payments.RejectAsync(id, Me.Id, body.Reason!) });
}

/// <summary>คิวคืนเงิน — การจองที่จ่ายเงินแล้วแต่ถูกยกเลิก จึงต้องโอนเงินคืนลูกค้า (ผู้ดูแลระบบเท่านั้น)</summary>
[Route("api/admin/refunds")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminRefundsController(PaymentService payments, SlipUploadReader uploads) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/refunds
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] RefundListQuery query)
    {
        var page = await payments.ListRefundsAsync(query.Status, query.Sort, query.Page, query.PageSize);
        return Ok(new { refunds = page.Rows, total = page.Total, page = page.Page, pageSize = page.PageSize });
    }

    /// <summary>บันทึกว่าโอนเงินคืนแล้ว (ต้องแนบสลิปคืนเงิน ช่องชื่อ slip แบบเดียวกับสลิปฝั่งจ่ายเงิน)</summary>
    // @ENDPOINT POST http://localhost:4000/api/admin/refunds/:id/complete
    [HttpPost("{id}/complete")]
    public async Task<IActionResult> Complete(string id)
    {
        var (slip, note) = await ReadRefundFormAsync();
        await payments.CompleteRefundAsync(id, Me.Id, note, slip);
        // หน้าคืนเงินโหลดคิวใหม่เองหลังบันทึก (รวมถึงหน้าที่กำลังเปิดอยู่) จึงไม่ต้องส่งรายการกลับไป
        return Ok(new { ok = true });
    }

    /// <summary>แก้รายการที่คืนเงินแล้ว — แนบสลิปใหม่ได้แต่ไม่บังคับ (ไม่แนบ = ใช้สลิปเดิม) และหมายเหตุ</summary>
    // @ENDPOINT PATCH http://localhost:4000/api/admin/refunds/:id
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id)
    {
        var (slip, note) = await ReadRefundFormAsync();
        await payments.UpdateRefundAsync(id, note, slip);
        return Ok(new { ok = true });
    }

    /// <summary>
    /// สลิปคืนเงิน (ถ้ามี) และหมายเหตุ — หน้าเว็บส่ง multipart เสมอ
    /// แต่ Express เดิมอ่าน JSON ให้ทุกเส้นทาง { note } แบบ JSON จึงใช้ได้ด้วย (ไม่งั้นหมายเหตุถูกล้างเงียบ ๆ)
    /// </summary>
    private async Task<(StoredSlip? Slip, string? Note)> ReadRefundFormAsync()
    {
        if (Request.HasJsonContentType())
        {
            using var json = await JsonDocument.ParseAsync(Request.Body, cancellationToken: HttpContext.RequestAborted);
            var note = json.RootElement.ValueKind == JsonValueKind.Object &&
                json.RootElement.TryGetProperty("note", out var value) && value.ValueKind == JsonValueKind.String
                    ? value.GetString()
                    : null;
            return (null, note);
        }
        var form = await uploads.ReadAsync(Request, SlipKind.Refund, HttpContext.RequestAborted);
        return (form.Slip, form.Fields.GetValueOrDefault("note"));
    }
}
