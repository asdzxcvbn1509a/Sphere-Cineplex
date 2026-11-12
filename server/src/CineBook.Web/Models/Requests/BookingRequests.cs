using System.Text.RegularExpressions;
using CineBook.Web.Infrastructure.Validation;
using CineBook.Web.Utils;
using FluentValidation;

namespace CineBook.Web.Models.Requests;

public sealed class CreateBookingRequest
{
    public string? ShowtimeId { get; set; }
    public List<string>? SeatIds { get; set; }
}

public sealed class CreateBookingRequestValidator : RequestValidator<CreateBookingRequest>
{
    public CreateBookingRequestValidator()
    {
        RequiredText(x => x.ShowtimeId, 1, int.MaxValue, "ต้องระบุรอบฉาย");
        IdList(x => x.SeatIds, "กรุณาเลือกที่นั่งอย่างน้อย 1 ที่");
    }
}

public sealed class BookingListQuery
{
    public string? Scope { get; set; }
}

public sealed class BookingListQueryValidator : RequestValidator<BookingListQuery>
{
    public BookingListQueryValidator() => OneOf(x => x.Scope, ["all", "upcoming", "history"]);
}

/// <summary>?payment= = รายการส่วนต่างเปลี่ยนที่นั่งของการจองนี้ (ไม่ส่ง = ใบหลัก ค่าตั๋วตอนจอง)</summary>
public sealed class PaymentRefQuery
{
    public string? Payment { get; set; }
}

public sealed class PaymentRefQueryValidator : RequestValidator<PaymentRefQuery>
{
    public PaymentRefQueryValidator() => OptionalText(x => x.Payment, 1, int.MaxValue);
}

/// <summary>
/// บัญชีรับเงินคืน — เลขบัญชีไทยมี 10-15 หลัก ผู้ใช้มักพิมพ์ขีดหรือเว้นวรรคมาด้วย จึงตัดทิ้งก่อนตรวจ
/// ชื่อเจ้าของบัญชีไม่บังคับใน API เพื่อให้ client รุ่นก่อนที่ยังไม่มีช่องนี้ยกเลิก/แจ้งบัญชีได้ตามเดิม
/// (ฟอร์มของเว็บบังคับกรอกเอง) แต่ถ้าส่งมาต้องเป็นชื่อจริง ไม่ใช่ช่องว่าง
/// </summary>
public abstract partial class RefundAccountFields : INormalizable
{
    public string? RefundBankName { get; set; }
    public string? RefundAccountNo { get; set; }
    public string? RefundAccountName { get; set; }

    [GeneratedRegex("[\\s-]")]
    private static partial Regex Separators();

    public virtual void Normalize()
    {
        RefundBankName = TextNormalization.Trim(RefundBankName);
        RefundAccountNo = RefundAccountNo is null ? null : Separators().Replace(RefundAccountNo.Trim(), "");
        RefundAccountName = TextNormalization.Trim(RefundAccountName);
    }
}

public static partial class RefundAccountRules
{
    [GeneratedRegex("^[0-9]{10,15}$")]
    private static partial Regex AccountNo();

    public static void Apply<T>(RequestValidator<T> validator, AbstractValidator<T> rules, bool required) where T : RefundAccountFields
    {
        if (required)
        {
            rules.RuleFor(x => x.RefundBankName).NotNull().WithMessage("กรุณาระบุธนาคาร");
            rules.RuleFor(x => x.RefundAccountNo).NotNull().WithMessage("เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก");
        }
        rules.RuleFor(x => x.RefundBankName).Must(v => v is null || v.Length >= 2).WithMessage("กรุณาระบุธนาคาร");
        rules.RuleFor(x => x.RefundBankName).Must(v => v is null || v.Length <= 60).WithMessage(RequestValidator<T>.TooLong(60));
        rules.RuleFor(x => x.RefundAccountNo).Must(v => v is null || AccountNo().IsMatch(v)).WithMessage("เลขที่บัญชีต้องเป็นตัวเลข 10-15 หลัก");
        rules.RuleFor(x => x.RefundAccountName).Must(v => v is null || v.Length >= 2).WithMessage("กรุณาระบุชื่อบัญชี");
        rules.RuleFor(x => x.RefundAccountName).Must(v => v is null || v.Length <= 100).WithMessage("ชื่อบัญชียาวเกิน 100 ตัวอักษร");
    }
}

/// <summary>ยกเลิกการจอง — บัญชีสำหรับรับเงินคืนจำเป็นเฉพาะการจองที่ชำระเงินไปแล้ว (service เป็นคนบังคับ)</summary>
public sealed class CancelBookingRequest : RefundAccountFields
{
    public string? Reason { get; set; }

    public override void Normalize()
    {
        base.Normalize();
        Reason = TextNormalization.Trim(Reason);
    }
}

public sealed class CancelBookingRequestValidator : RequestValidator<CancelBookingRequest>
{
    public CancelBookingRequestValidator()
    {
        OptionalText(x => x.Reason, 0, 200);
        RefundAccountRules.Apply(this, this, required: false);
    }
}

/// <summary>แจ้งบัญชีภายหลัง (ใบที่ผู้ดูแลยกเลิกแทน) — มาทีหลังจึงต้องส่งธนาคารและเลขบัญชีครบทั้งคู่</summary>
public sealed class RefundAccountRequest : RefundAccountFields;

public sealed class RefundAccountRequestValidator : RequestValidator<RefundAccountRequest>
{
    public RefundAccountRequestValidator() => RefundAccountRules.Apply(this, this, required: true);
}

