using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using static CineBook.Web.Seed.SeedTime;

namespace CineBook.Web.Seed;

/// <summary>รอบที่ใช้ทำสถานการณ์ต่าง ๆ — แต่ละสถานการณ์ได้คนละรอบ</summary>
public sealed class SeedTargets
{
    public required SeedShowtime SoldOut { get; init; }
    public required SeedShowtime NearlyFull { get; init; }
    public required SeedShowtime CancelUpcoming { get; init; }
    public required SeedShowtime CancelledPast { get; init; }
    public required List<(SeedShowtime Showtime, double Fill)> BusyPast { get; init; }
    public required SeedShowtime SomchaiPaid { get; init; }
    public required SeedShowtime SomchaiSwap { get; init; }
    public required SeedShowtime SomchaiUpgraded { get; init; }
    public required SeedShowtime SomchaiTopUp { get; init; }
    public required SeedShowtime SomchaiExpired { get; init; }
    public required SeedShowtime SomchaiRejected { get; init; }
    public required SeedShowtime SomchaiReview { get; init; }
    public required List<SeedShowtime> SomchaiHistory { get; init; }
    public required SeedShowtime SomchaiRefunded { get; init; }
    public required SeedShowtime CancelWithAccount { get; init; }
    public required SeedShowtime RefundDone { get; init; }
    public required SeedShowtime AdminCancel { get; init; }
    public required SeedShowtime CheaperChange { get; init; }
    public required SeedShowtime TopUpHold { get; init; }
    public required SeedShowtime TopUpReview { get; init; }
    public required SeedShowtime TopUpCancelled { get; init; }
    public required SeedShowtime TopUpRejected { get; init; }
    public required SeedShowtime TopUpExpired { get; init; }
    public required SeedShowtime AdminMove { get; init; }
    public required List<SeedShowtime> Queue { get; init; }
    public required SeedShowtime Hold { get; init; }
}

