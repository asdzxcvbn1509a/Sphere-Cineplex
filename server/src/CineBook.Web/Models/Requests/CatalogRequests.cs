using CineBook.Web.Infrastructure.Validation;
using CineBook.Web.Models.Entities;
using FluentValidation;

namespace CineBook.Web.Models.Requests;

public sealed class MovieListQuery : INormalizable
{
    public string? Status { get; set; }
    public string? Q { get; set; }

    public MovieStatus? StatusValue => Status is null ? null : Enum.Parse<MovieStatus>(Status);

    public void Normalize() => Q = TextNormalization.Trim(Q);
}

public sealed class MovieListQueryValidator : RequestValidator<MovieListQuery>
{
    public static readonly string[] Statuses = ["NOW_SHOWING", "COMING_SOON", "ARCHIVED"];

    public MovieListQueryValidator()
    {
        OneOf(x => x.Status, Statuses);
        OptionalText(x => x.Q, 1, 100);
    }
}

/// <summary>
/// ข้อมูลหนังจากฟอร์มผู้ดูแล — POST ใช้ค่าเริ่มต้นกับช่องที่ไม่ได้ส่ง ส่วน PATCH แก้เฉพาะช่องที่ส่งมา
/// (ฝั่ง Express เดิมใช้ movieSchema.partial() ของ zod 4 ซึ่งเติมค่าเริ่มต้นให้ช่องที่ไม่ได้ส่งด้วย
///  ปุ่ม "เก็บเข้าคลัง" ที่ส่งมาแค่ status จึงล้างเรื่องย่อ เรตติ้ง และแนวหนังทิ้ง — ที่นี่ไม่ทำแบบนั้นแล้ว)
/// </summary>
public class MovieRequest : INormalizable
{
    public string? TitleTh { get; set; }
    public string? TitleEn { get; set; }
    public string? SynopsisTh { get; set; }
    public string? SynopsisEn { get; set; }
    public string? PosterUrl { get; set; }
    public string? BackdropUrl { get; set; }
    public int? DurationMin { get; set; }
    public string? Rating { get; set; }
    public List<string>? Genres { get; set; }
    public DateTime? ReleaseDate { get; set; }
    public string? Status { get; set; }

    public MovieStatus? StatusValue => Status is null ? null : Enum.Parse<MovieStatus>(Status);

    public void Normalize()
    {
        TitleTh = TextNormalization.Trim(TitleTh);
        TitleEn = TextNormalization.Trim(TitleEn);
        SynopsisTh = TextNormalization.Trim(SynopsisTh);
        SynopsisEn = TextNormalization.Trim(SynopsisEn);
        Rating = TextNormalization.Trim(Rating);
        Genres = Genres?.Select(g => g?.Trim() ?? "").ToList();
    }
}

public static class MovieRules
{
    public static bool IsUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out _);
}

public sealed class CreateMovieRequest : MovieRequest;

public sealed class UpdateMovieRequest : MovieRequest;

public abstract class MovieRequestValidatorBase<T> : RequestValidator<T> where T : MovieRequest
{
    protected void Rules(bool create)
    {
        if (create)
        {
            RequiredText(x => x.TitleTh, 1, 150, "กรุณากรอกชื่อเรื่องภาษาไทย");
            RequiredText(x => x.TitleEn, 1, 150, "กรุณากรอกชื่อเรื่องภาษาอังกฤษ");
            RuleFor(x => x.PosterUrl).NotNull().WithMessage("ลิงก์รูปโปสเตอร์ไม่ถูกต้อง");
            RuleFor(x => x.DurationMin).NotNull().WithMessage("ความยาวอย่างน้อย 30 นาที");
            RuleFor(x => x.ReleaseDate).NotNull().WithMessage(Invalid);
        }
        else
        {
            OptionalText(x => x.TitleTh, 1, 150, "กรุณากรอกชื่อเรื่องภาษาไทย");
            OptionalText(x => x.TitleEn, 1, 150, "กรุณากรอกชื่อเรื่องภาษาอังกฤษ");
        }
        OptionalText(x => x.SynopsisTh, 0, 3000);
        OptionalText(x => x.SynopsisEn, 0, 3000);
        RuleFor(x => x.PosterUrl).Must(v => v is null || MovieRules.IsUrl(v)).WithMessage("ลิงก์รูปโปสเตอร์ไม่ถูกต้อง");
        RuleFor(x => x.BackdropUrl).Must(v => v is null || v.Length == 0 || MovieRules.IsUrl(v)).WithMessage(Invalid);
        IntRange(x => x.DurationMin, 30, 400, required: false, "ความยาวอย่างน้อย 30 นาที");
        OptionalText(x => x.Rating, 0, 10);
        RuleFor(x => x.Genres).Custom((genres, context) =>
        {
            for (var i = 0; i < (genres?.Count ?? 0); i += 1)
            {
                if (string.IsNullOrEmpty(genres![i])) context.AddFailure($"Genres[{i}]", "กรุณากรอกข้อมูล");
            }
        });
        OneOf(x => x.Status, MovieListQueryValidator.Statuses);
    }
}

