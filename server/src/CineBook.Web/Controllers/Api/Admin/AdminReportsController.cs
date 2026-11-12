using CineBook.Web.Models.Requests;
using CineBook.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers.Api.Admin;

/// <summary>ภาพรวม ป้ายงานค้าง และรายงาน — ผู้ดูแลระบบเท่านั้น</summary>
[Route("api/admin")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminReportsController(ReportService reports) : ApiControllerBase
{
    // @ENDPOINT GET http://localhost:4000/api/admin/overview
    [HttpGet("overview")]
    public async Task<IActionResult> Overview() => Ok(await reports.GetOverviewAsync());

    // @ENDPOINT GET http://localhost:4000/api/admin/queue-counts
    [HttpGet("queue-counts")]
    public async Task<IActionResult> QueueCounts() => Ok(await reports.GetQueueCountsAsync());

    // @ENDPOINT GET http://localhost:4000/api/admin/reports/sales
    [HttpGet("reports/sales")]
    public async Task<IActionResult> Sales([FromQuery] ReportQuery query) =>
        Ok(await reports.GetSalesReportAsync(query.From, query.To, query.GroupBy));

    // @ENDPOINT GET http://localhost:4000/api/admin/reports/sales.csv
    [HttpGet("reports/sales.csv")]
    public async Task<IActionResult> SalesCsv([FromQuery] ReportQuery query)
    {
        var report = await reports.GetSalesReportAsync(query.From, query.To, query.GroupBy);
        Response.Headers.ContentDisposition = "attachment; filename=\"sales-report.csv\"";
        return Content(ReportService.SalesReportToCsv(report), "text/csv; charset=utf-8");
    }

    // @ENDPOINT GET http://localhost:4000/api/admin/reports/occupancy
    [HttpGet("reports/occupancy")]
    public async Task<IActionResult> Occupancy([FromQuery] ReportQuery query) =>
        Ok(new { showtimes = await reports.GetOccupancyReportAsync(query.From, query.To) });
}
