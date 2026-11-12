using System.Globalization;
using System.Text.Json.Nodes;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>ข้อมูลที่ข้อความแจ้งเตือนแต่ละแบบใช้ — ใส่เฉพาะช่องที่แบบนั้นต้องการ</summary>
public sealed record NotificationContext
{
    public string? Code { get; init; }
    public string? ReceiptNo { get; init; }
    public int? Amount { get; init; }
    /// <summary>รอบเริ่มฉายไปแล้ว การจอง/คำขอจึงปิดเลย ไม่ได้ให้จ่ายใหม่</summary>
    public bool Closed { get; init; }
    public string? Reason { get; init; }
    public string? MovieTh { get; init; }
    public string? MovieEn { get; init; }
    public string? TimeText { get; init; }
    public string? Theatre { get; init; }
    public string? From { get; init; }
    public string? To { get; init; }
    /// <summary>ส่วนต่างของการเปลี่ยนที่นั่ง — ติดลบ = รอโอนคืน</summary>
    public int? Diff { get; init; }
    /// <summary>ผู้ดูแลย้ายที่นั่งให้ (เช่น ที่นั่งชำรุด)</summary>
    public bool ByAdmin { get; init; }
    public string? WhenTh { get; init; }
    public string? WhenEn { get; init; }
    /// <summary>การจองที่จ่ายแล้วของรอบที่ถูกยกเลิก — ต้องแจ้งบัญชีรับเงินคืน</summary>
    public bool Refund { get; init; }
}

