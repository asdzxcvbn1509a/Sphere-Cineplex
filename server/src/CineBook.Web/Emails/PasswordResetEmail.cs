namespace CineBook.Web.Emails;

/// <summary>
/// เนื้อหาอีเมล "ตั้งรหัสผ่านใหม่" แยกออกมาจาก mailer เพราะเป็นคนละเรื่องกัน
/// mailer = ส่งยังไง · ไฟล์นี้ = เขียนว่าอะไร
///
/// ส่งตามภาษาที่ผู้ใช้กำลังเปิดหน้าเว็บอยู่ตอนกดขอลิงก์ ไม่ใช่ภาษาของเซิร์ฟเวอร์
/// </summary>
public static class PasswordResetEmail
{
    private const string AppName = "CineBook";

    private sealed record Copy(
        string Subject,
        Func<string, string> Greeting,
        string Intro,
        string Button,
        string Fallback,
        Func<int, string> Expiry,
        string Ignore,
        string Signature);

    private static readonly Copy Th = new(
        $"ตั้งรหัสผ่านใหม่ · {AppName}",
        name => $"สวัสดีคุณ {name}",
        "มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ได้เลย",
        "ตั้งรหัสผ่านใหม่",
        "ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์",
        minutes => $"ลิงก์นี้ใช้ได้ภายใน {minutes} นาที และใช้ได้ครั้งเดียว",
        "ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไรกับอีเมลฉบับนี้ รหัสผ่านเดิมยังใช้ได้ตามปกติ",
        $"ทีมงาน {AppName}");

    private static readonly Copy En = new(
        $"Reset your password · {AppName}",
        name => $"Hi {name},",
        "Someone asked to reset the password for this account. Use the button below to set a new one.",
        "Set a new password",
        "If the button does not work, copy this link into your browser:",
        minutes => $"This link works for {minutes} minutes and can only be used once.",
        "If you did not ask for this, you can ignore this email — your current password still works.",
        $"The {AppName} team");

    public static EmailContent Build(string name, string resetUrl, int ttlMinutes, string? lang = "th")
    {
        var copy = lang == "en" ? En : Th;

        var text = string.Join('\n', new[]
        {
            copy.Greeting(name),
            "",
            copy.Intro,
            "",
            resetUrl,
            "",
            copy.Expiry(ttlMinutes),
            copy.Ignore,
            "",
            copy.Signature,
        });

        // อีเมลต้องอ่านได้ทั้งบนพื้นสว่างและมืด จึงกำหนดสีพื้น/สีตัวอักษรเองทั้งหมด ไม่พึ่ง default ของโปรแกรมอ่านเมล
        // สีและฟอนต์ตาม Design System (docs/design-system.md) — ชื่อแบรนด์ Cinzel ถ้าเครื่องไม่มีจะเป็น Georgia แทน
        var html = $"""
<div style="margin:0;padding:24px;background:#fff6e8;font-family:Inter,'Noto Sans Thai','Segoe UI',Tahoma,sans-serif;color:#1c1a17">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;font-family:Cinzel,Georgia,serif;color:#1c1a17">{AppName}</p>
    <p style="margin:0 0 16px;font-size:15px">{Html.Escape(copy.Greeting(name))}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6">{Html.Escape(copy.Intro)}</p>
    <p style="margin:0 0 24px">
      <a href="{Html.Escape(resetUrl)}"
         style="display:inline-block;background:#c89d56;color:#1c1a17;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px">
        {Html.Escape(copy.Button)}
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#605e5c">{Html.Escape(copy.Fallback)}</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all">
      <a href="{Html.Escape(resetUrl)}" style="color:#8e6b33">{Html.Escape(resetUrl)}</a>
    </p>
    <p style="margin:0 0 4px;font-size:13px;color:#605e5c">{Html.Escape(copy.Expiry(ttlMinutes))}</p>
    <p style="margin:0 0 24px;font-size:13px;color:#605e5c">{Html.Escape(copy.Ignore)}</p>
    <p style="margin:0;font-size:13px;color:#605e5c">{Html.Escape(copy.Signature)}</p>
  </div>
</div>
""";

        return new EmailContent(copy.Subject, text, html);
    }
}
