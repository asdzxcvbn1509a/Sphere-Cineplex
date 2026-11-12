using CineBook.Web.Models.Entities;

namespace CineBook.Web.Models.Responses;

/// <summary>ตัวเลขงานค้างสำหรับป้ายบน sidebar (+ ยอดรวมที่ต้องโอนคืน)</summary>
public sealed record QueueCountsResponse(int PendingSlips, int PendingRefunds, int PendingRefundAmount);

/// <summary>แถวในแผงสลิป/คืนเงินของหน้าภาพรวม</summary>
public sealed record OverviewQueueRow(
    string Id,
    string BookingId,
    string Code,
    string Customer,
    // แถวคืนเงินแสดงยอดที่ต้องโอนคืนจริง ส่วนแถวสลิปไม่มี refundAmount จึงเป็นยอดที่โอนเข้ามา
    int Amount,
    PaymentStatus Status,
    // แผงคืนเงินใช้บอกว่าคืนเพราะยกเลิกการจอง หรือคืนส่วนต่างจากการเปลี่ยนที่นั่ง
    PaymentKind Kind);

public sealed record OverviewResponse(
    string Date,
    // เวลาที่นับตัวเลขชุดนี้ — หน้าเว็บโชว์เป็น "ข้อมูล ณ …" และเป็นเวลาตัดของรายได้เมื่อวาน
    DateTime GeneratedAt,
    int RevenueToday,
    int RevenueYesterday,
    int BookingsToday,
    int TicketsToday,
    int PendingSlips,
    int ShowtimesToday,
    int ActiveHolds,
    int PendingRefunds,
    List<OverviewQueueRow> RecentSlips,
    List<OverviewQueueRow> RecentRefunds);

/// <summary>หนึ่งกลุ่มของรายงานยอดขาย (วัน/หนัง/โรง)</summary>
public sealed class SalesReportRow
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required string LabelEn { get; init; }
    public int Bookings { get; set; }
    public int Tickets { get; set; }
    public int Revenue { get; set; }
}

public sealed record SalesReportRefunds(int Count, int Amount, int PendingCount, int PendingAmount);

public sealed record SalesReportTotals(int Bookings, int Tickets, int Revenue);

public sealed record SalesReportResponse(
    string GroupBy,
    string? From,
    string? To,
    List<SalesReportRow> Rows,
    SalesReportRefunds Refunds,
    SalesReportTotals Totals);

public sealed record OccupancyMovie(string TitleTh, string TitleEn);

public sealed record OccupancyRow(
    string ShowtimeId,
    DateTime StartsAt,
    OccupancyMovie Movie,
    string Theatre,
    int TotalSeats,
    int SoldSeats,
    int Occupancy);
