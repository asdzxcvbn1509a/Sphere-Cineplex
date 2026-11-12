using System.Linq.Expressions;
using System.Text;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>ภาพรวม งานค้าง และรายงานของผู้ดูแล (port จาก services/reports.js)</summary>
public sealed class ReportService(AppDbContext db, TimeProvider time)
{
    /// <summary>
    /// เงื่อนไขของ "งานค้าง" ที่ต้องนับ — ใช้ร่วมกันระหว่างหน้าภาพรวม ป้ายตัวเลขบน sidebar และคิวตรวจสลิป
    /// ถ้าแยกกันเขียนแล้วแก้ที่เดียว ตัวเลขสองที่จะไม่ตรงกันโดยไม่มีใครรู้
    /// (PendingSlip อยู่ใน PaymentService คู่กับคิวตรวจสลิปที่ใช้เงื่อนไขเดียวกัน)
    /// </summary>
    private static readonly Expression<Func<Payment, bool>> PendingRefund = p => p.Status == PaymentStatus.REFUND_PENDING;

    /// <summary>
    /// ตัวเลขงานค้างสำหรับป้ายบน sidebar (+ ยอดรวมที่ต้องโอนคืน ใช้เป็นบรรทัดสรุปของหน้าคืนเงิน)
    /// แยกจาก GetOverviewAsync เพราะถูกเรียกถี่กว่ามาก จึงนับแค่ไม่กี่ตัวเลขให้เบาที่สุด
    /// </summary>
    public async Task<QueueCountsResponse> GetQueueCountsAsync()
    {
        var pendingSlips = await db.Payments.CountAsync(PaymentService.PendingSlip);
        var refunds = db.Payments.Where(PendingRefund);
        var pendingRefunds = await refunds.CountAsync();
        // ยอดที่ต้องโอนจริง (refundAmount) — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
        var pendingRefundAmount = await refunds.SumAsync(p => p.RefundAmount) ?? 0;
        return new QueueCountsResponse(pendingSlips, pendingRefunds, pendingRefundAmount);
    }

    /// <summary>จำนวนแถวต่อแผงในหน้าภาพรวมตาม wireframe — เห็นงานค้างได้หลายใบโดยไม่ต้องเปิดหน้าคิว</summary>
    private const int RecentRows = 7;

    /// <summary>แถวในแผงสลิป/คืนเงินของหน้าภาพรวม ต้องการแค่รหัส ชื่อผู้จอง ยอด สถานะ และชนิดรายการ</summary>
    private static readonly Expression<Func<Payment, OverviewQueueRow>> ToQueueRow = p => new OverviewQueueRow(
        p.Id,
        p.Booking.Id,
        p.Booking.Code,
        p.Booking.User.Name,
        p.RefundAmount ?? p.Amount,
        p.Status,
        p.Kind);

    /// <summary>
    /// สรุปภาพรวมหน้าแรกของ admin
    /// รับ now จากข้างนอกได้ เทสต์จะกำหนดเวลาเองได้และไม่พังเมื่อรันใกล้เที่ยงคืน
    /// </summary>
    public async Task<OverviewResponse> GetOverviewAsync(DateTime? at = null)
    {
        var now = at ?? time.UtcNowMs();
        var dateKey = BangkokTime.DateKey(now);
        var today = BangkokTime.DayRange(dateKey)!.Value;
        // รายได้เมื่อวานนับถึงเวลาเดียวกับตอนนี้ — ถ้าเทียบกับเมื่อวานทั้งวัน ช่วงเช้าจะติดลบทุกวันทั้งที่ขายดีกว่า
        // ไทยไม่มี DST ถอยไป 24 ชั่วโมงจึงตรงกับเวลาเดียวกันของเมื่อวานเสมอ
        var (yesterdayStart, yesterdayEnd) = (today.Start.AddHours(-24), now.AddHours(-24));

        var paidToday = await db.Bookings.AsNoTracking()
            .Where(b => b.Status == BookingStatus.PAID && b.PaidAt >= today.Start && b.PaidAt < today.End)
            .Select(b => new { b.TotalAmount, b.SeatSnapshot })
            .ToListAsync();
        var revenueYesterday = await db.Bookings
            .Where(b => b.Status == BookingStatus.PAID && b.PaidAt >= yesterdayStart && b.PaidAt < yesterdayEnd)
            .SumAsync(b => (int?)b.TotalAmount) ?? 0;
        var pendingSlips = await db.Payments.CountAsync(PaymentService.PendingSlip);
        var showtimesToday = await db.Showtimes.CountAsync(s =>
            s.Status == ShowtimeStatus.SCHEDULED && s.StartsAt >= today.Start && s.StartsAt < today.End);
        var activeHolds = await db.Bookings.CountAsync(b =>
            b.Status == BookingStatus.PENDING_PAYMENT || b.Status == BookingStatus.PENDING_VERIFICATION);
        // การจองที่จ่ายเงินแล้วแต่ถูกยกเลิก ยังต้องโอนเงินคืนลูกค้า
        var pendingRefunds = await db.Payments.CountAsync(PendingRefund);
        // enum ใน PostgreSQL เรียงตามลำดับที่ประกาศ เรียง status ก่อนจึงได้ใบที่รอตรวจขึ้นบนสุด
        var recentSlips = await db.Payments.AsNoTracking()
            .Where(PaymentService.PendingSlip.Or(p => p.Status == PaymentStatus.APPROVED || p.Status == PaymentStatus.REJECTED))
            .OrderBy(p => p.Status).ThenByDescending(p => p.SlipUploadedAt)
            .Take(RecentRows)
            .Select(ToQueueRow)
            .ToListAsync();
        var recentRefunds = await db.Payments.AsNoTracking()
            .Where(p => p.Status == PaymentStatus.REFUND_PENDING || p.Status == PaymentStatus.REFUNDED)
            .OrderBy(p => p.Status).ThenByDescending(p => p.UpdatedAt)
            .Take(RecentRows)
            .Select(ToQueueRow)
            .ToListAsync();

        return new OverviewResponse(
            dateKey,
            now,
            paidToday.Sum(b => b.TotalAmount),
            revenueYesterday,
            paidToday.Count,
            paidToday.Sum(b => b.SeatSnapshot?.Count ?? 0),
            pendingSlips,
            showtimesToday,
            activeHolds,
            pendingRefunds,
            recentSlips,
            recentRefunds);
    }