/// <summary>
/// สถานการณ์ที่ยัง "เดินอยู่" ตอน seed เสร็จ (port จาก prisma/seed/scenarios.js) — เรียก service ตัวจริงทุกขั้น
/// สถานะ ที่นั่งที่กันไว้ รายการเงิน และแจ้งเตือนจึงเป็นแบบเดียวกับที่ระบบสร้างเองทุกอย่าง (ประวัติที่จบแล้วอยู่ใน SeedSales)
///
/// ไม่เรียก PaymentService.ApproveAsync / SeatChangeService.ApproveTopUpAsync เพราะ service ส่งอีเมลใบเสร็จหลังอนุมัติ
/// (ถ้าตั้ง SMTP ไว้จะส่งจริงไปที่ @example.test) — ใบที่อนุมัติแล้วทั้งหมดมาจาก SeedSales แทน เลขใบเสร็จจึงออกที่เดียว
///
/// หมายเหตุ: การกันที่นั่งรอจ่าย (ทั้งค่าตั๋วและส่วนต่าง) นับถอยหลังจริง — เปิด API แล้ว job จะปิดให้เป็นหมดเวลาตามกติกา
/// </summary>
public sealed class SeedScenarios(
    SeedWorld world,
    AppDbContext db,
    SeedSlips slips,
    BookingService bookings,
    PaymentService payments,
    SeatChangeService seatChanges,
    ShowtimeService showtimes)
{
    // ---------- เลือกรอบให้แต่ละสถานการณ์ ----------

    private sealed record Criteria(string? TheatreName = null, string? ScreenType = null, double MinHours = 0, int MinHour = 0);

    /// <summary>
    /// เลือกตามกติกา (อีกกี่ชั่วโมงฉาย กี่โมง โรงไหน) ไม่ผูกกับวันที่ — seed ตอนดึกหรือวันไหนก็ได้รอบที่เข้าเงื่อนไข
    /// ลำดับการเลือกต้องตรงกับของเดิม เพราะรอบที่ถูกเลือกไปแล้วถูกตัดออกจากตัวเลือกถัดไป
    /// </summary>
    public static SeedTargets ChooseTargets(SeedWorld world)
    {
        var now = world.Now;
        var used = new HashSet<string>();

        bool Matches(SeedShowtime showtime, Criteria criteria) =>
            (criteria.TheatreName is null || showtime.Theatre.Name == criteria.TheatreName) &&
            (criteria.ScreenType is null || showtime.Theatre.ScreenType == criteria.ScreenType) &&
            showtime.StartsAt - now >= criteria.MinHours * Hour &&
            SeedSchedule.BangkokHour(showtime.StartsAt) >= criteria.MinHour;

        SeedShowtime Take(SeedShowtime? showtime, string label)
        {
            if (showtime is null) throw new InvalidOperationException($"seed: ไม่มีรอบที่ใช้ทำสถานการณ์ \"{label}\" ได้");
            used.Add(showtime.Id);
            return showtime;
        }

        // รอบที่จะฉายรอบแรกที่เข้าเงื่อนไข — ไม่มีรอบตรงช่วงเวลาที่อยากได้ก็ยอมรับรอบเวลาอื่น
        SeedShowtime Upcoming(string label, Criteria criteria)
        {
            var free = world.Showtimes.Where(showtime => !used.Contains(showtime.Id)).OrderBy(showtime => showtime.StartsAt).ToList();
            var found = free.FirstOrDefault(showtime => Matches(showtime, criteria))
                ?? free.FirstOrDefault(showtime => Matches(showtime, criteria with { MinHour = 0 }));
            return Take(found, label);
        }

        // รอบที่ฉายไปแล้วเมื่อ daysAgo วันก่อน
        SeedShowtime Past(string label, int daysAgo, string? theatreName = null, int minHour = 0)
        {
            var dayKey = SeedSchedule.DayKeyFrom(now, -daysAgo);
            var candidates = world.Showtimes.Where(showtime =>
                    !used.Contains(showtime.Id) &&
                    showtime.EndsAt < now &&
                    BangkokTime.DateKey(showtime.StartsAtUtc) == dayKey &&
                    (theatreName is null || showtime.Theatre.Name == theatreName))
                .ToList();
            return Take(candidates.FirstOrDefault(showtime => SeedSchedule.BangkokHour(showtime.StartsAt) >= minHour) ?? candidates.LastOrDefault(), label);
        }

        // ลำดับเดียวกับ object literal ของเดิม
        var soldOut = Upcoming("ขายหมด", new Criteria(ScreenType: "4DX", MinHours: 3, MinHour: 17));
        var nearlyFull = Upcoming("เกือบเต็ม", new Criteria(ScreenType: "IMAX", MinHours: 20, MinHour: 18));
        var cancelUpcoming = Upcoming("ยกเลิกทั้งรอบ", new Criteria(TheatreName: "โรงที่ 2", MinHours: 26, MinHour: 16));
        var cancelledPast = Past("รอบที่ถูกยกเลิกไปแล้ว", 3, "โรงที่ 5", 17);
        // รอบที่ขายดีในสัปดาห์ที่ผ่านมา — หน้ารายงานเปิดมาที่ 7 วันล่าสุด อัตราการเต็มจะได้มีครบทั้งแดง (≥80%) เหลือง และเขียว
        List<(SeedShowtime, double)> busyPast =
        [
            (Past("รอบขายดี 1", 1, "โรงที่ 4 (4DX)", 18), 0.93),
            (Past("รอบขายดี 2", 2, "โรงที่ 1", 19), 0.84),
            (Past("รอบขายดี 3", 2, "โรงที่ 4 (4DX)", 18), 0.66),
            (Past("รอบขายดี 4", 3, "โรงที่ 2", 18), 0.52),
            (Past("รอบขายดี 5", 4, "โรงที่ 1", 18), 0.47),
            (Past("รอบขายดี 6", 5, "โรงที่ 4 (4DX)", 19), 0.58),
            (Past("รอบขายดี 7", 6, "โรงที่ 2", 19), 0.44),
        ];
        var somchaiPaid = Upcoming("somchai จ่ายแล้ว", new Criteria(ScreenType: "IMAX", MinHours: 44, MinHour: 17));
        var somchaiSwap = Upcoming("somchai ย้ายที่นั่งราคาเดิม", new Criteria(TheatreName: "โรงที่ 5", MinHours: 28, MinHour: 15));
        var somchaiUpgraded = Upcoming("somchai อัปเกรดที่นั่ง", new Criteria(TheatreName: "โรงที่ 1", MinHours: 70, MinHour: 14));
        var somchaiTopUp = Upcoming("somchai รอโอนส่วนต่าง", new Criteria(TheatreName: "โรงที่ 2", MinHours: 30, MinHour: 17));
        var somchaiExpired = Upcoming("somchai หมดเวลาชำระ", new Criteria(TheatreName: "โรงที่ 2", MinHours: 30));
        var somchaiRejected = Upcoming("somchai สลิปถูกปฏิเสธ", new Criteria(TheatreName: "โรงที่ 5", MinHours: 5, MinHour: 18));
        var somchaiReview = Upcoming("somchai รอตรวจสลิป", new Criteria(TheatreName: "โรงที่ 1", MinHours: 30, MinHour: 17));
        List<SeedShowtime> somchaiHistory =
        [
            Past("somchai ประวัติ 1", 1, minHour: 18),
            Past("somchai ประวัติ 2", 4, minHour: 13),
            Past("somchai ประวัติ 3", 8, minHour: 19),
        ];
        var somchaiRefunded = Past("somchai คืนเงินแล้ว", 6, minHour: 17);
        var cancelWithAccount = Upcoming("ลูกค้ายกเลิกเอง", new Criteria(TheatreName: "โรงที่ 1", MinHours: 30));
        var refundDone = Upcoming("โอนคืนแล้ว", new Criteria(TheatreName: "โรงที่ 5", MinHours: 30));
        var adminCancel = Upcoming("ผู้ดูแลยกเลิกให้", new Criteria(ScreenType: "IMAX", MinHours: 50));
        var cheaperChange = Upcoming("ย้ายไปที่ถูกกว่า", new Criteria(TheatreName: "โรงที่ 5", MinHours: 28, MinHour: 17));
        var topUpHold = Upcoming("รอโอนส่วนต่าง", new Criteria(TheatreName: "โรงที่ 1", MinHours: 26));
        var topUpReview = Upcoming("สลิปส่วนต่างรอตรวจ", new Criteria(TheatreName: "โรงที่ 5", MinHours: 50));
        var topUpCancelled = Upcoming("ยกเลิกคำขอเปลี่ยนที่นั่ง", new Criteria(TheatreName: "โรงที่ 2", MinHours: 30));
        var topUpRejected = Upcoming("สลิปส่วนต่างถูกปฏิเสธ", new Criteria(TheatreName: "โรงที่ 1", MinHours: 30));
        var topUpExpired = Upcoming("หมดเวลาโอนส่วนต่าง", new Criteria(TheatreName: "โรงที่ 5", MinHours: 30));
        var adminMove = Upcoming("ผู้ดูแลย้ายที่นั่งให้", new Criteria(ScreenType: "IMAX", MinHours: 26));
        List<SeedShowtime> queue =
        [
            Upcoming("คิวสลิป 1", new Criteria(ScreenType: "IMAX", MinHours: 6)),
            Upcoming("คิวสลิป 2", new Criteria(TheatreName: "โรงที่ 2", MinHours: 20)),
            Upcoming("คิวสลิป 3", new Criteria(ScreenType: "4DX", MinHours: 28)),
            Upcoming("คิวสลิป 4", new Criteria(TheatreName: "โรงที่ 5", MinHours: 30)),
            Upcoming("คิวสลิป 5", new Criteria(TheatreName: "โรงที่ 1", MinHours: 40)),
        ];
        var hold = Upcoming("รอชำระเงิน", new Criteria(TheatreName: "โรงที่ 1", MinHours: 2));

        return new SeedTargets
        {
            SoldOut = soldOut,
            NearlyFull = nearlyFull,
            CancelUpcoming = cancelUpcoming,
            CancelledPast = cancelledPast,
            BusyPast = busyPast,
            SomchaiPaid = somchaiPaid,
            SomchaiSwap = somchaiSwap,
            SomchaiUpgraded = somchaiUpgraded,
            SomchaiTopUp = somchaiTopUp,
            SomchaiExpired = somchaiExpired,
            SomchaiRejected = somchaiRejected,
            SomchaiReview = somchaiReview,
            SomchaiHistory = somchaiHistory,
            SomchaiRefunded = somchaiRefunded,
            CancelWithAccount = cancelWithAccount,
            RefundDone = refundDone,
            AdminCancel = adminCancel,
            CheaperChange = cheaperChange,
            TopUpHold = topUpHold,
            TopUpReview = topUpReview,
            TopUpCancelled = topUpCancelled,
            TopUpRejected = topUpRejected,
            TopUpExpired = topUpExpired,
            AdminMove = adminMove,
            Queue = queue,
            Hold = hold,
        };
    }

    /// <summary>การจองที่ SeedSales ต้องสร้างไว้ก่อน (จ่ายแล้ว/จบแล้ว) ให้สถานการณ์ด้านล่างใช้ต่อ</summary>
    public static List<SalePin> PinsFor(SeedWorld world, SeedTargets targets)
    {
        var users = world.Users;
        long DaysAgo(int days) => world.Now - days * Day;
        var pins = new List<SalePin>
        {
            new("somchaiPaid", users["somchai"], targets.SomchaiPaid, SeatZone.PREMIUM, 2),
            new("somchaiSwap", users["somchai"], targets.SomchaiSwap, SeatZone.NORMAL, 2),
            new("somchaiUpgraded", users["somchai"], targets.SomchaiUpgraded, SeatZone.NORMAL, 2,
                Outcome: "UPGRADED", UpgradeTo: SeatZone.PREMIUM, LatestAt: DaysAgo(2)),
            new("somchaiTopUp", users["somchai"], targets.SomchaiTopUp, SeatZone.NORMAL, 2),
            new("somchaiCancelledShow", users["somchai"], targets.CancelUpcoming, SeatZone.PREMIUM, 2),
            new("nattawutCancelledShow", users["nattawut"], targets.CancelUpcoming, SeatZone.NORMAL, 3),
        };
        for (var i = 0; i < targets.SomchaiHistory.Count; i += 1)
        {
            pins.Add(new SalePin(
                $"somchaiHistory{i + 1}",
                users["somchai"],
                targets.SomchaiHistory[i],
                i == 1 ? SeatZone.SOFA : SeatZone.NORMAL,
                i == 1 ? 1 : 2));
        }
        pins.AddRange(
        [
            new("somchaiRefunded", users["somchai"], targets.SomchaiRefunded, SeatZone.PREMIUM, 2,
                Outcome: "REFUNDED", LatestAt: targets.SomchaiRefunded.StartsAt - 2 * Day),
            new("somchaiExpired", users["somchai"], targets.SomchaiExpired, SeatZone.NORMAL, 2,
                Outcome: "EXPIRED", LatestAt: world.Now - 20 * Hour),
            new("cancelWithAccount", users["somying"], targets.CancelWithAccount, SeatZone.NORMAL, 3),
            new("refundDone", users["panuwat"], targets.RefundDone, SeatZone.NORMAL, 2),
            new("adminCancel", users["thanakorn"], targets.AdminCancel, SeatZone.PREMIUM, 2),
            new("cheaperChange", users["kamonchanok"], targets.CheaperChange, SeatZone.PREMIUM, 2),
            new("topUpHold", users["weerapong"], targets.TopUpHold, SeatZone.NORMAL, 2),
            new("topUpReview", users["siriporn"], targets.TopUpReview, SeatZone.NORMAL, 2),
            new("topUpCancelled", users["chayapon"], targets.TopUpCancelled, SeatZone.NORMAL, 1),
            new("topUpRejected", users["piyanuch"], targets.TopUpRejected, SeatZone.NORMAL, 2),
            new("topUpExpired", users["malee"], targets.TopUpExpired, SeatZone.NORMAL, 2),
            new("adminMove", users["emily"], targets.AdminMove, SeatZone.PREMIUM, 2),
        ]);
        return pins;
    }

    // ---------- ตัวช่วย ----------

    private static CurrentUser As(User user) => new(user.Id, user.Phone, user.Name, user.Email, user.Role);

    private static DateTime RealNow() => At(NowMs());

    /// <summary>ที่นั่งว่างจริงในฐานตอนนี้ (รวมที่นั่งที่คำขอเปลี่ยนที่นั่งกันไว้)</summary>
    private async Task<List<string>> FreeSeatIdsAsync(SeedShowtime showtime, SeatZone zone, int count)
    {
        var taken = (await db.BookingSeats.Where(bs => bs.ShowtimeId == showtime.Id).Select(bs => bs.SeatId).ToListAsync()).ToHashSet();
        var seats = SeedSeating.PickSeats(world.Inventory[showtime.Theatre.Id], taken, zone, count, world.Random)
            ?? throw new InvalidOperationException(
                $"seed: รอบ {showtime.Theatre.Name} {showtime.StartsAtUtc:yyyy-MM-ddTHH:mm:ss.fffZ} ที่นั่ง {zone} ไม่พอ");
        return seats.Select(seat => seat.Id).ToList();
    }

    private async Task<BookingResponse> BookAsync(SeedUser user, SeedShowtime showtime, SeatZone zone, int count)
    {
        var seatIds = await FreeSeatIdsAsync(showtime, zone, count);
        return await bookings.CreateAsync(user.Id, showtime.Id, seatIds);
    }

    /// <summary>สลิปค่าตั๋ว — amount = ยอดที่เขียนบนสลิป</summary>
    private Task<StoredSlip> TicketSlipAsync(BookingResponse booking, int amount, DateTime at) =>
        slips.StoreOneAsync(SlipKind.Payment, () => slips.RenderPaymentSlip(amount, booking.Payment!.Reference, booking.Code, at));

    /// <summary>
    /// ส่งสลิปค่าตั๋วผ่าน service แล้วย้อนเวลาส่งไป minutesAgo นาที — คิวตรวจสลิปจะได้มีทั้งใบที่เพิ่งเข้ามาและใบที่รอนานแล้ว
    /// ย้อนได้เพราะระหว่างรอตรวจไม่มีอะไรนับถอยหลัง (holdExpiresAt = null)
    /// </summary>
    private async Task SubmitSlipAsync(BookingResponse booking, SeedUser user, int minutesAgo = 0, int amountDelta = 0)
    {
        var uploadedAt = NowMs() - minutesAgo * Minute;
        var file = await TicketSlipAsync(booking, booking.Payment!.Amount + amountDelta, At(uploadedAt));
        await payments.UploadSlipAsync(booking.Id, user.Id, file);
        if (minutesAgo > 0)
        {
            var createdAt = At(uploadedAt - 4 * Minute);
            var slipUploadedAt = At(uploadedAt);
            var now = RealNow();
            await db.Bookings.Where(b => b.Id == booking.Id).ExecuteUpdateAsync(s => s
                .SetProperty(b => b.CreatedAt, createdAt)
                .SetProperty(b => b.UpdatedAt, now));
            await db.Payments.Where(p => p.MainBookingId == booking.Id).ExecuteUpdateAsync(s => s
                .SetProperty(p => p.CreatedAt, createdAt)
                .SetProperty(p => p.SlipUploadedAt, slipUploadedAt)
                .SetProperty(p => p.UpdatedAt, now));
        }
    }

    private Task<Payment> MainPaymentAsync(string bookingId) =>
        db.Payments.AsNoTracking().FirstAsync(p => p.MainBookingId == bookingId);

    /// <summary>ส่งสลิปส่วนต่างของคำขอเปลี่ยนที่นั่งผ่าน service — คืนรายการเงินส่วนต่าง (ก่อนส่ง) ไว้ใช้ปฏิเสธต่อ</summary>
    private async Task<Payment> SendTopUpSlipAsync(string seatChangeId, SalePlan booking, int amountDelta = 0)
    {
        var topUp = await db.Payments.AsNoTracking().FirstAsync(p => p.SeatChangeId == seatChangeId);
        var file = await slips.StoreOneAsync(SlipKind.Payment, () =>
            slips.RenderPaymentSlip(topUp.Amount + amountDelta, topUp.Reference, booking.Code, RealNow()));
        await seatChanges.UploadSlipAsync(seatChangeId, As(booking.User.Entity), file);
        return topUp;
    }

    private static RefundAccount Account(string bankName, string accountNo, SeedUser user) =>
        RefundAccount.Read(bankName, accountNo, user.Name);

    /// <summary>แจ้งเตือนที่ data.{key} เท่ากับค่าใดค่าหนึ่ง — กรองในหน่วยความจำ (มีแค่แจ้งเตือนที่ service เพิ่งสร้างตอน seed)</summary>
    private async Task SetNotificationTimeAsync(
        Func<IQueryable<Notification>, IQueryable<Notification>> filter, string key, IReadOnlyCollection<string> values, DateTime createdAt)
    {
        var rows = await filter(db.Notifications).ToListAsync();
        foreach (var row in rows)
        {
            if (row.Data?[key]?.GetValue<string>() is { } value && values.Contains(value)) row.CreatedAt = createdAt;
        }
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// ย้อนเวลาของสิ่งที่ service เพิ่งเขียนให้การจองชุดนี้ไป minutesAgo นาที (service ประทับเวลา "ตอนนี้" เสมอ)
    /// คิวคืนเงินจะได้มีทั้งเรื่องที่เพิ่งเข้ามาและเรื่องที่รอมาสักพัก แทนที่ทุกใบจะเข้าคิวนาทีเดียวกันตอน seed
    /// ไม่เกิน 55 นาที — ใบที่ pin ไว้จ่ายเงินก่อน "ตอนนี้" อย่างน้อยหนึ่งชั่วโมง (SeedSales) ยกเลิก/ย้ายย้อนไปก็ยังหลังเวลาจ่าย
    /// (Prisma ตั้ง updatedAt ให้เองทุกครั้งที่ updateMany — ที่นี่ตั้งเองตามนั้น)
    /// </summary>
    private async Task BackdateAsync(IReadOnlyCollection<string> bookingIds, int minutesAgo)
    {
        var at = At(NowMs() - minutesAgo * Minute);
        // การจองที่เพิ่งสร้างผ่าน service ในสถานการณ์เดียวกัน ต้องเกิดก่อนเวลาที่ย้อนไป
        var before = at.AddMinutes(-5);
        var since = At(world.Now);
        var now = RealNow();
        var ids = bookingIds.ToList();
        await db.Bookings.Where(b => ids.Contains(b.Id) && b.CreatedAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.CreatedAt, before).SetProperty(b => b.UpdatedAt, now));
        await db.Payments.Where(p => p.MainBookingId != null && ids.Contains(p.MainBookingId) && p.CreatedAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAt, before).SetProperty(p => p.UpdatedAt, now));
        await db.Bookings.Where(b => ids.Contains(b.Id) && b.CancelledAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.CancelledAt, at).SetProperty(b => b.UpdatedAt, now));
        await db.Payments.Where(p => ids.Contains(p.BookingId) && p.RefundDueAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.RefundDueAt, at).SetProperty(p => p.UpdatedAt, at));
        await db.Payments.Where(p => ids.Contains(p.BookingId) && p.SeatChangeId != null && p.CreatedAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.CreatedAt, at).SetProperty(p => p.UpdatedAt, now));
        await db.SeatChanges.Where(c => ids.Contains(c.BookingId) && c.CompletedAt >= since)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.CreatedAt, at).SetProperty(c => c.CompletedAt, at).SetProperty(c => c.UpdatedAt, at));
        await SetNotificationTimeAsync(q => q.Where(n => n.CreatedAt >= since), "bookingId", ids, at);
    }

    // ---------- สถานการณ์ ----------

    /// <summary>รันทุกสถานการณ์ตามลำดับ — คืนคำอธิบายสั้น ๆ ของแต่ละสถานการณ์ ไว้พิมพ์สรุปท้าย seed</summary>
    public async Task<List<string>> RunAsync(SeedTargets targets, IReadOnlyDictionary<string, SalePlan> pinned)
    {
        var users = world.Users;
        var done = new List<string>();
        SalePlan Pin(string key) => pinned[key];

        // ยกเลิกทั้งรอบ — ใบที่จ่ายแล้วเข้าคิวคืนเงิน (ยังไม่มีบัญชี) ใบที่ยังไม่จ่ายถูกปิด แล้วลูกค้าคนหนึ่งแจ้งบัญชีกลับมา
        await BookAsync(users["kamonchanok"], targets.CancelUpcoming, SeatZone.NORMAL, 2);
        var cancelled = await bookings.CancelShowtimeAsync(targets.CancelUpcoming.Id, "เครื่องฉายขัดข้อง รอช่างเปลี่ยนอะไหล่", showtimes);
        var natt = Pin("nattawutCancelledShow");
        await bookings.UpdateRefundAccountAsync(natt.Id, natt.User.Id, "ไทยพาณิชย์", "4071234567", natt.User.Name);
        var closedByShowtime = await db.Bookings.Where(b => b.ShowtimeId == targets.CancelUpcoming.Id).Select(b => b.Id).ToListAsync();
        await BackdateAsync(closedByShowtime, 50);
        done.Add($"ยกเลิกทั้งรอบ {targets.CancelUpcoming.Theatre.Name}: ปิด {cancelled.CancelledBookings} การจอง " +
            $"เข้าคิวคืนเงิน {cancelled.RefundsQueued} ใบ");

        // เปลี่ยนที่นั่ง — ราคาเดิม (ย้ายทันที) · ถูกลง (คืนส่วนต่าง) · แพงขึ้น (รอโอน / สลิปรอตรวจ / ถูกปฏิเสธ / หมดเวลา / ยกเลิกคำขอ)
        // · ผู้ดูแลย้ายให้
        var swap = Pin("somchaiSwap");
        await seatChanges.RequestAsync(swap.Id, swap.User.Id, await FreeSeatIdsAsync(swap.Showtime, SeatZone.NORMAL, 2), RefundAccount.None);
        await BackdateAsync([swap.Id], 30);

        var cheaper = Pin("cheaperChange");
        await seatChanges.RequestAsync(
            cheaper.Id, cheaper.User.Id, await FreeSeatIdsAsync(cheaper.Showtime, SeatZone.NORMAL, 2), Account("กรุงไทย", "9821234567", cheaper.User));
        await BackdateAsync([cheaper.Id], 45);

        var topUpHold = Pin("topUpHold");
        await seatChanges.RequestAsync(topUpHold.Id, topUpHold.User.Id, await FreeSeatIdsAsync(topUpHold.Showtime, SeatZone.PREMIUM, 2), RefundAccount.None);

        var topUpReview = Pin("topUpReview");
        var review = (await seatChanges.RequestAsync(
            topUpReview.Id, topUpReview.User.Id, await FreeSeatIdsAsync(topUpReview.Showtime, SeatZone.PREMIUM, 2), RefundAccount.None)).SeatChange;
        await SendTopUpSlipAsync(review.Id, topUpReview);

        // สลิปส่วนต่างยอดไม่ครบ → ผู้ดูแลปฏิเสธ คำขอกลับไปรอโอนใหม่ (ที่นั่งใหม่ยังถูกกันไว้)
        var topUpRejected = Pin("topUpRejected");
        var rejectedChange = (await seatChanges.RequestAsync(
            topUpRejected.Id, topUpRejected.User.Id, await FreeSeatIdsAsync(topUpRejected.Showtime, SeatZone.PREMIUM, 2), RefundAccount.None)).SeatChange;
        var rejectedTopUp = await SendTopUpSlipAsync(rejectedChange.Id, topUpRejected, amountDelta: -40);
        await payments.RejectAsync(rejectedTopUp.Id, world.Staff.Id, "ยอดส่วนต่างในสลิปไม่ครบ");

        // ไม่ได้โอนส่วนต่างภายในเวลา → คำขอหมดเวลา ที่นั่งใหม่ถูกปล่อย ที่นั่งเดิมยังอยู่ (ขั้นตอนเดียวกับ job)
        // ย้อนเวลาคำขอไป 40 นาที (กันที่นั่ง 10 นาที) ให้ดูเป็นเรื่องที่จบไปแล้ว ไม่ใช่เพิ่งหมดเวลาตอน seed
        var topUpExpired = Pin("topUpExpired");
        var lapsed = (await seatChanges.RequestAsync(
            topUpExpired.Id, topUpExpired.User.Id, await FreeSeatIdsAsync(topUpExpired.Showtime, SeatZone.PREMIUM, 2), RefundAccount.None)).SeatChange;
        var requestedAt = NowMs() - 40 * Minute;
        var lapsedAt = requestedAt + 10 * Minute;
        var (requested, lapsedTime, updatedNow) = (At(requestedAt), At(lapsedAt), RealNow());
        await db.SeatChanges.Where(c => c.Id == lapsed.Id).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.CreatedAt, requested)
            .SetProperty(c => c.HoldExpiresAt, lapsedTime)
            .SetProperty(c => c.UpdatedAt, updatedNow));
        await db.Payments.Where(p => p.SeatChangeId == lapsed.Id).ExecuteUpdateAsync(s => s
            .SetProperty(p => p.CreatedAt, requested)
            .SetProperty(p => p.UpdatedAt, updatedNow));
        var expiredAt = At(lapsedAt + 20 * 1000);
        var expired = await seatChanges.ExpireAsync(lapsed.Id, topUpExpired.Id, topUpExpired.User.Id, topUpExpired.Code, expiredAt);
        if (!expired) throw new InvalidOperationException($"seed: ปิดคำขอเปลี่ยนที่นั่งของ {topUpExpired.Code} เป็นหมดเวลาไม่ได้");
        await SetNotificationTimeAsync(
            q => q.Where(n => n.Type == NotificationType.SEAT_CHANGE_EXPIRED), "seatChangeId", [lapsed.Id], expiredAt);

        // somchai ขอย้ายไปที่นั่งที่แพงกว่า — กำลังนับถอยหลังรอโอนส่วนต่าง (หน้า "การจองของฉัน" มีปุ่มชำระส่วนต่าง)
        var somchaiTopUp = Pin("somchaiTopUp");
        await seatChanges.RequestAsync(
            somchaiTopUp.Id, somchaiTopUp.User.Id, await FreeSeatIdsAsync(somchaiTopUp.Showtime, SeatZone.PREMIUM, 2), RefundAccount.None);

        var topUpCancelled = Pin("topUpCancelled");
        var withdrawn = (await seatChanges.RequestAsync(
            topUpCancelled.Id, topUpCancelled.User.Id, await FreeSeatIdsAsync(topUpCancelled.Showtime, SeatZone.PREMIUM, 1), RefundAccount.None)).SeatChange;
        await seatChanges.CancelAsync(withdrawn.Id, As(topUpCancelled.User.Entity));

        var moved = Pin("adminMove");
        await seatChanges.AdminChangeAsync(
            moved.Id, world.Admin.Id, await FreeSeatIdsAsync(moved.Showtime, SeatZone.PREMIUM, 2), "ลูกค้าโทรแจ้งขอย้ายไปนั่งติดทางเดิน");
        await BackdateAsync([moved.Id], 40);
        done.Add("เปลี่ยนที่นั่ง: ราคาเดิม · ถูกลง (รอคืนส่วนต่าง) · รอโอนส่วนต่าง 2 ใบ · สลิปส่วนต่างรอตรวจ · สลิปส่วนต่างถูกปฏิเสธ " +
            "· หมดเวลาโอนส่วนต่าง · ยกเลิกคำขอ · ผู้ดูแลย้ายให้");

        // ยกเลิกหลังจ่ายเงิน — ลูกค้ายกเลิกเองพร้อมบัญชี · ลูกค้ายกเลิกแล้วผู้ดูแลโอนคืนเสร็จ · ผู้ดูแลยกเลิกให้ (ไม่มีบัญชี)
        var selfCancel = Pin("cancelWithAccount");
        await bookings.CancelAsync(selfCancel.Id, selfCancel.User.Id, byAdmin: false, null, Account("กสิกรไทย", "0531234567", selfCancel.User));
        await BackdateAsync([selfCancel.Id], 35);

        // ยกเลิกเมื่อเกือบชั่วโมงก่อน แล้วผู้ดูแลเพิ่งโอนคืนเสร็จ
        var refundDone = Pin("refundDone");
        await bookings.CancelAsync(refundDone.Id, refundDone.User.Id, byAdmin: false, null, Account("กรุงเทพ", "1234509876", refundDone.User));
        await BackdateAsync([refundDone.Id], 55);
        var refundPayment = await MainPaymentAsync(refundDone.Id);
        var refundSlip = await slips.StoreOneAsync(SlipKind.Refund, () =>
            slips.RenderRefundSlip(refundPayment.RefundAmount ?? 0, refundPayment.RefundAccountNo, refundDone.Code, RealNow()));
        await payments.CompleteRefundAsync(refundPayment.Id, world.Staff.Id, "โอนคืนเต็มจำนวนแล้ว", refundSlip);

        var adminCancel = Pin("adminCancel");
        await bookings.CancelAsync(adminCancel.Id, null, byAdmin: true, "ลูกค้าโทรแจ้งยกเลิก (ติดธุระด่วน)", RefundAccount.None);
        await BackdateAsync([adminCancel.Id], 20);
        done.Add("ยกเลิกหลังจ่ายเงิน: ลูกค้ายกเลิกเอง (รอคืนเงิน) · โอนคืนเสร็จแล้ว · ผู้ดูแลยกเลิกให้ (รอลูกค้าแจ้งบัญชี)");

        // somchai — สลิปถูกปฏิเสธแล้วกลับไปรอชำระ (หน้าชำระเงินมีแถบแดงบอกเหตุผล) + ส่งสลิปแล้วรอตรวจ
        // ค้างรอชำระ/รอตรวจรวม 2 ใบ ต่ำกว่าเพดาน MAX_PENDING_BOOKINGS_PER_USER (3) — ล็อกอินแล้วยังลองจองใหม่ได้
        var somchai = users["somchai"];
        var somchaiRejected = await BookAsync(somchai, targets.SomchaiRejected, SeatZone.PREMIUM, 2);
        await SubmitSlipAsync(somchaiRejected, somchai, minutesAgo: 12, amountDelta: -50);
        await payments.RejectAsync((await MainPaymentAsync(somchaiRejected.Id)).Id, world.Staff.Id, "ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ");
        var somchaiReview = await BookAsync(somchai, targets.SomchaiReview, SeatZone.NORMAL, 3);
        await SubmitSlipAsync(somchaiReview, somchai, minutesAgo: 25);

        // คิวตรวจสลิปของผู้ดูแล — ส่งมาคนละเวลา (ไม่กี่นาทีถึงข้ามคืน) ใบหนึ่งยอดบนสลิปไม่ตรง (ไว้ลองกดปฏิเสธ)
        (SeedUser User, SeatZone Zone, int Count, int MinutesAgo, int AmountDelta)[] queue =
        [
            (users["nattawut"], SeatZone.PREMIUM, 2, 8, 0),
            (users["piyanuch"], SeatZone.SOFA, 1, 47, 0),
            (users["kenji"], SeatZone.NORMAL, 1, 81, -100),
            (users["onuma"], SeatZone.NORMAL, 4, 3 * 60 + 10, 0),
            (users["nanthida"], SeatZone.PREMIUM, 2, 20 * 60 + 35, 0),
        ];
        for (var i = 0; i < queue.Length; i += 1)
        {
            var item = queue[i];
            var booking = await BookAsync(item.User, targets.Queue[i], item.Zone, item.Count);
            await SubmitSlipAsync(booking, item.User, item.MinutesAgo, item.AmountDelta);
        }

        // กดจองแล้วยังไม่ได้จ่าย
        await BookAsync(users["somying"], targets.Hold, SeatZone.NORMAL, 2);
        done.Add("คิวตรวจสลิป 7 ใบ ส่งมาคนละเวลา (ใบหนึ่งยอดไม่ตรง) · somchai สลิปถูกปฏิเสธแล้วรอจ่ายใหม่ · กดจองแล้วยังไม่จ่าย");

        return done;
    }
}
