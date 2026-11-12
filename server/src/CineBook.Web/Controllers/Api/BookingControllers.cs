using CineBook.Web.Infrastructure.RateLimiting;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api;

/// <summary>การจองของผู้ใช้ — ทุกเส้นทางต้องล็อกอิน</summary>
[Route("api/bookings")]
[Authorize]
public sealed class BookingsController(
    BookingService bookings, ReceiptService receipts, SeatChangeService seatChanges) : ApiControllerBase
{
    /// <summary>
    /// กันสคริปต์จอง-ยกเลิกวนเพื่อกักที่นั่ง — ด่านหลักคือเพดานการจองค้างใน service (MAX_PENDING_BOOKINGS_PER_USER)
    /// โควตา createBooking กันอีกชั้นที่เพดานไม่ครอบคลุม: จองแล้วยกเลิกทันทีซ้ำ ๆ ทำให้ที่นั่งกระพริบจนคนอื่นจองไม่ได้
    /// </summary>
    // @ENDPOINT POST http://localhost:4000/api/bookings
    [HttpPost]
    [RateLimit("createBooking")]
    public async Task<IActionResult> Create(CreateBookingRequest body) =>
        // เจ้าของการจองมาจาก token เสมอ — ไม่มีทางส่งผ่าน body มาทับได้
        Created201(new { booking = await bookings.CreateAsync(Me.Id, body.ShowtimeId!, body.SeatIds!) });

    // @ENDPOINT GET http://localhost:4000/api/bookings
    [HttpGet]
    public async Task<IActionResult> ListMine([FromQuery] BookingListQuery query) =>
        Ok(new { bookings = await bookings.ListMineAsync(Me.Id, query.Scope) });

    // @ENDPOINT GET http://localhost:4000/api/bookings/:id
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id)
    {
        // ผู้ดูแลเปิดการจองของลูกค้าได้ (หน้าเปลี่ยนที่นั่งแทนลูกค้า) — แบบเดียวกับใบเสร็จ
        var me = Me;
        return Ok(new { booking = await bookings.GetByIdAsync(id, me.Role == Role.ADMIN ? null : me.Id) });
    }

    // @ENDPOINT GET http://localhost:4000/api/bookings/:id/ticket
    [HttpGet("{id}/ticket")]
    public async Task<IActionResult> Ticket(string id) =>
        Ok(new { ticket = await bookings.GetTicketAsync(id, Me.Id) });

    /// <summary>ใบเสร็จรับเงิน — เจ้าของการจอง หรือผู้ดูแล (เปิดดูของลูกค้าได้ทุกใบ) · ?payment= = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง</summary>
    // @ENDPOINT GET http://localhost:4000/api/bookings/:id/receipt
    [HttpGet("{id}/receipt")]
    public async Task<IActionResult> Receipt(string id, [FromQuery] PaymentRefQuery query) =>
        Ok(new { receipt = await receipts.GetAsync(id, query.Payment, Me) });

    // @ENDPOINT POST http://localhost:4000/api/bookings/:id/cancel
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(string id, CancelBookingRequest body) =>
        Ok(new
        {
            booking = await bookings.CancelAsync(
                id,
                Me.Id,
                byAdmin: false,
                body.Reason,
                RefundAccount.Read(body.RefundBankName, body.RefundAccountNo, body.RefundAccountName)),
        });

    /// <summary>แจ้ง/แก้บัญชีรับเงินคืน สำหรับใบที่รอโอนคืนอยู่</summary>
    // @ENDPOINT PATCH http://localhost:4000/api/bookings/:id/refund-account
    [HttpPatch("{id}/refund-account")]
    public async Task<IActionResult> UpdateRefundAccount(string id, RefundAccountRequest body) =>
        Ok(new
        {
            booking = await bookings.UpdateRefundAccountAsync(
                id, Me.Id, body.RefundBankName!, body.RefundAccountNo!, body.RefundAccountName),
        });

    /// <summary>
    /// ขอเปลี่ยนที่นั่ง — ราคาเท่าเดิม/ถูกลงย้ายทันที · แพงขึ้นได้คำขอที่รอโอนส่วนต่าง (seatChange.status = PENDING_PAYMENT)
    /// โควตา seatChange กันสคริปต์ขอเปลี่ยนแบบแพงขึ้นแล้วยกเลิกวนไปเรื่อย ๆ (ระหว่างรอโอนก็กักที่นั่งใหม่ไว้ได้)
    /// </summary>
    // @ENDPOINT POST http://localhost:4000/api/bookings/:id/seat-changes
    [HttpPost("{id}/seat-changes")]
    [RateLimit("seatChange")]
    public async Task<IActionResult> RequestSeatChange(string id, SeatChangeRequest body)
    {
        var result = await seatChanges.RequestAsync(
            id, Me.Id, body.SeatIds!, RefundAccount.Read(body.RefundBankName, body.RefundAccountNo, body.RefundAccountName));
        return Created201(new { booking = result.Booking, seatChange = result.SeatChange });
    }
}

