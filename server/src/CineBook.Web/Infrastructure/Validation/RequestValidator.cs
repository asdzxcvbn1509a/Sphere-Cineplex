using System.Linq.Expressions;
using System.Text.RegularExpressions;
using CineBook.Web.Utils;
using FluentValidation;

namespace CineBook.Web.Infrastructure.Validation;

/// <summary>
/// คำขอที่ต้องจัดรูปก่อนตรวจ (แทน transform ของ zod เช่น .trim()) — ValidationFilter เรียกก่อนตรวจเสมอ
/// ค่าที่ผ่านการตรวจจึงเป็นค่าที่ตัดช่องว่างแล้ว ตรงกับที่ service ได้รับ
/// </summary>
public interface INormalizable
{
    void Normalize();
}

/// <summary>
/// ตัวช่วยเขียนกฎแบบเดียวกับ zod schema เดิม — ข้อความภาษาไทยตามที่ตั้งไว้ใน routes/*.js
/// (ข้อความที่ zod ใช้ค่าเริ่มต้นภาษาอังกฤษ เปลี่ยนเป็นภาษาไทยที่ความหมายเดียวกัน — code ยังเป็น VALIDATION_ERROR เหมือนเดิม)
/// ไม่ส่งช่องที่บังคับมา ได้ข้อความเดียวของช่องนั้น · ส่งมาแล้วตรวจทุกกฎต่อกันแบบ zod
/// </summary>
public abstract partial class RequestValidator<T> : AbstractValidator<T>
{
    public const string Invalid = "ข้อมูลไม่ถูกต้อง";

    public static string TooLong(int max) => $"ต้องไม่เกิน {max} ตัวอักษร";

    // รูปแบบอีเมลเดียวกับ z.email() ของ zod 4
    [GeneratedRegex("^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    private static partial Regex DateKeyPattern();

    public static bool IsEmail(string? value) => value is not null && EmailPattern().IsMatch(value);

    public static bool IsDateKey(string? value) => value is not null && DateKeyPattern().IsMatch(value);

    /// <summary>สตริงบังคับ min..max ตัว (ค่าตัดช่องว่างแล้ว)</summary>
    protected void RequiredText(Expression<Func<T, string?>> property, int min, int max, string? minMessage = null)
    {
        var tooShort = minMessage ?? (min <= 1 ? "กรุณากรอกข้อมูล" : $"ต้องยาวอย่างน้อย {min} ตัวอักษร");
        RuleFor(property).NotNull().WithMessage(tooShort).DependentRules(() =>
        {
            RuleFor(property).Must(v => v!.Length >= min).WithMessage(tooShort);
            RuleFor(property).Must(v => v!.Length <= max).WithMessage(TooLong(max));
        });
    }

    /// <summary>สตริงที่ไม่ส่งมาก็ได้ — ถ้าส่งมาต้องยาว min..max ตัว</summary>
    protected void OptionalText(Expression<Func<T, string?>> property, int min, int max, string? minMessage = null)
    {
        var tooShort = minMessage ?? (min <= 1 ? "กรุณากรอกข้อมูล" : $"ต้องยาวอย่างน้อย {min} ตัวอักษร");
        if (min > 0) RuleFor(property).Must(v => v is null || v.Length >= min).WithMessage(tooShort);
        RuleFor(property).Must(v => v is null || v.Length <= max).WithMessage(TooLong(max));
    }

    protected void Email(Expression<Func<T, string?>> property, bool required, string message = "อีเมลไม่ถูกต้อง", int max = 120)
    {
        if (required) RuleFor(property).NotNull().WithMessage(message);
        RuleFor(property).Must(v => v is null || IsEmail(v)).WithMessage(message);
        RuleFor(property).Must(v => v is null || v.Length <= max).WithMessage(TooLong(max));
    }

    /// <summary>เกณฑ์รหัสผ่านเดียวกันทุกทางที่ตั้งรหัสได้ (สมัคร, เปลี่ยนเอง, ผู้ดูแลตั้งให้, ลืมรหัสผ่าน)</summary>
    protected void Password(Expression<Func<T, string?>> property)
    {
        RuleFor(property).NotNull().WithMessage($"รหัสผ่านต้องยาวอย่างน้อย {PasswordRules.MinLength} ตัวอักษร").DependentRules(() =>
        {
            RuleFor(property).Custom((value, context) =>
            {
                foreach (var message in PasswordRules.Violations(value)) context.AddFailure(message);
            });
        });
    }

    protected void OneOf(Expression<Func<T, string?>> property, IReadOnlyCollection<string> allowed, bool required = false)
    {
        if (required) RuleFor(property).NotNull().WithMessage(Invalid);
        RuleFor(property).Must(v => v is null || allowed.Contains(v)).WithMessage(Invalid);
    }

    /// <summary>boolean ใน query string — รับเฉพาะ 'true' / 'false' (สตริงอื่นได้ 422 ไม่ใช่ถูกตีความเป็น true)</summary>
    protected void QueryBoolean(Expression<Func<T, string?>> property) => OneOf(property, ["true", "false"]);

    protected void DateKey(Expression<Func<T, string?>> property, bool required = false)
    {
        if (required) RuleFor(property).NotNull().WithMessage(Invalid);
        RuleFor(property).Must(v => v is null || IsDateKey(v)).WithMessage(Invalid);
    }

    protected void IntRange(Expression<Func<T, int?>> property, int min, int max, bool required, string? minMessage = null)
    {
        if (required) RuleFor(property).NotNull().WithMessage(minMessage ?? Invalid);
        RuleFor(property).Must(v => v is null || v >= min).WithMessage(minMessage ?? $"ต้องไม่น้อยกว่า {min}");
        RuleFor(property).Must(v => v is null || v <= max).WithMessage($"ต้องไม่เกิน {max}");
    }

    /// <summary>รายการ id ที่ต้องมีอย่างน้อย 1 รายการ และแต่ละรายการไม่ว่าง</summary>
    protected void IdList(Expression<Func<T, List<string>?>> property, string minMessage, int? max = null, string? maxMessage = null)
    {
        RuleFor(property).NotNull().WithMessage(minMessage).DependentRules(() =>
        {
            RuleFor(property).Must(v => v!.Count >= 1).WithMessage(minMessage);
            if (max is not null) RuleFor(property).Must(v => v!.Count <= max).WithMessage(maxMessage ?? $"ต้องไม่เกิน {max} รายการ");
            // ชี้ช่องที่ผิดเป็นราย index แบบ zod (seatIds.0)
            RuleFor(property).Custom((ids, context) =>
            {
                for (var i = 0; i < ids!.Count; i += 1)
                {
                    if (string.IsNullOrEmpty(ids[i])) context.AddFailure($"{context.PropertyPath}[{i}]", Invalid);
                }
            });
        });
    }

    /// <summary>pagination ของรายการฝั่งผู้ดูแล — page ≥ 1, pageSize 1–100</summary>
    protected void Paging(Expression<Func<T, int?>> page, Expression<Func<T, int?>> pageSize)
    {
        RuleFor(page).Must(v => v is null || v >= 1).WithMessage("ต้องไม่น้อยกว่า 1");
        RuleFor(pageSize).Must(v => v is null || v is >= 1 and <= Pagination.MaxPageSize)
            .WithMessage($"ต้องอยู่ระหว่าง 1–{Pagination.MaxPageSize}");
    }
}

public static class TextNormalization
{
    /// <summary>.trim() ของ zod — null คงเป็น null (ช่องที่ไม่ได้ส่งมา)</summary>
    public static string? Trim(string? value) => value?.Trim();
}