/// <summary>ใช้ตรวจตอนสร้าง (POST) — ช่องหลักต้องครบ</summary>
public sealed class CreateMovieValidator : MovieRequestValidatorBase<CreateMovieRequest>
{
    public CreateMovieValidator() => Rules(create: true);
}

/// <summary>ใช้ตรวจตอนแก้ (PATCH) — ส่งช่องไหนมาตรวจช่องนั้น</summary>
public sealed class UpdateMovieValidator : MovieRequestValidatorBase<UpdateMovieRequest>
{
    public UpdateMovieValidator() => Rules(create: false);
}

public sealed class DeleteMovieQuery
{
    public string? Force { get; set; }
}

public sealed class DeleteMovieQueryValidator : RequestValidator<DeleteMovieQuery>
{
    public DeleteMovieQueryValidator() => QueryBoolean(x => x.Force);
}

public class TheatreRequest : INormalizable
{
    public string? Name { get; set; }
    public string? ScreenType { get; set; }
    public int? RowsCount { get; set; }
    public int? ColsCount { get; set; }
    public bool? IsActive { get; set; }

    public void Normalize()
    {
        Name = TextNormalization.Trim(Name);
        ScreenType = TextNormalization.Trim(ScreenType);
    }
}

public sealed class CreateTheatreRequest : TheatreRequest;

public sealed class UpdateTheatreRequest : TheatreRequest;

public abstract class TheatreRequestValidatorBase<T> : RequestValidator<T> where T : TheatreRequest
{
    protected void Rules(bool create)
    {
        if (create)
        {
            RequiredText(x => x.Name, 1, 60, "กรุณาตั้งชื่อโรง");
            RuleFor(x => x.RowsCount).NotNull().WithMessage(Invalid);
            RuleFor(x => x.ColsCount).NotNull().WithMessage(Invalid);
        }
        else
        {
            OptionalText(x => x.Name, 1, 60, "กรุณาตั้งชื่อโรง");
        }
        OptionalText(x => x.ScreenType, 1, 20);
        IntRange(x => x.RowsCount, 1, 26, required: false);
        IntRange(x => x.ColsCount, 1, 30, required: false);
    }
}

public sealed class CreateTheatreValidator : TheatreRequestValidatorBase<CreateTheatreRequest>
{
    public CreateTheatreValidator() => Rules(create: true);
}

public sealed class UpdateTheatreValidator : TheatreRequestValidatorBase<UpdateTheatreRequest>
{
    public UpdateTheatreValidator() => Rules(create: false);
}

public sealed class SeatUpdateRequest
{
    public List<string>? SeatIds { get; set; }
    public string? Zone { get; set; }
    public bool? IsActive { get; set; }

    public SeatZone? ZoneValue => Zone is null ? null : Enum.Parse<SeatZone>(Zone);
}

public sealed class SeatUpdateRequestValidator : RequestValidator<SeatUpdateRequest>
{
    public SeatUpdateRequestValidator()
    {
        IdList(x => x.SeatIds, "กรุณาเลือกที่นั่ง");
        OneOf(x => x.Zone, ["NORMAL", "PREMIUM", "SOFA"]);
        RuleFor(x => x)
            .Must(x => x.Zone is not null || x.IsActive is not null)
            .WithMessage("ต้องระบุ zone หรือ isActive อย่างน้อยหนึ่งอย่าง")
            .OverridePropertyName("");
    }
}

