using System.Text.RegularExpressions;
using System.Threading.Channels;
using CineBook.Web.Emails;
using CineBook.Web.Infrastructure.Config;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace CineBook.Web.Infrastructure.Email;

public sealed record MailResult(bool Delivered, string? Reason = null);

public interface IMailer
{
    /// <summary>
    /// ส่งอีเมล — คืน Delivered บอกว่าออกไปทาง SMTP จริงหรือไม่
    /// ตั้งใจไม่โยน error ต่อ เพราะทุกที่ที่เรียกใช้ไม่ควรพังตามเมล
    /// (ขอลิงก์ตั้งรหัสผ่านแล้วเซิร์ฟเวอร์เมลล่ม ผู้ใช้ก็ยังควรได้หน้าตอบกลับปกติ) ความล้มเหลวไปโผล่ที่ log ของเซิร์ฟเวอร์แทน
    /// </summary>
    Task<MailResult> SendAsync(string to, EmailContent content, CancellationToken ct = default);
}

/// <summary>ส่งผ่าน SMTP ที่ตั้งไว้ใน .env (MailKit) — ไม่ตั้ง SMTP_HOST = ไม่ส่งจริง</summary>
public sealed partial class SmtpMailer(AppConfig config, ILogger<SmtpMailer> logger) : IMailer
{
    public async Task<MailResult> SendAsync(string to, EmailContent content, CancellationToken ct = default)
    {
        if (!config.IsMailConfigured)
        {
            // พิมพ์ทั้งฉบับเฉพาะตอนพัฒนา จะได้กดลิงก์ทดสอบจนจบขั้นตอนได้โดยไม่ต้องมีเมลเซิร์ฟเวอร์
            // production ห้ามพิมพ์เนื้อเมล — ลิงก์ตั้งรหัสผ่านใน log = ใครเปิด log ได้ก็ยึดบัญชีนั้นได้ (log มักถูกส่งต่อไปเก็บที่อื่นด้วย)
            // ตอนรันเทสต์ไม่ต้องพิมพ์อะไรเลย — ทุกการอนุมัติสลิปส่งใบเสร็จ ถ้าพิมพ์หมดผลเทสต์จะจมอยู่ใต้เนื้ออีเมล
            if (config.IsDevelopment) PrintToConsole(to, content);
            else if (config.IsProduction)
            {
                logger.LogWarning("[mail] ยังไม่ได้ตั้ง SMTP_HOST — ไม่ได้ส่งอีเมล \"{Subject}\" ถึง {To}", content.Subject, MaskRecipient(to));
            }
            return new MailResult(false, "SMTP_NOT_CONFIGURED");
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(MailboxAddress.Parse(config.MailFrom));
            message.To.Add(MailboxAddress.Parse(to));
            message.Subject = content.Subject;
            message.Body = new BodyBuilder { TextBody = content.Text, HtmlBody = content.Html }.ToMessageBody();

            using var client = new SmtpClient();
            // true = เข้ารหัสตั้งแต่เชื่อมต่อ (พอร์ต 465) · false = ขอ STARTTLS ถ้าเซิร์ฟเวอร์รองรับ (แบบ nodemailer เดิม)
            var security = config.SmtpSecure ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable;
            await client.ConnectAsync(config.SmtpHost!, config.SmtpPort, security, ct);
            // ผู้ให้บริการบางเจ้า (เช่น SMTP ภายในองค์กร) ไม่ต้องล็อกอิน จึงล็อกอินเฉพาะตอนที่ตั้งค่าไว้
            if (!string.IsNullOrEmpty(config.SmtpUser)) await client.AuthenticateAsync(config.SmtpUser, config.SmtpPass ?? "", ct);
            await client.SendAsync(message, ct);
            await client.DisconnectAsync(true, ct);
            return new MailResult(true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError("[mail] ส่งอีเมลถึง {To} ไม่สำเร็จ: {Message}", to, ex.Message);
            return new MailResult(false, "SEND_FAILED");
        }
    }

    [GeneratedRegex("^[^@]*")]
    private static partial Regex LocalPart();

    /// <summary>เหลือแค่โดเมนของผู้รับ — พอให้รู้ว่ามีเมลตกหล่น โดยไม่เก็บที่อยู่อีเมลของลูกค้าไว้ใน log</summary>
    public static string MaskRecipient(string? to) => LocalPart().Replace(to ?? "", "***", 1);

    /// <summary>พิมพ์เนื้อเมลลง console แบบอ่านง่าย ใช้ตอนยังไม่ได้ตั้ง SMTP</summary>
    private static void PrintToConsole(string to, EmailContent content)
    {
        var body = string.Join('\n', content.Text.Trim().Split('\n').Select(line => $"   {line}"));
        Console.WriteLine(string.Join('\n',
        [
            "",
            "📧 ─── อีเมลขาออก (ยังไม่ได้ตั้ง SMTP_HOST จึงยังไม่ส่งจริง) ───",
            $"   ถึง: {to}",
            $"   เรื่อง: {content.Subject}",
            "",
            body,
            "───────────────────────────────────────────────────────────",
            "",
        ]));
    }
}

/// <summary>
/// คิวอีเมลที่ส่งทีหลังโดยไม่ต้องรอ (ใบเสร็จหลังอนุมัติสลิป) — ผู้ดูแลที่ไล่ตรวจสลิปไม่ต้องรอเมลแต่ละฉบับส่งเสร็จ
/// ส่งไม่สำเร็จแค่ log ไว้ ลูกค้ายังเปิดใบเสร็จบนเว็บได้ตามปกติ
/// </summary>
public sealed class EmailQueue
{
    private readonly Channel<(string To, EmailContent Content)> _channel =
        Channel.CreateUnbounded<(string, EmailContent)>(new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(string to, EmailContent content) => _channel.Writer.TryWrite((to, content));

    public ChannelReader<(string To, EmailContent Content)> Reader => _channel.Reader;
}

public sealed class EmailQueueSender(EmailQueue queue, IMailer mailer, ILogger<EmailQueueSender> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (to, content) in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await mailer.SendAsync(to, content, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError("[mail] ส่งอีเมล \"{Subject}\" ไม่สำเร็จ: {Message}", content.Subject, ex.Message);
            }
        }
    }
}
