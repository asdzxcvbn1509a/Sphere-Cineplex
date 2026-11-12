using CineBook.Web.Infrastructure.Validation;
using CineBook.Web.Models.Entities;
using FluentValidation;

namespace CineBook.Web.Models.Requests;

public sealed class UserListQuery : INormalizable
{
    public string? Q { get; set; }
    public string? Role { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }

    public Role? RoleValue => Role is null ? null : Enum.Parse<Role>(Role);

    public void Normalize() => Q = TextNormalization.Trim(Q);
}

public sealed class UserListQueryValidator : RequestValidator<UserListQuery>
{
    public UserListQueryValidator()
    {
        OptionalText(x => x.Q, 1, 60);
        OneOf(x => x.Role, ["USER", "ADMIN"]);
        Paging(x => x.Page, x => x.PageSize);
    }
}

public sealed class UserUpdateRequest : INormalizable
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Role { get; set; }

    public Role? RoleValue => Role is null ? null : Enum.Parse<Role>(Role);

    public void Normalize()
    {
        Name = TextNormalization.Trim(Name);
        Phone = TextNormalization.Trim(Phone);
    }
}

public sealed class UserUpdateRequestValidator : RequestValidator<UserUpdateRequest>
{
    public UserUpdateRequestValidator()
    {
        OptionalText(x => x.Name, 2, 60, "กรุณากรอกชื่อ");
        Email(x => x.Email, required: false);
        OptionalText(x => x.Phone, 9, 20, "กรุณากรอกเบอร์โทรศัพท์");
        OneOf(x => x.Role, ["USER", "ADMIN"]);
        RuleFor(x => x)
            .Must(x => x.Name is not null || x.Email is not null || x.Phone is not null || x.Role is not null)
            .WithMessage("ไม่มีข้อมูลที่จะแก้ไข")
            .OverridePropertyName("");
    }
}

public sealed class SetUserPasswordRequest
{
    public string? NewPassword { get; set; }
}

public sealed class SetUserPasswordRequestValidator : RequestValidator<SetUserPasswordRequest>
{
    public SetUserPasswordRequestValidator() => Password(x => x.NewPassword);
}
