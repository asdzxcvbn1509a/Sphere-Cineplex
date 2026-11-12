using System.Linq.Expressions;

namespace CineBook.Web.Utils;

/// <summary>เรียงตามทิศที่ผู้ใช้เลือก (sort=newest/oldest) — Prisma เขียนเป็น { field: direction } ได้ตรง ๆ</summary>
public static class QueryOrdering
{
    /// <summary>descending = true เรียงจากมากไปน้อย</summary>
    public static IOrderedQueryable<T> OrderBy<T, TKey>(this IQueryable<T> query, Expression<Func<T, TKey>> key, bool descending) =>
        descending ? query.OrderByDescending(key) : query.OrderBy(key);

    public static IOrderedQueryable<T> ThenBy<T, TKey>(this IOrderedQueryable<T> query, Expression<Func<T, TKey>> key, bool descending) =>
        descending ? query.ThenByDescending(key) : query.ThenBy(key);
}