/// <summary>
/// ข้อความแจ้งเตือนเก็บทั้งไทยและอังกฤษไว้ในแถวเดียว
/// เพราะผู้ใช้สลับภาษาได้ตลอดเวลา — จะ render ภาษาไหนค่อยตัดสินที่ฝั่ง client
/// </summary>
public static class NotificationTemplates
{
    private static string N(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "";

    public static (string TitleTh, string TitleEn, string BodyTh, string BodyEn) Build(NotificationType type, NotificationContext ctx)
    {
        var receipt = string.IsNullOrEmpty(ctx.ReceiptNo) ? "" : $" {ctx.ReceiptNo}";
        switch (type)
        {
            case NotificationType.PAYMENT_APPROVED:
                return ("ยืนยันการชำระเงินแล้ว", "Payment confirmed",
                    $"การจอง {ctx.Code} ได้รับการยืนยันแล้ว เปิดดู E-Ticket และใบเสร็จ{receipt} ได้ทันที",
                    $"Booking {ctx.Code} is confirmed. Your e-ticket and receipt{receipt} are ready.");
            case NotificationType.REFUND_COMPLETED:
                return ("คืนเงินเรียบร้อยแล้ว", "Refund completed",
                    $"คืนเงิน {N(ctx.Amount)} บาท ของการจอง {ctx.Code} เรียบร้อยแล้ว กรุณาตรวจสอบยอดในบัญชีของคุณ",
                    $"We refunded {N(ctx.Amount)} THB for booking {ctx.Code}. Please check your bank account.");
            case NotificationType.PAYMENT_REJECTED:
                return ctx.Closed
                    ? ("สลิปไม่ผ่านการตรวจสอบ", "Slip was rejected",
                        $"สลิปของการจอง {ctx.Code} ไม่ผ่านการตรวจสอบ ({ctx.Reason}) และการจองนี้ปิดแล้ว หากโอนเงินไปแล้วจริงกรุณาติดต่อเจ้าหน้าที่พร้อมรหัสการจอง",
                        $"The slip for booking {ctx.Code} was rejected ({ctx.Reason}) and the booking is now closed. If you did transfer the money, please contact us with your booking code.")
                    : ("สลิปไม่ผ่านการตรวจสอบ", "Slip was rejected",
                        $"การจอง {ctx.Code} ยังไม่สำเร็จ ({ctx.Reason}) กรุณาชำระเงินและส่งสลิปใหม่อีกครั้ง",
                        $"Booking {ctx.Code} was not approved ({ctx.Reason}). Please pay and upload the slip again.");
            case NotificationType.BOOKING_CANCELLED:
                return ("ยกเลิกการจองแล้ว", "Booking cancelled",
                    $"การจอง {ctx.Code} ถูกยกเลิกเรียบร้อย ที่นั่งถูกคืนเข้าระบบแล้ว",
                    $"Booking {ctx.Code} has been cancelled and the seats were released.");
            case NotificationType.BOOKING_EXPIRED:
                return ("หมดเวลาชำระเงิน", "Payment window expired",
                    $"การจอง {ctx.Code} หมดเวลาชำระเงิน ที่นั่งถูกปล่อยให้ผู้อื่นแล้ว",
                    $"Booking {ctx.Code} expired before payment. The seats are available to others again.");
            case NotificationType.SHOWTIME_REMINDER:
                return ("ใกล้ถึงเวลาฉายแล้ว", "Your movie starts soon",
                    $"\"{ctx.MovieTh}\" รอบ {ctx.TimeText} ที่ {ctx.Theatre} — เตรียม E-Ticket ให้พร้อมนะ",
                    $"\"{ctx.MovieEn}\" at {ctx.TimeText}, {ctx.Theatre} — have your e-ticket ready.");
            case NotificationType.SEATS_CHANGED:
            {
                // ย้ายเสร็จแล้ว — byAdmin = ผู้ดูแลย้ายให้ · diff ติดลบ = ส่วนต่างรอโอนคืน · receiptNo = ใบเสร็จส่วนต่าง
                var moveTh = $"จาก {ctx.From} เป็น {ctx.To}";
                var moveEn = $"from {ctx.From} to {ctx.To}";
                var refundDiff = ctx.Diff is < 0 ? -ctx.Diff.Value : (int?)null;
                var extraTh =
                    (string.IsNullOrEmpty(ctx.ReceiptNo) ? "" : $" ชำระส่วนต่าง {N(ctx.Diff)} บาทแล้ว (ใบเสร็จ {ctx.ReceiptNo})") +
                    (refundDiff is null ? "" : $" ส่วนต่าง {N(refundDiff)} บาทจะโอนคืนเข้าบัญชีที่แจ้งไว้");
                var extraEn =
                    (string.IsNullOrEmpty(ctx.ReceiptNo) ? "" : $" The {N(ctx.Diff)} THB difference is paid (receipt {ctx.ReceiptNo}).") +
                    (refundDiff is null ? "" : $" We will refund the {N(refundDiff)} THB difference to your bank account.");
                var reason = string.IsNullOrEmpty(ctx.Reason) ? "" : $" ({ctx.Reason})";
                return ("เปลี่ยนที่นั่งแล้ว", "Seats changed",
                    ctx.ByAdmin
                        ? $"ผู้ดูแลระบบย้ายที่นั่งของการจอง {ctx.Code} {moveTh}{reason} — E-Ticket ใช้ QR เดิมได้เลย"
                        : $"การจอง {ctx.Code} เปลี่ยนที่นั่ง{moveTh} เรียบร้อยแล้ว{extraTh} — E-Ticket ใช้ QR เดิมได้เลย",
                    ctx.ByAdmin
                        ? $"Our staff moved booking {ctx.Code} {moveEn}{reason}. Your e-ticket QR stays the same."
                        : $"Booking {ctx.Code} moved {moveEn}.{extraEn} Your e-ticket QR stays the same.");
            }
            case NotificationType.SEAT_CHANGE_REJECTED:
                return ("สลิปส่วนต่างไม่ผ่านการตรวจสอบ", "Seat change slip was rejected",
                    ctx.Closed
                        ? $"สลิปส่วนต่างเปลี่ยนที่นั่งของการจอง {ctx.Code} ไม่ผ่านการตรวจสอบ ({ctx.Reason}) คำขอนี้ปิดแล้ว ที่นั่งเดิมยังเป็นของคุณ หากโอนเงินไปแล้วจริงกรุณาติดต่อเจ้าหน้าที่พร้อมรหัสการจอง"
                        : $"สลิปส่วนต่างเปลี่ยนที่นั่งของการจอง {ctx.Code} ไม่ผ่านการตรวจสอบ ({ctx.Reason}) กรุณาโอนและส่งสลิปใหม่อีกครั้ง — ระหว่างนี้ที่นั่งเดิมยังเป็นของคุณ",
                    ctx.Closed
                        ? $"The seat change slip for booking {ctx.Code} was rejected ({ctx.Reason}) and the request is closed. You keep your original seats. If you did transfer the money, please contact us with your booking code."
                        : $"The seat change slip for booking {ctx.Code} was rejected ({ctx.Reason}). Please pay and upload the slip again — you keep your original seats meanwhile.");
            case NotificationType.SEAT_CHANGE_EXPIRED:
                return ("หมดเวลาโอนส่วนต่าง", "Seat change expired",
                    $"คำขอเปลี่ยนที่นั่งของการจอง {ctx.Code} หมดเวลาโอนส่วนต่าง ที่นั่งเดิมยังเป็นของคุณตามเดิม",
                    $"The seat change for booking {ctx.Code} expired before the difference was paid. You keep your original seats.");
            case NotificationType.SHOWTIME_CANCELLED:
            {
                var reason = string.IsNullOrEmpty(ctx.Reason) ? "" : $" ({ctx.Reason})";
                return ("รอบฉายถูกยกเลิก", "Showtime cancelled",
                    $"รอบ \"{ctx.MovieTh}\" {ctx.WhenTh} ถูกยกเลิก{reason} " +
                    $"การจอง {ctx.Code} จึงถูกยกเลิกด้วย" +
                    (ctx.Refund ? " เราจะโอนเงินคืนให้ กรุณาแจ้งบัญชีรับเงินคืนที่หน้า \"การจองของฉัน\"" : ""),
                    $"The \"{ctx.MovieEn}\" showtime on {ctx.WhenEn} was cancelled{reason}, " +
                    $"so booking {ctx.Code} was cancelled too." +
                    (ctx.Refund ? " We will refund you — please add your bank account on the \"My bookings\" page." : ""));
            }
            default:
                throw new ArgumentOutOfRangeException(nameof(type), type, "ไม่มีข้อความสำหรับแจ้งเตือนแบบนี้แล้ว");
        }
    }

    /// <summary>
    /// ข้อมูลหนึ่งแถวของการแจ้งเตือน (ยังไม่บันทึก) — ใช้ทั้งแจ้งทีละใบ
    /// และเพิ่มทีละหลายแถวตอนแจ้งหลายคนพร้อมกัน (เช่น ยกเลิกทั้งรอบ) ด้วยข้อความชุดเดียวกัน
    /// </summary>
    public static Notification Create(string userId, NotificationType type, NotificationContext context, JsonObject? data = null)
    {
        var (titleTh, titleEn, bodyTh, bodyEn) = Build(type, context);
        return new Notification
        {
            UserId = userId,
            Type = type,
            TitleTh = titleTh,
            TitleEn = titleEn,
            BodyTh = bodyTh,
            BodyEn = bodyEn,
            Data = data,
        };
    }

    /// <summary>data ของแจ้งเตือนแบบ { bookingId, ... } — ค่าที่เป็น null ไม่ใส่</summary>
    public static JsonObject Data(params (string Key, string? Value)[] values)
    {
        var data = new JsonObject();
        foreach (var (key, value) in values)
        {
            if (value is not null) data[key] = value;
        }
        return data;
    }
}

/// <summary>แจ้งเตือนของผู้ใช้ (port จาก services/notifications.js)</summary>
public sealed class NotificationService(AppDbContext db, TimeProvider time)
{
    public sealed record ListResult(List<NotificationResponse> Notifications, int UnreadCount);

