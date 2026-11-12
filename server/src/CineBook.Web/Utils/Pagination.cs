using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Utils;

public sealed record PageResult<T>(List<T> Rows, int Total, int Page, int PageSize);

/// <summary>
/// แบ่งหน้ารายการฝั่งผู้ดูแล (การจอง สลิป คืนเงิน ผู้ใช้)
/// เดิมทุกรายการตัดที่ 100 แถวล่าสุดตายตัว ข้อมูลที่เก่ากว่านั้นเปิดดูจากหน้าเว็บไม่ได้เลย
/// </summary>
public static class Pagination
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;

    public static (int Page, int PageSize, int Skip, int Take) ToPage(int? page, int? pageSize)
    {
        var p = page ?? 1;
        var size = pageSize ?? DefaultPageSize;
        return (p, size, (p - 1) * size, size);
    }

    /// <summary>
    /// อ่านหนึ่งหน้าของรายการพร้อมจำนวนทั้งหมด
    /// filtered = เงื่อนไขอย่างเดียว (ใช้นับ) · ordered = filtered ที่เรียงและ include แล้ว (ควรเรียงลงท้ายด้วย id ให้ลำดับคงที่ระหว่างหน้า)
    ///
    /// อ่านอย่างเดียว ห่อ transaction ก็ไม่ได้ทำให้สองคำสั่งเห็นข้อมูลชุดเดียวกัน
    /// (READ COMMITTED แต่ละคำสั่งเห็น snapshot ของตัวเอง) จึงยิงทีละคำสั่งตรง ๆ
    /// </summary>
    public static async Task<PageResult<T>> FindPageAsync<T>(
        IQueryable<T> filtered,
        Func<IQueryable<T>, IQueryable<T>> ordered,
        int? page,
        int? pageSize,
        CancellationToken ct = default)
    {
        var paging = ToPage(page, pageSize);
        var rows = await ordered(filtered).Skip(paging.Skip).Take(paging.Take).ToListAsync(ct);
        var total = await filtered.CountAsync(ct);
        return new PageResult<T>(rows, total, paging.Page, paging.PageSize);
    }

    /// <summary>แบบเดียวกัน แต่แปลงแต่ละแถวเป็นรูปที่ส่งออกในคำสั่งเดียวกัน (Select หลังเรียงและตัดหน้าแล้ว)</summary>
    public static async Task<PageResult<TResult>> FindPageAsync<T, TResult>(
        IQueryable<T> filtered,
        Func<IQueryable<T>, IQueryable<T>> ordered,
        System.Linq.Expressions.Expression<Func<T, TResult>> select,
        int? page,
        int? pageSize,
        CancellationToken ct = default)
    {
        var paging = ToPage(page, pageSize);
        var rows = await ordered(filtered).Skip(paging.Skip).Take(paging.Take).Select(select).ToListAsync(ct);
        var total = await filtered.CountAsync(ct);
        return new PageResult<TResult>(rows, total, paging.Page, paging.PageSize);
    }
}
