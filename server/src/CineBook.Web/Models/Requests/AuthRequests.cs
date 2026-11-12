using CineBook.Web.Infrastructure.Validation;
using CineBook.Web.Utils;

namespace CineBook.Web.Models.Requests;

public sealed class RegisterRequest : INormalizable
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Password { get; set; }

    public void Normalize()
    {
        Name = TextNormalization.Trim(Name);
        Phone = TextNormalization.Trim(Phone);
    }
}

public sealed class RegisterRequestValidator : RequestValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RequiredText(x => x.Name, 2, 60, "กรุณากรอกชื่อ");
        Email(x => x.Email, required: true);
        RequiredText(x => x.Phone, 9, 20, "กรุณากรอกเบอร์โทรศัพท์");
        Password(x => x.Password);
    }
}

public sealed class LoginRequest : INormalizable
{
    /// <summary>ช่องเดียวรับได้ทั้งอีเมลและเบอร์โทร ผู้ใช้จะได้ไม่ต้องจำว่าสมัครไว้ด้วยอะไร</summary>
    public string? Identifier { get; set; }
    public string? Password { get; set; }

    public void Normalize() => Identifier = TextNormalization.Trim(Identifier);
}

public sealed class LoginRequestValidator : RequestValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RequiredText(x => x.Identifier, 4, 120, "กรุณากรอกอีเมลหรือเบอร์โทรศัพท์");
        RequiredText(x => x.Password, 1, PasswordRules.MaxLength, "กรุณากรอกรหัสผ่าน");
    }
}

public sealed class ChangePasswordRequest
{
    public string? CurrentPassword { get; set; }
    public string? NewPassword { get; set; }
}

public sealed class ChangePasswordRequestValidator : RequestValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RequiredText(x => x.CurrentPassword, 1, PasswordRules.MaxLength, "กรุณากรอกรหัสผ่านปัจจุบัน");
        Password(x => x.NewPassword);
    }
}

public sealed class ForgotPasswordRequest
{
    public string? Email { get; set; }
    /// <summary>ภาษาของอีเมล — ภาษาที่ผู้ใช้กำลังเปิดหน้าเว็บอยู่ ไม่ใช่ภาษาที่เซิร์ฟเวอร์ตั้งไว้</summary>
    public string? Lang { get; set; }
}

public sealed class ForgotPasswordRequestValidator : RequestValidator<ForgotPasswordRequest>
{
    public ForgotPasswordRequestValidator()
    {
        Email(x => x.Email, required: true);
        OneOf(x => x.Lang, ["th", "en"]);
    }
}

/// <summary>
/// token อยู่ใน body ไม่ใช่ใน path เพราะ path ไปโผล่ใน access log ของเซิร์ฟเวอร์
/// ปล่อยให้ service เป็นคนตัดสินว่าลิงก์ใช้ได้ไหม จะได้ตอบเป็นรหัส RESET_LINK_* เหมือนกันทุกกรณี
/// </summary>
public sealed class ResetCheckRequest : INormalizable
{
    public string? Token { get; set; }

    public void Normalize() => Token = TextNormalization.Trim(Token);
}

public sealed class ResetCheckRequestValidator : RequestValidator<ResetCheckRequest>
{
    public ResetCheckRequestValidator() => RequiredText(x => x.Token, 1, 200, "ลิงก์ไม่ถูกต้อง");
}

public sealed class ResetPasswordRequest : INormalizable
{
    public string? Token { get; set; }
    public string? Password { get; set; }

    public void Normalize() => Token = TextNormalization.Trim(Token);
}

public sealed class ResetPasswordRequestValidator : RequestValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RequiredText(x => x.Token, 1, 200, "ลิงก์ไม่ถูกต้อง");
        Password(x => x.Password);
    }
}

public sealed class UpdateProfileRequest : INormalizable
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    /// <summary>จำเป็นเฉพาะตอนเปลี่ยนอีเมลจริง (service เป็นคนบังคับ) — แก้แค่ชื่อไม่ต้องส่ง</summary>
    public string? CurrentPassword { get; set; }

    public void Normalize() => Name = TextNormalization.Trim(Name);
}

public sealed class UpdateProfileRequestValidator : RequestValidator<UpdateProfileRequest>
{
    public UpdateProfileRequestValidator()
    {
        OptionalText(x => x.Name, 1, 60, "กรุณากรอกชื่อ");
        Email(x => x.Email, required: false);
        OptionalText(x => x.CurrentPassword, 1, PasswordRules.MaxLength, "กรุณากรอกรหัสผ่านปัจจุบัน");
    }
}
