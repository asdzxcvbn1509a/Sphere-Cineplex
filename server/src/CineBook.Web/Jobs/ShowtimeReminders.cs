using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Jobs;

/// <summary>แจ้งเตือนผู้ใช้ล่วงหน้า 1 ชั่วโมงก่อนรอบฉาย (port จาก jobs/reminders.js — ฟีเจอร์ที่ผู้ตอบแบบสอบถามอยากได้มากที่สุด)</summary>
public sealed class ShowtimeReminders(AppDbContext db, TimeProvider time)
{
    private const int ReminderLeadMinutes = 60;

    /// <summary>ส่งแจ้งเตือนของรอบที่จะเริ่มภายในชั่วโมงหน้า — คืนจำนวนที่ส่งจริง</summary>
    public async Task<int> SendAsync()
    {
        var now = time.UtcNowMs();
        var until = now.AddMinutes(ReminderLeadMinutes);

        var bookings = await db.Bookings.AsNoTracking()
            .Where(b => b.Status == BookingStatus.PAID && b.ReminderSentAt == null &&
                // รอบที่ถูกยกเลิกต้องไม่ไปเตือนว่า "ใกล้ถึงเวลาฉาย"
                b.Showtime.Status == ShowtimeStatus.SCHEDULED && b.Showtime.StartsAt > now && b.Showtime.StartsAt <= until)
            .Select(b => new
            {
                b.Id,
                b.UserId,
                b.Showtime.StartsAt,
                b.Showtime.Movie.TitleTh,
                b.Showtime.Movie.TitleEn,
                TheatreName = b.Showtime.Theatre.Name,
            })
            .ToListAsync();

        var sent = 0;
        foreach (var booking in bookings)
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            // จองสิทธิ์ส่งก่อนค่อยสร้างแจ้งเตือน — ถ้ามีอีก process (เช่นรันเซิร์ฟเวอร์สองตัว) ส่งไปแล้ว
            // หรือการจองเพิ่งถูกยกเลิก update จะไม่โดนแถวไหน ลูกค้าจึงไม่ได้แจ้งเตือนซ้ำ/ผิดใบ
            var claimedAt = time.UtcNowMs();
            var claimed = await db.Bookings
                .Where(b => b.Id == booking.Id && b.Status == BookingStatus.PAID && b.ReminderSentAt == null)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(b => b.ReminderSentAt, claimedAt)
                    .SetProperty(b => b.UpdatedAt, claimedAt));
            if (claimed > 0)
            {
                await NotificationService.NotifyAsync(
                    db,
                    booking.UserId,
                    NotificationType.SHOWTIME_REMINDER,
                    new NotificationContext
                    {
                        MovieTh = booking.TitleTh,
                        MovieEn = booking.TitleEn,
                        Theatre = booking.TheatreName,
                        TimeText = BangkokTime.FormatTime(booking.StartsAt),
                    },
                    NotificationTemplates.Data(("bookingId", booking.Id)));
                sent += 1;
            }
            await tx.CommitAsync();
        }

        return sent;
    }
}