    public async Task<ListResult> ListAsync(string userId, bool unreadOnly = false, int limit = 50)
    {
        var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        if (unreadOnly) query = query.Where(n => n.ReadAt == null);
        var items = await query.OrderByDescending(n => n.CreatedAt).Take(limit).ToListAsync();
        var unreadCount = await db.Notifications.CountAsync(n => n.UserId == userId && n.ReadAt == null);
        return new ListResult(items.Select(NotificationResponse.From).ToList(), unreadCount);
    }

    public async Task MarkReadAsync(string userId, string notificationId)
    {
        var now = time.UtcNowMs();
        await db.Notifications
            .Where(n => n.Id == notificationId && n.UserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now));
    }

    /// <summary>
    /// ลบแจ้งเตือนของตัวเอง — แจ้งเตือนเป็นแค่ข้อความบอกเหตุการณ์ ข้อมูลจริงอยู่ที่การจอง/การชำระเงิน ลบทิ้งได้เลย
    /// userId อยู่ใน WHERE กันลบของคนอื่น · ไม่มี/ไม่ใช่ของตัวเอง/ลบไปแล้ว ถือว่าสำเร็จ (กดซ้ำจากสองแท็บไม่ error)
    /// </summary>
    public Task DeleteAsync(string userId, string notificationId) =>
        db.Notifications.Where(n => n.Id == notificationId && n.UserId == userId).ExecuteDeleteAsync();

    public Task<int> MarkAllReadAsync(string userId)
    {
        var now = time.UtcNowMs();
        return db.Notifications
            .Where(n => n.UserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now));
    }

    /// <summary>สร้างการแจ้งเตือนหนึ่งใบแล้วบันทึกทันที (ใช้ DbContext เดียวกับ transaction ที่เปิดอยู่ได้)</summary>
    public static async Task<Notification> NotifyAsync(
        AppDbContext db, string userId, NotificationType type, NotificationContext context, JsonObject? data = null)
    {
        var notification = NotificationTemplates.Create(userId, type, context, data);
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();
        return notification;
    }
}
