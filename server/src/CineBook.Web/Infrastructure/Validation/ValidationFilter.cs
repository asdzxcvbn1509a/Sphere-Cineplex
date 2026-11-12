using System.Text.Json;
using CineBook.Web.Infrastructure.Errors;
using FluentValidation;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace CineBook.Web.Infrastructure.Validation;

/// <summary>
/// ตรวจ body/query ของทุก action ด้วย FluentValidation (แทน validate({ body, query }) ของ zod เดิม)
/// ไม่ผ่าน → 422 VALIDATION_ERROR พร้อม details: [{ field, message }] — field เป็น camelCase แบบ seatIds.0
///
/// ทำงานหลัง rate limit (Order สูงกว่า) เหมือนลำดับ middleware เดิม: คำขอที่ข้อมูลผิดก็ยังถูกนับโควตา
/// (เช่น สมัครไม่สำเร็จเกิน 30 ครั้ง — หน้าสมัครจะได้ไม่กลายเป็นเครื่องมือไล่เช็กอีเมล)
/// </summary>
public sealed class ValidationFilter(IServiceProvider services) : IAsyncActionFilter, IOrderedFilter
{
    public int Order => 100;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var errors = new List<FieldError>();

        // แปลง JSON/ค่าใน query ไม่ได้ (ชนิดไม่ตรง ตัวเลขผิดรูป ฯลฯ) — ถือเป็นข้อมูลไม่ถูกต้องแบบเดียวกัน
        foreach (var (key, entry) in context.ModelState)
        {
            if (entry.ValidationState != ModelValidationState.Invalid) continue;
            foreach (var error in entry.Errors)
            {
                // body ที่ไม่ใช่ JSON — express.json ข้ามไปเฉย ๆ แล้ว validate() ตรวจเป็น {} (สร้างค่าว่างด้านล่าง)
                if (error.Exception is UnsupportedContentTypeException) continue;
                errors.Add(new FieldError(FieldName(key), "ข้อมูลไม่ถูกต้อง"));
            }
        }

        // body ว่าง/ไม่ใช่ JSON = {} (req.body ?? {}) — schema ที่ทุกช่องไม่บังคับจึงผ่าน ส่วนช่องบังคับได้ข้อความของช่องนั้น
        foreach (var parameter in context.ActionDescriptor.Parameters)
        {
            if (parameter.BindingInfo?.BindingSource != BindingSource.Body) continue;
            if (context.ActionArguments.TryGetValue(parameter.Name, out var value) && value is not null) continue;
            context.ActionArguments[parameter.Name] = Activator.CreateInstance(parameter.ParameterType);
        }

        if (errors.Count == 0)
        {
            foreach (var argument in context.ActionArguments.Values)
            {
                if (argument is null) continue;
                // จัดรูปก่อนตรวจ (ตัดช่องว่าง ฯลฯ) แบบ transform ของ zod — action ได้ค่าที่จัดรูปแล้ว
                if (argument is INormalizable normalizable) normalizable.Normalize();
                var validatorType = typeof(IValidator<>).MakeGenericType(argument.GetType());
                if (services.GetService(validatorType) is not IValidator validator) continue;
                var result = await validator.ValidateAsync(new ValidationContext<object>(argument), context.HttpContext.RequestAborted);
                errors.AddRange(result.Errors.Select(e => new FieldError(FieldName(e.PropertyName), e.ErrorMessage)));
            }
        }

        if (errors.Count > 0) throw new RequestValidationException(errors);
        await next();
    }

    /// <summary>Seats[0].Id / $.seatIds[0] → seats.0.id / seatIds.0 (รูปเดียวกับ issue.path.join('.') ของ zod)</summary>
    public static string FieldName(string key)
    {
        var path = key.TrimStart('$').TrimStart('.');
        var parts = path
            .Replace("[", ".", StringComparison.Ordinal)
            .Replace("]", "", StringComparison.Ordinal)
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => JsonNamingPolicy.CamelCase.ConvertName(part));
        return string.Join('.', parts);
    }
}