    /// <summary>
    /// รายงานยอดขาย — นับเฉพาะการจองที่ชำระเงินแล้ว (สถานะ PAID)
    /// groupBy: day | movie | theatre
    /// </summary>
    public async Task<SalesReportResponse> GetSalesReportAsync(string? from, string? to, string? groupBy)
    {
        groupBy ??= "day";
        var start = from is null ? null : BangkokTime.DayRange(from)?.Start;
        var end = to is null ? null : BangkokTime.DayRange(to)?.End;

        var paid = db.Bookings.AsNoTracking().Where(b => b.Status == BookingStatus.PAID);
        if (start is not null) paid = paid.Where(b => b.PaidAt >= start);
        if (end is not null) paid = paid.Where(b => b.PaidAt < end);
        // อ่านการจองทั้งช่วงทีเดียว (อาจเป็นหลักพันใบ) แบบ join จะส่งข้อมูลรอบ/หนัง/โรงซ้ำมาทุกแถว
        // จึงเลือกเฉพาะคอลัมน์ที่ใช้จริง
        var bookings = await paid
            .OrderBy(b => b.PaidAt)
            .Select(b => new
            {
                b.PaidAt,
                b.CreatedAt,
                b.TotalAmount,
                b.SeatSnapshot,
                MovieId = b.Showtime.Movie.Id,
                b.Showtime.Movie.TitleTh,
                b.Showtime.Movie.TitleEn,
                TheatreId = b.Showtime.Theatre.Id,
                TheatreName = b.Showtime.Theatre.Name,
            })
            .ToListAsync();

        // ลำดับกลุ่มตามที่เจอครั้งแรก (การจองเรียงตามเวลาจ่าย) — ยอดเท่ากันจะได้ลำดับเดิมทุกครั้งเหมือน Map ของ JS
        var rows = new List<SalesReportRow>();
        var byKey = new Dictionary<string, SalesReportRow>(StringComparer.Ordinal);
        foreach (var booking in bookings)
        {
            var (key, label, labelEn) = groupBy switch
            {
                "movie" => (booking.MovieId, booking.TitleTh, booking.TitleEn),
                "theatre" => (booking.TheatreId, booking.TheatreName, booking.TheatreName),
                _ => DayGroup(BangkokTime.DateKey(booking.PaidAt ?? booking.CreatedAt)),
            };
            if (!byKey.TryGetValue(key, out var row))
            {
                row = new SalesReportRow { Key = key, Label = label, LabelEn = labelEn };
                byKey[key] = row;
                rows.Add(row);
            }
            row.Bookings += 1;
            row.Tickets += booking.SeatSnapshot?.Count ?? 0;
            row.Revenue += booking.TotalAmount;
        }

        var sorted = groupBy == "day"
            ? rows.OrderBy(row => row.Key, StringComparer.Ordinal).ToList()
            : rows.OrderByDescending(row => row.Revenue).ToList();

        // เงินที่ต้องคืน/คืนแล้วในช่วงเวลาเดียวกัน — ยกเลิกหลังจ่าย ยกเลิกทั้งรอบ หรือคืนส่วนต่างเปลี่ยนที่นั่ง
        // เดิมรายได้จะหายไปจากรายงานเงียบ ๆ ทำให้ตัวเลขไม่ตรงกับเงินที่อยู่ในบัญชีจริง
        // นับตามวันที่เข้าคิวคืนเงิน (refundDueAt) ไม่ใช่วันยกเลิก เพราะส่วนต่างที่คืนจากการย้ายไปที่ถูกกว่าไม่มีวันยกเลิก
        var refundQuery = db.Payments.AsNoTracking()
            .Where(p => p.Status == PaymentStatus.REFUND_PENDING || p.Status == PaymentStatus.REFUNDED);
        if (start is not null) refundQuery = refundQuery.Where(p => p.RefundDueAt >= start);
        if (end is not null) refundQuery = refundQuery.Where(p => p.RefundDueAt < end);
        var refundPayments = await refundQuery.Select(p => new { p.Amount, p.RefundAmount, p.Status }).ToListAsync();
        // ยอดที่โอนคืนจริง — การจองที่เคยเปลี่ยนที่นั่ง ยอดคืนไม่เท่ายอดที่จ่ายตอนจอง
        var pending = refundPayments.Where(p => p.Status == PaymentStatus.REFUND_PENDING).ToList();
        var refunds = new SalesReportRefunds(
            refundPayments.Count,
            refundPayments.Sum(p => p.RefundAmount ?? p.Amount),
            pending.Count,
            pending.Sum(p => p.RefundAmount ?? p.Amount));

        return new SalesReportResponse(
            groupBy,
            from,
            to,
            sorted,
            refunds,
            new SalesReportTotals(sorted.Sum(r => r.Bookings), sorted.Sum(r => r.Tickets), sorted.Sum(r => r.Revenue)));

        static (string, string, string) DayGroup(string key) => (key, key, key);
    }