/// <summary>
/// ขั้นถัดไปของคำขอเปลี่ยนที่นั่งที่ต้องโอนส่วนต่าง (สร้างคำขออยู่ที่ POST /api/bookings/:id/seat-changes)
/// </summary>
[Route("api/seat-changes")]
[Authorize]
public sealed class SeatChangesController(SeatChangeService seatChanges, SlipUploadReader uploads) : ApiControllerBase
{
    /// <summary>คำขอเปลี่ยนที่นั่ง + ข้อมูลชำระส่วนต่าง (QR, เวลาที่เหลือ) — เจ้าของการจองหรือผู้ดูแล</summary>
    // @ENDPOINT GET http://localhost:4000/api/seat-changes/:id
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id) =>
        Ok(new { seatChange = await seatChanges.GetAsync(id, Me) });

    /// <summary>สลิปส่วนต่างใช้ตัวรับไฟล์และโฟลเดอร์เดียวกับสลิปค่าตั๋ว (ช่องชื่อ slip, ตรวจไส้ในไฟล์)</summary>
    // @ENDPOINT POST http://localhost:4000/api/seat-changes/:id/slip
    [HttpPost("{id}/slip")]
    [RateLimit("slipUpload")]
    public async Task<IActionResult> UploadSlip(string id)
    {
        var form = await uploads.ReadAsync(Request, SlipKind.Payment, HttpContext.RequestAborted);
        return Created201(new { seatChange = await seatChanges.UploadSlipAsync(id, Me, form.Slip) });
    }

    /// <summary>ลูกค้ายกเลิกคำขอที่ยังไม่ได้ส่งสลิปส่วนต่าง — ที่นั่งเดิมไม่ได้แตะ</summary>
    // @ENDPOINT POST http://localhost:4000/api/seat-changes/:id/cancel
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(string id) =>
        Ok(new { seatChange = await seatChanges.CancelAsync(id, Me) });
}

/// <summary>หน้าชำระเงินและสลิปของการจอง — ทุกเส้นทางต้องล็อกอิน</summary>
[Route("api/payments")]
[Authorize]
public sealed class PaymentsController(PaymentService payments, SlipUploadReader uploads, ISlipStorage storage) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/payments/:bookingId
    [HttpGet("{bookingId}")]
    public async Task<IActionResult> Get(string bookingId) =>
        Ok(new { payment = await payments.GetForBookingAsync(bookingId, Me.Id) });

    /// <summary>โควตา slipUpload นับก่อนอ่านไฟล์ — คำขอที่เกินโควตาไม่ได้ส่งไฟล์ถึงที่เก็บเลย</summary>
    // @ENDPOINT POST http://localhost:4000/api/payments/:bookingId/slip
    [HttpPost("{bookingId}/slip")]
    [RateLimit("slipUpload")]
    public async Task<IActionResult> UploadSlip(string bookingId)
    {
        var form = await uploads.ReadAsync(Request, SlipKind.Payment, HttpContext.RequestAborted);
        return Created201(new { payment = await payments.UploadSlipAsync(bookingId, Me.Id, form.Slip) });
    }

    /// <summary>รูปสลิป — เจ้าของการจองหรือ admin เท่านั้น (client ดึงเป็น blob พร้อม auth header) · ?payment= = สลิปส่วนต่าง</summary>
    // @ENDPOINT GET http://localhost:4000/api/payments/:bookingId/slip
    [HttpGet("{bookingId}/slip")]
    public async Task<IActionResult> Slip(string bookingId, [FromQuery] PaymentRefQuery query) =>
        await SendSlipAsync(SlipKind.Payment, await payments.GetSlipFileNameAsync(bookingId, query.Payment, Me));

    /// <summary>สลิปคืนเงิน — เจ้าของการจองหรือ admin เท่านั้น</summary>
    // @ENDPOINT GET http://localhost:4000/api/payments/:bookingId/refund-slip
    [HttpGet("{bookingId}/refund-slip")]
    public async Task<IActionResult> RefundSlip(string bookingId, [FromQuery] PaymentRefQuery query) =>
        await SendSlipAsync(SlipKind.Refund, await payments.GetRefundSlipFileNameAsync(bookingId, query.Payment, Me));

    /// <summary>สลิปเป็นข้อมูลส่วนตัว — ห้าม cache ทั้งที่เบราว์เซอร์และ proxy ระหว่างทาง</summary>
    private async Task<IActionResult> SendSlipAsync(SlipKind kind, string fileName)
    {
        var file = await storage.ReadAsync(kind, fileName, HttpContext.RequestAborted);
        Response.Headers.CacheControl = "private, no-store";
        return File(file.Content, file.ContentType);
    }
}