public sealed class ShowtimeListQuery
{
    public string? MovieId { get; set; }
    public string? TheatreId { get; set; }
    public string? Date { get; set; }
    /// <summary>ฝั่งผู้ดูแลเท่านั้น</summary>
    public string? IncludePast { get; set; }
}

public sealed class ShowtimeListQueryValidator : RequestValidator<ShowtimeListQuery>
{
    public ShowtimeListQueryValidator()
    {
        OptionalText(x => x.MovieId, 1, int.MaxValue);
        OptionalText(x => x.TheatreId, 1, int.MaxValue);
        RuleFor(x => x.Date).Must(v => v is null || IsDateKey(v)).WithMessage("รูปแบบวันที่ต้องเป็น YYYY-MM-DD");
        QueryBoolean(x => x.IncludePast);
    }
}

public sealed class AvailabilityQuery
{
    public string? TheatreId { get; set; }
    public string? MovieId { get; set; }
    public string? Date { get; set; }
    public string? ExcludeId { get; set; }
}

public sealed class AvailabilityQueryValidator : RequestValidator<AvailabilityQuery>
{
    public AvailabilityQueryValidator()
    {
        RequiredText(x => x.TheatreId, 1, int.MaxValue);
        RequiredText(x => x.MovieId, 1, int.MaxValue);
        DateKey(x => x.Date, required: true);
        OptionalText(x => x.ExcludeId, 1, int.MaxValue);
    }
}

public sealed class ShowtimeCreateRequest
{
    public string? MovieId { get; set; }
    public string? TheatreId { get; set; }
    public DateTime? StartsAt { get; set; }
    public int? BasePrice { get; set; }
}

public sealed class ShowtimeCreateRequestValidator : RequestValidator<ShowtimeCreateRequest>
{
    public ShowtimeCreateRequestValidator()
    {
        RequiredText(x => x.MovieId, 1, int.MaxValue);
        RequiredText(x => x.TheatreId, 1, int.MaxValue);
        RuleFor(x => x.StartsAt).NotNull().WithMessage(Invalid);
        IntRange(x => x.BasePrice, 1, 5000, required: true);
    }
}

/// <summary>
/// ไม่มี status — การยกเลิกรอบต้องผ่าน /showtimes/:id/cancel ที่ปิดการจองและเข้าคิวคืนเงินให้ด้วย
/// ถ้ายอมให้ PATCH เปลี่ยนสถานะตรง ๆ ตั๋วที่จ่ายแล้วจะค้างอยู่ในรอบที่ถูกยกเลิกโดยไม่มีใครคืนเงิน
/// </summary>
public sealed class ShowtimeUpdateRequest
{
    public string? TheatreId { get; set; }
    public DateTime? StartsAt { get; set; }
    public int? BasePrice { get; set; }
}

public sealed class ShowtimeUpdateRequestValidator : RequestValidator<ShowtimeUpdateRequest>
{
    public ShowtimeUpdateRequestValidator()
    {
        OptionalText(x => x.TheatreId, 1, int.MaxValue);
        IntRange(x => x.BasePrice, 1, 5000, required: false);
    }
}

public sealed class ReasonRequest : INormalizable
{
    public string? Reason { get; set; }

    public void Normalize() => Reason = TextNormalization.Trim(Reason);
}

public sealed class ReasonRequestValidator : RequestValidator<ReasonRequest>
{
    public ReasonRequestValidator() => OptionalText(x => x.Reason, 0, 200);
}

public sealed class NotificationListQuery
{
    public string? UnreadOnly { get; set; }
    public int? Limit { get; set; }
}

public sealed class NotificationListQueryValidator : RequestValidator<NotificationListQuery>
{
    public NotificationListQueryValidator()
    {
        QueryBoolean(x => x.UnreadOnly);
        IntRange(x => x.Limit, 1, 100, required: false);
    }
}