    /// <summary>
    /// อัตราการเต็มของแต่ละรอบฉาย (ที่นั่งที่ถูกยึด ÷ ที่นั่งที่เปิดขาย)
    /// นับชุดเดียวกับจำนวนว่างในรายการรอบฉาย รอบที่ขายหมดจึงเป็น 100% แม้โรงจะมีที่นั่งที่ปิดใช้งานอยู่
    /// </summary>
    public async Task<List<OccupancyRow>> GetOccupancyReportAsync(string? from, string? to)
    {
        var start = from is null ? time.UtcNowMs() : BangkokTime.DayRange(from)?.Start;
        var end = to is null ? null : BangkokTime.DayRange(to)?.End;

        var query = db.Showtimes.AsNoTracking().Where(s => s.Status == ShowtimeStatus.SCHEDULED);
        if (start is not null) query = query.Where(s => s.StartsAt >= start);
        if (end is not null) query = query.Where(s => s.StartsAt < end);

        var showtimes = await query
            // หลายโรงเริ่มเวลาเดียวกันได้ — เรียงต่อด้วยชื่อโรง ลำดับในตารางจะไม่สลับไปมา (เหมือนรายการรอบฉาย)
            .OrderBy(s => s.StartsAt).ThenBy(s => s.Theatre.Name)
            .Take(200)
            .Select(s => new
            {
                s.Id,
                s.StartsAt,
                s.Movie.TitleTh,
                s.Movie.TitleEn,
                TheatreName = s.Theatre.Name,
                Total = s.Theatre.Seats.Count(seat => seat.IsActive),
                Sold = s.BookingSeats.Count(bs => bs.Seat.IsActive),
            })
            .ToListAsync();

        return showtimes.Select(s => new OccupancyRow(
            s.Id,
            s.StartsAt,
            new OccupancyMovie(s.TitleTh, s.TitleEn),
            s.TheatreName,
            s.Total,
            s.Sold,
            // Math.round ของ JS (ปัดครึ่งขึ้น) — Math.Round ของ .NET ปัดครึ่งเข้าหาเลขคู่
            s.Total > 0 ? (int)Math.Floor((double)s.Sold / s.Total * 100 + 0.5) : 0)).ToList();
    }

    /// <summary>CSV ของรายงานยอดขาย — ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยถูก</summary>
    public static string SalesReportToCsv(SalesReportResponse report)
    {
        var lines = new List<string> { "key,label,bookings,tickets,revenue_baht" };
        lines.AddRange(report.Rows.Select(row =>
            string.Join(',', row.Key, $"\"{row.Label.Replace("\"", "\"\"", StringComparison.Ordinal)}\"", row.Bookings, row.Tickets, row.Revenue)));
        lines.Add(string.Join(',', "TOTAL", "\"\"", report.Totals.Bookings, report.Totals.Tickets, report.Totals.Revenue));
        var csv = new StringBuilder("﻿");
        csv.AppendJoin("\r\n", lines).Append("\r\n");
        return csv.ToString();
    }
}
