using System.Linq.Expressions;

namespace CineBook.Web.Utils;

/// <summary>
/// ต่อเงื่อนไข LINQ (Expression) ด้วย AND / OR / NOT แล้วยังแปลเป็น SQL ได้ — แทน { AND, OR, NOT } ของ where ใน Prisma
/// ทุกเงื่อนไขถูกเขียนใหม่ให้ใช้พารามิเตอร์ตัวเดียวกัน ไม่งั้น EF แปลเป็น SQL ไม่ได้
/// </summary>
public static class Predicates
{
    public static Expression<Func<T, bool>> And<T>(this Expression<Func<T, bool>> left, Expression<Func<T, bool>> right) =>
        Combine(left, right, Expression.AndAlso);

    public static Expression<Func<T, bool>> Or<T>(this Expression<Func<T, bool>> left, Expression<Func<T, bool>> right) =>
        Combine(left, right, Expression.OrElse);

    public static Expression<Func<T, bool>> Not<T>(this Expression<Func<T, bool>> expression) =>
        Expression.Lambda<Func<T, bool>>(Expression.Not(expression.Body), expression.Parameters);

    public static Expression<Func<T, bool>> AnyOf<T>(IReadOnlyList<Expression<Func<T, bool>>> expressions) =>
        expressions.Count == 0 ? _ => false : expressions.Skip(1).Aggregate(expressions[0], (acc, next) => acc.Or(next));

    public static Expression<Func<T, bool>> AllOf<T>(IReadOnlyList<Expression<Func<T, bool>>> expressions) =>
        expressions.Count == 0 ? _ => true : expressions.Skip(1).Aggregate(expressions[0], (acc, next) => acc.And(next));

    private static Expression<Func<T, bool>> Combine<T>(
        Expression<Func<T, bool>> left,
        Expression<Func<T, bool>> right,
        Func<Expression, Expression, BinaryExpression> merge)
    {
        var parameter = left.Parameters[0];
        var rightBody = new ReplaceParameter(right.Parameters[0], parameter).Visit(right.Body);
        return Expression.Lambda<Func<T, bool>>(merge(left.Body, rightBody), parameter);
    }

    private sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
