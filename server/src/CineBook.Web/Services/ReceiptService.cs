using CineBook.Web.Data;
using CineBook.Web.Emails;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Email;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>ใบเสร็จรับเงิน — ออกเลข ตรวจสิทธิ์ และส่งทางอีเมล (port จาก services/receipts.js)</summary>
public sealed class ReceiptService(AppDbContext db, AppConfig config, EmailQueue emails, ILogger<ReceiptService> logger)
{
    private ReceiptIssuer Issuer => new(config.ReceiptIssuerName, config.ReceiptIssuerAddress);

    /// <summary>
    /// ออกเลขที่ใบเสร็จถัดไปของปีนั้น — ต้องเรียกใน transaction เดียวกับการอนุมัติสลิป
    ///
    /// ตัวนับเป็นแถวในตาราง ไม่ใช่ SEQUENCE ของ PostgreSQL เพราะ SEQUENCE ไม่ย้อนตาม rollback
    /// อนุมัติไม่ผ่านทีไร (ชนกับผู้ดูแลอีกคน, การจองถูกยกเลิกไปพอดี) เลขก็หายไปหนึ่งเลข
    /// ใบเสร็จจะขาดช่วงจนตรวจย้อนหลังไม่ได้ว่าใบที่หายไปไปไหน — แบบนี้ถ้า transaction ล้ม ค่าที่เพิ่มก็ย้อนกลับด้วย
    ///
    /// แถวตัวนับถูกล็อกไว้จนจบ transaction การอนุมัติที่มาพร้อมกันจึงต่อคิวกันแค่ช่วงท้ายนี้
    /// ทุกที่ล็อกตามลำดับ Booking → Payment → ReceiptCounter และไม่มีที่ไหนล็อกตัวนับก่อน จึงไม่เกิด deadlock
    /// </summary>
    public static async Task<string> IssueReceiptNoAsync(AppDbContext db, DateTime at)
    {
        var year = Receipts.ReceiptYear(at);
        var lastNo = await Sql.ScalarAsync(
            db,
            """
            INSERT INTO "ReceiptCounter" ("year", "lastNo") VALUES (@year, 1)
            ON CONFLICT ("year") DO UPDATE SET "lastNo" = "ReceiptCounter"."lastNo" + 1
            RETURNING "lastNo"
            """,
            Sql.P("year", year));
        return Receipts.FormatReceiptNo(year, Convert.ToInt64(lastNo));
    }

    private Task<Booking?> LoadReceiptBookingAsync(string bookingId) =>
        db.Bookings.AsNoTracking()
            .Include(b => b.User)
            .Include(b => b.Showtime).ThenInclude(s => s.Movie)
            .Include(b => b.Showtime).ThenInclude(s => s.Theatre)
            .Include(b => b.Payment)
            .FirstOrDefaultAsync(b => b.Id == bookingId);

    /// <summary>
    /// รายการเงินที่จะออกใบเสร็จ — ไม่ระบุ = ใบหลัก (ค่าตั๋วตอนจอง)
    /// ระบุ = ใบเสร็จส่วนต่างเปลี่ยนที่นั่ง ต้องเป็นรายการของการจองนี้เท่านั้น (กันเอา id ของคนอื่นมาเปิดผ่านการจองตัวเอง)
    /// </summary>
    private async Task<Payment?> ReceiptPaymentAsync(Booking booking, string? paymentId) =>
        paymentId is null
            ? booking.Payment
            : await db.Payments.AsNoTracking().Include(p => p.SeatChange)
                .FirstOrDefaultAsync(p => p.Id == paymentId && p.BookingId == booking.Id);

    /// <summary>ใบเสร็จของการจอง — เจ้าของการจองหรือผู้ดูแลเท่านั้น (แบบเดียวกับการดูสลิป)</summary>
    public async Task<ReceiptResponse> GetAsync(string bookingId, string? paymentId, CurrentUser requester)
    {
        var booking = await LoadReceiptBookingAsync(bookingId) ?? throw BookingAccess.BookingNotFound();
        if (!BookingAccess.CanAccessBooking(requester, booking.UserId))
        {
            throw BookingAccess.NotBookingOwner("ไม่มีสิทธิ์ดูใบเสร็จของรายการนี้");
        }
        // มีใบเสร็จเฉพาะรายการที่ผู้ดูแลอนุมัติแล้ว — เลขที่ใบเสร็จออกในขั้นตอนอนุมัติ
        var payment = await ReceiptPaymentAsync(booking, paymentId);
        if (payment?.ReceiptNo is null) throw ApiException.Forbidden("RECEIPT_NOT_READY", "รายการนี้ยังไม่มีใบเสร็จรับเงิน");
        return Receipts.Shape(booking, Issuer, payment);
    }

    /// <summary>
    /// ส่งใบเสร็จทางอีเมล — เรียกหลัง transaction ของการอนุมัติจบแล้วเท่านั้น
    /// ถ้าอนุมัติไม่สำเร็จ (ชนกับผู้ดูแลอีกคน) จะได้ไม่มีเมลของใบเสร็จที่ไม่มีอยู่จริงหลุดออกไป
    ///
    /// รอแค่ตอนอ่านข้อมูล ไม่รอ SMTP (เข้าคิวส่งเบื้องหลัง) — ผู้ดูแลกำลังไล่ตรวจคิวสลิป ไม่ควรต้องรอเมลส่งเสร็จทีละใบ
    /// และอะไรพังในนี้ก็แค่ลง log เพราะการอนุมัติสำเร็จไปแล้ว ลูกค้ายังเปิดใบเสร็จจากหน้าเว็บได้ตามปกติ
    /// </summary>
    public async Task EmailAsync(string bookingId, string? paymentId = null)
    {
        try
        {
            var booking = await LoadReceiptBookingAsync(bookingId);
            if (booking is null) return;
            var payment = await ReceiptPaymentAsync(booking, paymentId);
            if (payment?.ReceiptNo is null) return;
            // บัญชีเก่าที่ได้อีเมลชั่วคราวตอนเปลี่ยนมาใช้รหัสผ่าน (migration password_auth) ส่งไปก็ไม่ถึงใคร
            if (booking.User.Email.EndsWith(".invalid", StringComparison.Ordinal)) return;

            var receipt = Receipts.Shape(booking, Issuer, payment);
            var query = paymentId is null ? "" : $"?payment={paymentId}";
            emails.Enqueue(booking.User.Email, ReceiptEmail.Build(
                receipt,
                $"{config.AppUrl}/booking/{booking.Id}/receipt{query}",
                $"{config.AppUrl}/booking/{booking.Id}/ticket"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError("[receipt] เตรียมอีเมลใบเสร็จของการจอง {BookingId} ไม่สำเร็จ: {Message}", bookingId, ex.Message);
        }
    }
}