/// <summary>
/// เปลี่ยนที่นั่ง — ส่งชุดที่นั่งใหม่ทั้งชุด (รวมที่นั่งที่คงไว้) จำนวนต้องเท่าเดิม (service เป็นคนบังคับ)
/// บัญชีรับเงินคืนจำเป็นเฉพาะตอนย้ายไปที่ที่ถูกกว่า
/// </summary>
public sealed class SeatChangeRequest : RefundAccountFields
{
    public List<string>? SeatIds { get; set; }
}

public sealed class SeatChangeRequestValidator : RequestValidator<SeatChangeRequest>
{
    public SeatChangeRequestValidator()
    {
        IdList(x => x.SeatIds, "กรุณาเลือกที่นั่ง");
        RefundAccountRules.Apply(this, this, required: false);
    }
}

/// <summary>ย้ายที่นั่งแทนลูกค้า — ชุดที่นั่งใหม่ทั้งชุด (โซนเดียวกับเดิมทุกที่ service เป็นคนบังคับ) และเหตุผลที่ลูกค้าจะเห็นในแจ้งเตือน</summary>
public sealed class AdminChangeSeatsRequest : INormalizable
{
    public List<string>? SeatIds { get; set; }
    public string? Reason { get; set; }

    public void Normalize() => Reason = TextNormalization.Trim(Reason);
}

public sealed class AdminChangeSeatsRequestValidator : RequestValidator<AdminChangeSeatsRequest>
{
    public AdminChangeSeatsRequestValidator()
    {
        IdList(x => x.SeatIds, "กรุณาเลือกที่นั่ง");
        OptionalText(x => x.Reason, 0, 200);
    }
}

public sealed class AdminBookingListQuery : INormalizable
{
    public string? Status { get; set; }
    /// <summary>หนึ่งป้ายหรือหลายป้ายคั่นด้วยจุลภาค (ตัวกรองแบบกลุ่ม) ตรงป้ายใดป้ายหนึ่งก็ผ่าน · มีค่าที่ไม่รู้จักแม้ตัวเดียวได้ 422</summary>
    public string? DisplayStatus { get; set; }
    public string? Date { get; set; }
    public string? Q { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }

    public List<string>? DisplayStatuses => DisplayStatus?.Split(',').ToList();

    public void Normalize() => Q = TextNormalization.Trim(Q);
}

public sealed class AdminBookingListQueryValidator : RequestValidator<AdminBookingListQuery>
{
    public AdminBookingListQueryValidator()
    {
        OneOf(x => x.Status, ["PENDING_PAYMENT", "PENDING_VERIFICATION", "PAID", "CANCELLED", "EXPIRED"]);
        // ป้ายที่ไม่รู้จักรายงานทีละตัวตามตำแหน่ง (displayStatus.1) แบบ issue.path ของ zod เดิม
        RuleFor(x => x.DisplayStatus).Custom((value, context) =>
        {
            if (value is null) return;
            var statuses = value.Split(',');
            for (var i = 0; i < statuses.Length; i += 1)
            {
                if (!BookingDisplayStatus.All.Contains(statuses[i])) context.AddFailure($"{context.PropertyPath}[{i}]", Invalid);
            }
        });
        DateKey(x => x.Date);
        OptionalText(x => x.Q, 1, 60);
        Paging(x => x.Page, x => x.PageSize);
    }
}

public sealed class PaymentListQuery
{
    public string? Status { get; set; }
    /// <summary>เรียงตามเวลาที่ส่งสลิป — ไม่ส่งมา = เก่าสุดก่อน (ใครส่งก่อนได้ตรวจก่อน)</summary>
    public string? Sort { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

public sealed class PaymentListQueryValidator : RequestValidator<PaymentListQuery>
{
    public PaymentListQueryValidator()
    {
        OneOf(x => x.Status, ["AWAITING_SLIP", "PENDING_VERIFICATION", "APPROVED", "REJECTED", "ALL"]);
        OneOf(x => x.Sort, ["oldest", "newest"]);
        Paging(x => x.Page, x => x.PageSize);
    }
}

public sealed class RejectPaymentRequest : INormalizable
{
    public string? Reason { get; set; }

    public void Normalize() => Reason = TextNormalization.Trim(Reason);
}

public sealed class RejectPaymentRequestValidator : RequestValidator<RejectPaymentRequest>
{
    public RejectPaymentRequestValidator() => RequiredText(x => x.Reason, 1, 200, "กรุณาระบุเหตุผลที่ปฏิเสธ");
}

public sealed class RefundListQuery
{
    public string? Status { get; set; }
    /// <summary>ไม่ส่งมา = ลำดับเดิมของแต่ละสถานะ (รอคืน: ค้างนานสุดก่อน · คืนแล้ว: ล่าสุดก่อน)</summary>
    public string? Sort { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

public sealed class RefundListQueryValidator : RequestValidator<RefundListQuery>
{
    public RefundListQueryValidator()
    {
        OneOf(x => x.Status, ["REFUND_PENDING", "REFUNDED", "ALL"]);
        OneOf(x => x.Sort, ["oldest", "newest"]);
        Paging(x => x.Page, x => x.PageSize);
    }
}

public sealed class ReportQuery
{
    public string? From { get; set; }
    public string? To { get; set; }
    public string? GroupBy { get; set; }
}

public sealed class ReportQueryValidator : RequestValidator<ReportQuery>
{
    public ReportQueryValidator()
    {
        DateKey(x => x.From);
        DateKey(x => x.To);
        OneOf(x => x.GroupBy, ["day", "movie", "theatre"]);
    }
}
