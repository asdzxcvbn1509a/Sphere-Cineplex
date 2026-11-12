using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Models.Entities;
using CineBook.Web.Services;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;
using static CineBook.Web.Seed.SeedTime;

namespace CineBook.Web.Seed;

/// <summary>บัญชีรับเงินคืนของการจองตัวอย่าง</summary>
public sealed record SaleAccount(string BankName, string AccountNo, string AccountName);

/// <summary>รายการเงินของการจองตัวอย่าง (ค่าตั๋ว หรือส่วนต่างเปลี่ยนที่นั่ง) — เวลาเป็นมิลลิวินาที</summary>
public sealed class SalePayment
{
    public required int Amount { get; init; }
    public required string Reference { get; init; }
    public PaymentStatus Status { get; set; } = PaymentStatus.AWAITING_SLIP;
    public string? SlipPath { get; set; }
    public long? SlipUploadedAt { get; set; }
    public long? VerifiedAt { get; set; }
    public User? VerifiedBy { get; set; }
    public bool Receipt { get; set; }
    public List<SeatSnapshot>? ReceiptSeats { get; set; }
    public string? ReceiptNo { get; set; }
    public string? RejectReason { get; set; }
    public long? RefundDueAt { get; set; }
    public int? RefundAmount { get; set; }
    public SaleAccount? Account { get; set; }
    public long? RefundedAt { get; set; }
    public User? RefundedBy { get; set; }
    public string? RefundSlipPath { get; set; }
    public string? RefundNote { get; set; }
}

/// <summary>คำขอเปลี่ยนที่นั่งที่จ่ายส่วนต่างจบแล้ว</summary>
public sealed class SaleSeatChange
{
    public required List<SeatSnapshot> FromSeats { get; init; }
    public required List<SeatSnapshot> ToSeats { get; init; }
    public required int FromAmount { get; init; }
    public required int ToAmount { get; init; }
    public required int DiffAmount { get; init; }
    public required long CreatedAt { get; init; }
    public required long CompletedAt { get; init; }
    public required SalePayment Payment { get; init; }
}

/// <summary>การจองตัวอย่างหนึ่งใบระหว่างสุ่ม (ยังไม่ได้บันทึก)</summary>
public sealed class SalePlan
{
    public string? Key { get; set; }
    public required string Code { get; init; }
    public required SeedUser User { get; init; }
    public required SeedShowtime Showtime { get; init; }
    public required List<SeatSnapshot> SeatSnapshot { get; set; }
    public required int TotalAmount { get; set; }
    public required long CreatedAt { get; init; }
    public BookingStatus Status { get; set; } = BookingStatus.PENDING_PAYMENT;
    public bool HoldsSeats { get; set; }
    public required SalePayment Payment { get; init; }
    public long? PaidAt { get; set; }
    public long? ReminderSentAt { get; set; }
    public long? ExpiredAt { get; set; }
    public long? CancelledAt { get; set; }
    public string? CancelReason { get; set; }
    /// <summary>customer = ลูกค้ายกเลิกเอง · showtime = ยกเลิกทั้งรอบ</summary>
    public string? CancelledBy { get; set; }
    public string? ShowtimeReason { get; set; }
    public SaleSeatChange? SeatChange { get; set; }
    public string Id { get; set; } = "";
}

/// <summary>การจองที่สถานการณ์ใน SeedScenarios ต้องใช้ต่อ — จองก่อนการสุ่ม ที่นั่งจึงได้แน่นอน</summary>
public sealed record SalePin(
    string Key,
    SeedUser User,
    SeedShowtime Showtime,
    SeatZone Zone,
    int Count,
    string? Outcome = null,
    SeatZone? UpgradeTo = null,
    long? LatestAt = null);

/// <summary>
/// ประวัติการขาย (port จาก prisma/seed/sales.js) — การจองที่ "จบแล้ว" (จ่ายแล้ว ยกเลิก หมดเวลา คืนเงินแล้ว)
/// ทั้งรอบที่ฉายไปแล้วและรอบที่กำลังจะฉาย
///
/// เขียนลงฐานตรง ๆ เพราะต้องย้อนเวลาได้ — service จริงประทับเวลาเป็น "ตอนนี้" เสมอ และจองรอบที่ฉายไปแล้วไม่ได้
/// ทุกแถวจึงต้องสร้างให้ตรงกับที่ service จะสร้างเอง: ที่นั่งของใบที่จ่ายแล้วอยู่ใน BookingSeat (ใบที่ปิดแล้วไม่มี)
/// · ยอดรวม = ผลรวมราคาใน seatSnapshot · เลขใบเสร็จเรียงตามเวลาอนุมัติ และตัวนับ ReceiptCounter ต่อจากเลขสุดท้าย
/// · ข้อความแจ้งเตือนจาก NotificationTemplates ชุดเดียวกับระบบ
///
/// สถานะที่ยังเดินอยู่ (กันที่นั่งรอจ่าย สลิปรอตรวจ คำขอเปลี่ยนที่นั่ง ยกเลิกทั้งรอบ) ทำผ่าน service จริงใน SeedScenarios
/// ลำดับการเรียกตัวสุ่มทุกจุดต้องตรงกับ sales.js เดิม — ห้ามสลับลำดับแม้จะดูไม่มีผล
/// </summary>
public sealed class SeedSales(SeedWorld world, AppDbContext db, AppConfig config, SeedSlips slips)
{
    /// <summary>
    /// ความต้องการรวม (ที่นั่ง) ที่สุ่มให้รอบที่ฉายไปแล้วกับรอบที่กำลังจะฉาย — ตัวนี้คุมปริมาณการจองทั้งหมดของ seed
    /// รอบที่กำลังจะฉายได้ไปแค่ส่วนที่จองมาแล้ว (ราวครึ่งเดียว) งบจึงต้องสูงกว่าที่เห็นจริง
    /// ไม่นับรอบพิเศษที่ SeedScenarios เลือกไว้ (ขายหมด เกือบเต็ม รอบขายดีในสัปดาห์ที่ผ่านมา) ซึ่งเติมตามสัดส่วนของตัวเอง
    /// </summary>
    private const int PastBudget = 300;
    private const int UpcomingBudget = 420;

    /// <summary>จองล่วงหน้าได้ไกลสุดกี่วัน</summary>
    private const int AdvanceDays = 8;

    private static readonly (int Size, double Weight)[] PartySizes = [(1, 18), (2, 42), (3, 14), (4, 16), (5, 6), (6, 4)];
    private static readonly SeatZone[] Zones = [SeatZone.NORMAL, SeatZone.PREMIUM, SeatZone.SOFA];
    private static readonly Dictionary<SeatZone, double> ZoneWeights = new()
    {
        [SeatZone.NORMAL] = 45,
        [SeatZone.PREMIUM] = 42,
        [SeatZone.SOFA] = 13,
    };

    /// <summary>ผลของการจองที่สุ่มขึ้นมา — ส่วนใหญ่จ่ายจบ ที่เหลือหมดเวลา ยกเลิกก่อนจ่าย หรือจ่ายแล้วยกเลิกขอเงินคืน</summary>
    private static readonly (string Outcome, double Weight)[] Outcomes = [("PAID", 86), ("EXPIRED", 6), ("ABANDONED", 3), ("CANCELLED", 5)];

    /// <summary>
    /// จองก่อนรอบฉายนานแค่ไหน — ราวครึ่งหนึ่งจองวันเดียวกับที่ดู ที่เหลือจองล่วงหน้าเป็นวัน
    /// (สัดส่วน, ล่วงหน้าน้อยสุด, มากสุด) หน่วยนาที
    /// </summary>
    private static readonly (double Weight, int MinLead, int MaxLead)[] LeadBands =
        [(45, 20, 8 * 60), (30, 8 * 60, 48 * 60), (25, 48 * 60, AdvanceDays * 24 * 60)];

    private SeedRandom Random => world.Random;

    private static long LatestOf(params long?[] times) => times.Where(t => t is not null).Max(t => t!.Value);

    private HashSet<string> TakenOf(SeedShowtime showtime)
    {
        if (!world.Taken.TryGetValue(showtime.Id, out var taken))
        {
            taken = [];
            world.Taken[showtime.Id] = taken;
        }
        return taken;
    }

    private void Reserve(SeedShowtime showtime, IEnumerable<Seat> seats)
    {
        var taken = TakenOf(showtime);
        foreach (var seat in seats) taken.Add(seat.Id);
    }

    /// <summary>ลูกค้าที่มีการจองในรอบนี้แล้ว (รวมใบที่ pin ไว้)</summary>
    private HashSet<string> BookedUsersOf(SeedShowtime showtime)
    {
        if (!world.BookedUsers.TryGetValue(showtime.Id, out var booked))
        {
            booked = [];
            world.BookedUsers[showtime.Id] = booked;
        }
        return booked;
    }

    /// <summary>
    /// คนที่จองใบนี้ — ไม่ให้คนเดิมจองรอบเดียวกันซ้ำถ้ายังมีลูกค้าคนอื่นเหลือ (ไม่งั้นได้แจ้งเตือนก่อนฉายซ้ำสองอันจากรอบเดียว)
    /// รอบที่คนจองเยอะกว่าจำนวนลูกค้าตัวอย่างจึงซ้ำได้ ยกเว้นบัญชี somchai ที่คนเปิดดูหน้าการจอง/แจ้งเตือนบ่อยที่สุด
    /// </summary>
    private SeedUser PickBooker(SeedShowtime showtime)
    {
        var booked = BookedUsersOf(showtime);
        var somchai = world.Users["somchai"].Id;
        var user = Random.Weighted(world.Bookers, booker => booked.Contains(booker.Id) ? 0 : booker.Activity)
            ?? Random.Weighted(world.Bookers, booker => booker.Id == somchai ? 0 : booker.Activity)!;
        booked.Add(user.Id);
        return user;
    }

    private List<Seat>? PickFor(SeedShowtime showtime, SeatZone zone, int count) =>
        SeedSeating.PickSeats(world.Inventory[showtime.Theatre.Id], TakenOf(showtime), zone, count, Random);

    /// <summary>
    /// เวลากดจองของรอบนี้ — สุ่มระยะจองล่วงหน้านับถอยจากเวลาฉาย คนส่วนใหญ่จองช่วง 8 โมงเช้าถึงเที่ยงคืน
    /// ได้เวลาที่ยังมาไม่ถึง (หลัง "ตอนนี้" − 15 นาที หรือหลัง latestAt) = คนนี้ยังไม่ได้จอง → null
    /// รอบที่อีกหลายวันกว่าจะฉายจึงมีคนจองน้อยกว่ารอบใกล้ ๆ เอง เหมือนยอดที่ค่อย ๆ สะสมจริง
    /// </summary>
    private long? BookingTime(SeedShowtime showtime, long? latestAt)
    {
        var start = showtime.StartsAt;
        var (_, minLead, maxLead) = LeadBands[Random.WeightedIndex(LeadBands, band => band.Weight)];
        // บวกวินาทีสุ่ม — เวลาไม่ลงนาทีเต็มพร้อมกันหลายใบ (ลำดับเลขใบเสร็จจะได้ตรงกับเวลาอนุมัติชัดเจน)
        var created = start - Random.Int(minLead, maxLead) * Minute - Random.Int(0, 59_999);
        var hour = SeedSchedule.BangkokHour(created);
        // ตีหนึ่งถึงเจ็ดโมงส่วนใหญ่หลับอยู่ — ย้ายไปเป็นช่วงสามทุ่มถึงเที่ยงคืนของคืนก่อน
        if (hour < 8 && Random.Chance(0.85)) created -= (hour + Random.Int(1, 3)) * Hour;
        var latest = Math.Min(world.Now - 15 * Minute, latestAt ?? long.MaxValue);
        return created <= latest ? created : null;
    }

    /// <summary>เวลาจองของใบที่ pin ไว้ — ต้องได้แน่นอน สุ่มไม่ได้ก็ใช้เวลาก่อนเส้นตายเล็กน้อย</summary>
    private long PinnedBookingTime(SeedShowtime showtime, long latestAt)
    {
        for (var i = 0; i < 30; i += 1)
        {
            if (BookingTime(showtime, latestAt) is { } created) return created;
        }
        var latest = Math.Min(Math.Min(world.Now - 15 * Minute, latestAt), showtime.StartsAt - 20 * Minute);
        return latest - Random.Int(10, 180) * Minute;
    }

    private static SalePlan NewPlan(SeedUser user, SeedShowtime showtime, IEnumerable<Seat> seats, long createdAt)
    {
        var seatSnapshot = Seats.SortSeats(seats).Select(seat => Seats.SnapshotSeat(seat, showtime.PriceMap[seat.Zone])).ToList();
        var totalAmount = seatSnapshot.Sum(seat => seat.Price);
        return new SalePlan
        {
            Code = Codes.GenerateBookingCode(),
            User = user,
            Showtime = showtime,
            SeatSnapshot = seatSnapshot,
            TotalAmount = totalAmount,
            CreatedAt = createdAt,
            Payment = new SalePayment { Amount = totalAmount, Reference = Codes.GeneratePaymentReference() },
        };
    }

    // ---------- ผลของการจอง ----------

    /// <summary>ส่งสลิปภายในเวลา แล้วผู้ดูแลอนุมัติ (ได้ใบเสร็จ)</summary>
    private void Pay(SalePlan plan)
    {
        var start = plan.Showtime.StartsAt;
        double uploaded = plan.CreatedAt + Random.Int(2, 8) * Minute + Random.Int(0, 59_999);
        double latest = Math.Min(world.Now - Minute, start - 2 * Minute);
        var wanted = uploaded + Random.Int(3, 50) * Minute + Random.Int(0, 59_999);
        // ไม่ทันช่วงที่อยากได้ (ใกล้ "ตอนนี้" หรือใกล้รอบเริ่ม) ก็สุ่มในช่วงที่เหลือ — ไม่ตัดให้ทุกใบไปกองที่เวลาเดียวกัน
        var verified = wanted <= latest ? wanted : uploaded + Minute + Random.Next() * Math.Max(0, latest - uploaded - Minute);

        var payment = plan.Payment;
        payment.Status = PaymentStatus.APPROVED;
        payment.SlipPath = slips.NextName(SlipKind.Payment);
        payment.SlipUploadedAt = (long)JsRound(uploaded);
        payment.VerifiedAt = (long)JsRound(verified);
        payment.VerifiedBy = Random.Chance(0.7) ? world.Admin : world.Staff;
        payment.Receipt = true;
        payment.ReceiptSeats = plan.SeatSnapshot;
        plan.Status = BookingStatus.PAID;
        plan.PaidAt = (long)JsRound(verified);
        plan.HoldsSeats = true;

        // job แจ้งเตือนล่วงหน้า 1 ชั่วโมง — จ่ายหลังจากนั้นก็ได้แจ้งเตือนรอบถัดไปของ job ทันที
        var remindAt = Math.Max(start - Hour, verified + Minute);
        if (remindAt < start && remindAt <= world.Now) plan.ReminderSentAt = (long)JsRound(remindAt);
    }

    /// <summary>ไม่ได้ส่งสลิปภายในเวลากันที่นั่ง — job ปิดการจองและปล่อยที่นั่ง</summary>
    private void Expire(SalePlan plan)
    {
        var expiredAt = plan.CreatedAt + config.SeatHoldMinutes * Minute + Random.Int(0, 30) * 1000L;
        plan.Status = BookingStatus.EXPIRED;
        plan.ExpiredAt = expiredAt;
        plan.CancelReason = "หมดเวลาชำระเงิน";
        plan.Payment.Status = PaymentStatus.REJECTED;
        plan.Payment.RejectReason = "หมดเวลาชำระเงิน";
    }

    /// <summary>ลูกค้ากดยกเลิกเองก่อนจ่าย</summary>
    private void Abandon(SalePlan plan)
    {
        plan.Status = BookingStatus.CANCELLED;
        plan.CancelledAt = plan.CreatedAt + Random.Int(1, 8) * Minute;
        plan.CancelReason = "ผู้ใช้ยกเลิกเอง";
        plan.CancelledBy = "customer";
        plan.Payment.Status = PaymentStatus.REJECTED;
        plan.Payment.RejectReason = "ผู้ใช้ยกเลิกเอง";
    }

    private SaleAccount RefundAccountFor(SeedUser user)
    {
        var bankName = Random.Pick(SeedCatalog.RefundBanks);
        var accountNo = string.Concat(Enumerable.Range(0, 10).Select(_ => Random.Int(0, 9)));
        return new SaleAccount(bankName, accountNo, user.Name);
    }

    private static readonly string?[] RefundNotes = [null, "โอนคืนเต็มจำนวนแล้ว", "โอนคืนตามบัญชีที่ลูกค้าแจ้ง"];

    /// <summary>
    /// ใบที่จ่ายแล้วถูกยกเลิก → เข้าคิวคืนเงินเต็มยอดสุทธิ แล้วถ้าผ่านมานานพอผู้ดูแลโอนคืนไปแล้ว (มีสลิปโอนคืน)
    /// ยังไม่มีบัญชีรับเงินคืน = ค้างคิวจนกว่าลูกค้าจะแจ้ง (เคสยกเลิกทั้งรอบ)
    /// </summary>
    private void QueueRefund(SalePlan plan, long dueAt, SaleAccount? account, int refundAfterHours)
    {
        var payment = plan.Payment;
        payment.Status = PaymentStatus.REFUND_PENDING;
        payment.RefundDueAt = dueAt;
        payment.RefundAmount = plan.TotalAmount;
        payment.Account = account;
        var refundedAt = dueAt + refundAfterHours * Hour + Random.Int(0, 59) * Minute;
        if (account is not null && refundedAt <= world.Now - 5 * Minute)
        {
            payment.Status = PaymentStatus.REFUNDED;
            payment.RefundedAt = refundedAt;
            payment.RefundedBy = Random.Chance(0.5) ? world.Admin : world.Staff;
            payment.RefundSlipPath = slips.NextName(SlipKind.Refund);
            payment.RefundNote = Random.Pick(RefundNotes);
        }
    }

    private static void DropReminderAfter(SalePlan plan, long cancelledAt)
    {
        if (plan.ReminderSentAt is { } reminded && reminded > cancelledAt) plan.ReminderSentAt = null;
    }

    /// <summary>จ่ายแล้วยกเลิกเอง — ต้องก่อนรอบฉายอย่างน้อย CANCEL_CUTOFF_HOURS (กติกาเดียวกับการยกเลิกจริง) ไม่ทันก็คงเป็นใบที่จ่ายแล้ว</summary>
    private bool CancelAfterPaying(SalePlan plan, int? refundAfterHours = null)
    {
        var paid = plan.PaidAt!.Value;
        var latest = Math.Min(plan.Showtime.StartsAt - config.CancelCutoffHours * Hour, world.Now - 5 * Minute);
        if (latest - paid < 10 * Minute) return false;

        var cancelledAt = (long)JsRound(paid + 5 * Minute + (latest - paid - 5 * Minute) * Random.Next());
        plan.Status = BookingStatus.CANCELLED;
        plan.CancelledAt = cancelledAt;
        plan.CancelReason = "ผู้ใช้ยกเลิกเอง";
        plan.CancelledBy = "customer";
        plan.HoldsSeats = false;
        DropReminderAfter(plan, cancelledAt);
        var account = RefundAccountFor(plan.User);
        QueueRefund(plan, cancelledAt, account, refundAfterHours ?? Random.Int(2, 30));
        return true;
    }

    /// <summary>รอบถูกยกเลิกทั้งรอบ — ใบที่จ่ายแล้วเข้าคิวคืนเงิน ลูกค้าส่วนใหญ่แจ้งบัญชีมาทีหลังแล้วได้เงินคืน</summary>
    private void CancelWithShowtime(SalePlan plan, long cancelledAt, string reason)
    {
        plan.Status = BookingStatus.CANCELLED;
        plan.CancelledAt = cancelledAt;
        plan.CancelReason = $"รอบฉายถูกยกเลิก: {reason}";
        plan.CancelledBy = "showtime";
        plan.ShowtimeReason = reason;
        plan.HoldsSeats = false;
        DropReminderAfter(plan, cancelledAt);
        var account = Random.Chance(0.75) ? RefundAccountFor(plan.User) : null;
        QueueRefund(plan, cancelledAt, account, Random.Int(5, 40));
    }

    /// <summary>
    /// ย้ายไปที่นั่งที่แพงกว่า + จ่ายส่วนต่างแล้ว (ผู้ดูแลอนุมัติ ได้ใบเสร็จส่วนต่าง) — แบบเดียวกับ ApproveTopUpAsync
    /// ใบเสร็จค่าตั๋วยังเป็นที่นั่งชุดเดิม (ReceiptSeats) การจองเปลี่ยนเป็นชุดใหม่และยอดใหม่
    /// </summary>
    private void Upgrade(SalePlan plan, List<Seat> toSeats)
    {
        var change = SeatChangePlanner.Plan(plan.SeatSnapshot, toSeats, plan.Showtime.PriceMap);
        var requested = Math.Min(plan.PaidAt!.Value + Day + Random.Int(0, 120) * Minute, world.Now - 3 * Hour);
        var uploaded = requested + Random.Int(2, 7) * Minute;
        var completed = uploaded + Random.Int(5, 40) * Minute;

        plan.SeatChange = new SaleSeatChange
        {
            FromSeats = plan.SeatSnapshot,
            ToSeats = change.ToSeats,
            FromAmount = change.FromAmount,
            ToAmount = change.ToAmount,
            DiffAmount = change.DiffAmount,
            CreatedAt = requested,
            CompletedAt = completed,
            Payment = new SalePayment
            {
                Amount = change.DiffAmount,
                Reference = Codes.GeneratePaymentReference(),
                SlipPath = slips.NextName(SlipKind.Payment),
                SlipUploadedAt = uploaded,
                VerifiedAt = completed,
                VerifiedBy = world.Staff,
                Receipt = true,
            },
        };
        plan.SeatSnapshot = change.ToSeats;
        plan.TotalAmount = change.ToAmount;
    }

    private void ApplyOutcome(SalePlan plan, string outcome)
    {
        if (outcome == "EXPIRED")
        {
            Expire(plan);
            return;
        }
        if (outcome == "ABANDONED")
        {
            Abandon(plan);
            return;
        }
        Pay(plan);
        if (outcome == "CANCELLED") CancelAfterPaying(plan);
    }

    // ---------- สุ่มยอดขายของแต่ละรอบ ----------

    /// <summary>
    /// ความต้องการรวมของรอบ (นับถึงวันฉาย) — รอบค่ำ เสาร์อาทิตย์ หนังดัง และ IMAX/4DX ขายได้มากกว่า
    /// รอบที่ยังไม่ถึงวันฉายได้ไปแค่ส่วนที่ "จองมาแล้ว" (ดู BookingTime)
    /// </summary>
    private static double DemandWeight(SeedShowtime showtime)
    {
        var hour = SeedSchedule.BangkokHour(showtime.StartsAt);
        var weekday = SeedSchedule.BangkokWeekday(showtime.StartsAt);
        var weight = hour < 13 ? 0.35 : hour < 17 ? 0.7 : hour < 21 ? 1.6 : 0.9;
        if (weekday == 5) weight *= 1.2;
        if (weekday is 0 or 6) weight *= 1.6;
        weight *= showtime.Movie.Data.Popularity;
        if (showtime.Theatre.ScreenType is "IMAX" or "4DX") weight *= 1.3;
        return weight;
    }

    /// <summary>
    /// แบ่งงบที่นั่งให้แต่ละรอบตามความต้องการ บวกความผันผวน — ยกกำลังน้ำหนักให้รอบยอดนิยมกินส่วนแบ่งมากกว่าเส้นตรง
    /// และราวหนึ่งในสี่ของรอบไม่มีคนจองเลย แบบโรงจริงที่รอบกลางวันวันธรรมดาว่างทั้งโรง
    /// </summary>
    private List<(SeedShowtime Showtime, int Target)> Distribute(List<SeedShowtime> showtimes, int budget)
    {
        var weights = showtimes.Select(showtime => Math.Pow(DemandWeight(showtime), 1.6)).ToList();
        var total = 0.0;
        foreach (var weight in weights) total += weight;
        if (total == 0) total = 1;
        var result = new List<(SeedShowtime, int)>();
        for (var i = 0; i < showtimes.Count; i += 1)
        {
            var capacity = world.Inventory[showtimes[i].Theatre.Id].Total;
            var noise = Random.Chance(0.25) ? 0 : 0.4 + 1.5 * Random.Next();
            var target = (int)JsRound(budget * (weights[i] / total) * noise);
            result.Add((showtimes[i], Math.Min(target, (int)Math.Floor(capacity * 0.75))));
        }
        return result;
    }

    /// <summary>
    /// ขายที่นั่งของรอบนี้จนได้ targetSeats ที่ (นับเฉพาะใบที่ยังถือที่นั่ง) — คนที่มาด้วยกันได้ที่นั่งติดกัน
    /// allPaid = ทุกใบจ่ายจบ (รอบขายหมด) · mustFill = ขายให้ได้ตามเป้าจริง ไม่นับคนที่ยังไม่มาจอง (รอบขายหมด/เกือบเต็ม)
    /// latestAt = ห้ามจองหลังเวลานี้ (รอบที่ถูกยกเลิกไปแล้ว)
    /// </summary>
    private List<SalePlan> FillShowtime(SeedShowtime showtime, int targetSeats, bool allPaid = false, bool? mustFill = null, long? latestAt = null)
    {
        var mustReachTarget = mustFill ?? allPaid;
        var plans = new List<SalePlan>();
        var filled = 0;

        for (var guard = 0; filled < targetSeats && guard < 400; guard += 1)
        {
            var party = PartySizes[Random.WeightedIndex(PartySizes, item => item.Weight)].Size;
            // กลุ่มสุดท้ายเกินเป้าได้ — ยกเว้นรอบขายหมดที่ต้องเติมช่องที่เหลือให้พอดี (เหลือที่เดี่ยว ๆ ก็ได้คนมาคนเดียว)
            var size = allPaid ? Math.Min(party, targetSeats - filled) : party;
            var preferred = Zones[Random.WeightedIndex(Zones, zone => zone == SeatZone.SOFA && size == 1 ? 0 : ZoneWeights[zone])];
            // โซฟาเป็นที่นั่งคู่ — มาสองคนใช้หนึ่งตัว
            int CountIn(SeatZone zone) => zone == SeatZone.SOFA ? (int)Math.Ceiling(size / 2.0) : size;
            var seats = PickFor(showtime, preferred, CountIn(preferred));
            foreach (var zone in Zones)
            {
                if (seats is not null) break;
                if (zone != preferred) seats = PickFor(showtime, zone, CountIn(zone));
            }
            if (seats is null)
            {
                if (size == 1) break; // เต็มแล้ว
                continue;
            }

            var createdAt = BookingTime(showtime, latestAt);
            if (createdAt is null)
            {
                // คนกลุ่มนี้ยังไม่ได้มาจอง (จะจองทีหลัง) — นับเป็นความต้องการที่ยังไม่เกิด ยกเว้นรอบที่ต้องขายให้ถึงเป้าจริง
                if (!mustReachTarget) filled += seats.Count;
                continue;
            }
            var user = PickBooker(showtime);
            var plan = NewPlan(user, showtime, seats, createdAt.Value);
            ApplyOutcome(plan, allPaid ? "PAID" : Outcomes[Random.WeightedIndex(Outcomes, item => item.Weight)].Outcome);
            if (plan.HoldsSeats)
            {
                Reserve(showtime, seats);
                filled += seats.Count;
            }
            plans.Add(plan);
        }
        return plans;
    }

    /// <summary>การจองที่สถานการณ์ใน SeedScenarios ต้องใช้ต่อ (เช่น ใบที่จ่ายแล้วไว้ลองเปลี่ยนที่นั่ง/ยกเลิก)</summary>
    private SalePlan BuildPinned(SalePin pin)
    {
        var seats = PickFor(pin.Showtime, pin.Zone, pin.Count)
            ?? throw new InvalidOperationException($"seed: เตรียมการจอง \"{pin.Key}\" ไม่ได้ (ที่นั่งไม่พอ)");
        var createdAt = PinnedBookingTime(pin.Showtime, pin.LatestAt ?? world.Now - 2 * Hour);

        var plan = NewPlan(pin.User, pin.Showtime, seats, createdAt);
        plan.Key = pin.Key;
        BookedUsersOf(pin.Showtime).Add(pin.User.Id);

        if (pin.Outcome == "EXPIRED")
        {
            Expire(plan);
            return plan;
        }
        Pay(plan);
        if (pin.Outcome == "REFUNDED" && !CancelAfterPaying(plan, Random.Int(3, 20)))
        {
            throw new InvalidOperationException($"seed: การจอง \"{pin.Key}\" ยกเลิกก่อนรอบฉายตามกติกาไม่ทัน");
        }
        if (pin.Outcome == "UPGRADED")
        {
            var toSeats = PickFor(pin.Showtime, pin.UpgradeTo!.Value, pin.Count)
                ?? throw new InvalidOperationException($"seed: หาที่นั่งใหม่ให้ \"{pin.Key}\" ไม่ได้");
            Upgrade(plan, toSeats);
            Reserve(pin.Showtime, toSeats);
            return plan;
        }
        if (plan.HoldsSeats) Reserve(pin.Showtime, seats);
        return plan;
    }

    // ---------- ใบเสร็จ แจ้งเตือน และแถวที่บันทึก ----------

    /// <summary>เลขใบเสร็จเรียงตามเวลาอนุมัติจริง (แยกชุดตามปี) — คืนค่าตัวนับของแต่ละปีให้การอนุมัติครั้งถัดไปออกเลขต่อได้</summary>
    private static List<ReceiptCounter> AssignReceipts(List<SalePlan> plans)
    {
        var issued = plans
            .SelectMany(plan => new[] { plan.Payment, plan.SeatChange?.Payment })
            .Where(payment => payment?.Receipt == true)
            .Select(payment => payment!)
            .OrderBy(payment => payment.VerifiedAt)
            .ToList();
        var lastByYear = new List<ReceiptCounter>();
        foreach (var payment in issued)
        {
            var year = Receipts.ReceiptYear(At(payment.VerifiedAt!.Value));
            var counter = lastByYear.Find(c => c.Year == year);
            if (counter is null)
            {
                counter = new ReceiptCounter { Year = year, LastNo = 0 };
                lastByYear.Add(counter);
            }
            counter.LastNo += 1;
            payment.ReceiptNo = Receipts.FormatReceiptNo(year, counter.LastNo);
        }
        return lastByYear;
    }

    private static Booking BookingRow(SalePlan plan) => new()
    {
        Id = plan.Id,
        Code = plan.Code,
        UserId = plan.User.Id,
        ShowtimeId = plan.Showtime.Id,
        Status = plan.Status,
        TotalAmount = plan.TotalAmount,
        HoldExpiresAt = null,
        SeatSnapshot = plan.SeatSnapshot,
        CancelReason = plan.CancelReason,
        ReminderSentAt = Utc(plan.ReminderSentAt),
        PaidAt = Utc(plan.PaidAt),
        CancelledAt = Utc(plan.CancelledAt),
        ExpiredAt = Utc(plan.ExpiredAt),
        CreatedAt = At(plan.CreatedAt),
        UpdatedAt = At(LatestOf(plan.CreatedAt, plan.PaidAt, plan.CancelledAt, plan.ExpiredAt, plan.SeatChange?.CompletedAt)),
    };

    private static DateTime? Utc(long? ms) => ms is null ? null : At(ms.Value);

    private Payment PaymentRow(SalePlan plan)
    {
        var payment = plan.Payment;
        return new Payment
        {
            BookingId = plan.Id,
            // ใบหลัก (ค่าตั๋วตอนจอง) — booking.Payment อ่านผ่านตัวนี้
            MainBookingId = plan.Id,
            Kind = PaymentKind.BOOKING,
            Amount = payment.Amount,
            QrPayload = PromptPay.CreatePayload(config.PromptPayId, payment.Amount),
            Reference = payment.Reference,
            SlipPath = payment.SlipPath,
            SlipUploadedAt = Utc(payment.SlipUploadedAt),
            Status = payment.Status,
            VerifiedById = payment.VerifiedBy?.Id,
            VerifiedAt = Utc(payment.VerifiedAt),
            RejectReason = payment.RejectReason,
            ReceiptNo = payment.ReceiptNo,
            ReceiptName = payment.ReceiptNo is null ? null : plan.User.Name,
            ReceiptSeats = payment.ReceiptNo is null ? null : payment.ReceiptSeats,
            RefundDueAt = Utc(payment.RefundDueAt),
            RefundAmount = payment.RefundAmount,
            RefundBankName = payment.Account?.BankName,
            RefundAccountNo = payment.Account?.AccountNo,
            RefundAccountName = payment.Account?.AccountName,
            RefundedAt = Utc(payment.RefundedAt),
            RefundedById = payment.RefundedBy?.Id,
            RefundSlipPath = payment.RefundSlipPath,
            RefundNote = payment.RefundNote,
            CreatedAt = At(plan.CreatedAt),
            UpdatedAt = At(LatestOf(
                plan.CreatedAt,
                payment.SlipUploadedAt,
                payment.VerifiedAt,
                payment.RefundDueAt,
                payment.RefundedAt,
                plan.CancelledAt,
                plan.ExpiredAt)),
        };
    }

    /// <summary>แจ้งเตือนเก่าส่วนใหญ่ถูกเปิดอ่านไปแล้ว ของช่วงไม่กี่ชั่วโมงล่าสุดส่วนใหญ่ยังไม่อ่าน</summary>
    private DateTime? ReadAtFor(long createdAt)
    {
        var age = world.Now - createdAt;
        var read = age > 2 * Day || (age > 6 * Hour && Random.Chance(0.6)) || Random.Chance(0.15);
        if (!read) return null;
        var readAt = Math.Min(createdAt + Random.Int(5, 600) * Minute, world.Now - Minute);
        return readAt > createdAt ? At(readAt) : null;
    }

    private Notification Notice(
        SalePlan plan, NotificationType type, long createdAt, NotificationContext context, params (string Key, string? Value)[] data)
    {
        var notification = NotificationTemplates.Create(
            plan.User.Id, type, context, NotificationTemplates.Data([("bookingId", plan.Id), .. data]));
        notification.CreatedAt = At(createdAt);
        notification.ReadAt = ReadAtFor(createdAt);
        return notification;
    }

    /// <summary>แจ้งเตือนที่ระบบจะส่งให้ตามเส้นทางของการจองใบนี้ (ข้อความชุดเดียวกับ NotifyAsync ของ service)</summary>
    private List<Notification> NotificationsFor(SalePlan plan)
    {
        var (code, payment, showtime) = (plan.Code, plan.Payment, plan.Showtime);
        var list = new List<Notification>();
        if (payment.ReceiptNo is not null)
        {
            list.Add(Notice(plan, NotificationType.PAYMENT_APPROVED, payment.VerifiedAt!.Value,
                new NotificationContext { Code = code, ReceiptNo = payment.ReceiptNo }));
        }
        if (plan.ReminderSentAt is { } remindedAt)
        {
            list.Add(Notice(plan, NotificationType.SHOWTIME_REMINDER, remindedAt, new NotificationContext
            {
                MovieTh = showtime.Movie.Entity.TitleTh,
                MovieEn = showtime.Movie.Entity.TitleEn,
                Theatre = showtime.Theatre.Name,
                TimeText = BangkokTime.FormatTime(showtime.StartsAtUtc),
            }));
        }
        if (plan.Status == BookingStatus.EXPIRED)
        {
            list.Add(Notice(plan, NotificationType.BOOKING_EXPIRED, plan.ExpiredAt!.Value, new NotificationContext { Code = code }));
        }
        if (plan.CancelledBy == "customer")
        {
            list.Add(Notice(plan, NotificationType.BOOKING_CANCELLED, plan.CancelledAt!.Value, new NotificationContext { Code = code }));
        }
        if (plan.CancelledBy == "showtime")
        {
            list.Add(Notice(
                plan,
                NotificationType.SHOWTIME_CANCELLED,
                plan.CancelledAt!.Value,
                new NotificationContext
                {
                    MovieTh = showtime.Movie.Entity.TitleTh,
                    MovieEn = showtime.Movie.Entity.TitleEn,
                    WhenTh = BangkokTime.FormatShort(showtime.StartsAtUtc, "th"),
                    WhenEn = BangkokTime.FormatShort(showtime.StartsAtUtc, "en"),
                    Reason = plan.ShowtimeReason,
                    Code = code,
                    Refund = payment.RefundDueAt is not null,
                },
                ("showtimeId", showtime.Id)));
        }
        if (payment.RefundedAt is { } refundedAt)
        {
            list.Add(Notice(plan, NotificationType.REFUND_COMPLETED, refundedAt,
                new NotificationContext { Code = code, Amount = payment.RefundAmount }));
        }
        return list;
    }

    private static string Labels(IEnumerable<SeatSnapshot> seats) => string.Join(", ", Seats.SeatLabels(seats));

    /// <summary>คำขอเปลี่ยนที่นั่งที่จ่ายส่วนต่างจบแล้ว + รายการเงินส่วนต่าง</summary>
    private Notification WriteSeatChange(SalePlan plan)
    {
        var change = plan.SeatChange!;
        var seatChange = new SeatChange
        {
            BookingId = plan.Id,
            Status = SeatChangeStatus.COMPLETED,
            FromSeats = change.FromSeats,
            ToSeats = change.ToSeats,
            FromAmount = change.FromAmount,
            ToAmount = change.ToAmount,
            DiffAmount = change.DiffAmount,
            CompletedAt = At(change.CompletedAt),
            CreatedAt = At(change.CreatedAt),
            UpdatedAt = At(change.CompletedAt),
        };
        db.SeatChanges.Add(seatChange);
        var payment = change.Payment;
        db.Payments.Add(new Payment
        {
            BookingId = plan.Id,
            Kind = PaymentKind.SEAT_CHANGE_TOPUP,
            SeatChangeId = seatChange.Id,
            Amount = payment.Amount,
            QrPayload = PromptPay.CreatePayload(config.PromptPayId, payment.Amount),
            Reference = payment.Reference,
            SlipPath = payment.SlipPath,
            SlipUploadedAt = Utc(payment.SlipUploadedAt),
            Status = PaymentStatus.APPROVED,
            VerifiedById = payment.VerifiedBy!.Id,
            VerifiedAt = Utc(payment.VerifiedAt),
            ReceiptNo = payment.ReceiptNo,
            ReceiptName = plan.User.Name,
            CreatedAt = At(change.CreatedAt),
            UpdatedAt = At(change.CompletedAt),
        });
        return Notice(
            plan,
            NotificationType.SEATS_CHANGED,
            change.CompletedAt,
            new NotificationContext
            {
                Code = plan.Code,
                From = Labels(change.FromSeats),
                To = Labels(change.ToSeats),
                Diff = change.DiffAmount,
                ByAdmin = false,
                Reason = null,
                ReceiptNo = payment.ReceiptNo,
            },
            ("seatChangeId", seatChange.Id));
    }

    private async Task WritePlansAsync(List<SalePlan> plans)
    {
        var counters = AssignReceipts(plans);
        foreach (var plan in plans) plan.Id = Cuid.New();

        db.ChangeTracker.AutoDetectChangesEnabled = false;
        db.Bookings.AddRange(plans.Select(BookingRow));
        db.BookingSeats.AddRange(plans
            .Where(plan => plan.HoldsSeats)
            .SelectMany(plan => plan.SeatSnapshot
                .Select(seat => new BookingSeat { BookingId = plan.Id, ShowtimeId = plan.Showtime.Id, SeatId = seat.Id, Price = seat.Price })
                // เขียนที่นั่งเรียงตาม id แบบเดียวกับการจองจริง
                .OrderBy(row => row.SeatId, StringComparer.Ordinal)));
        db.Payments.AddRange(plans.Select(PaymentRow));

        // ToList ตรงนี้ — ลำดับการสุ่มเวลาอ่านแจ้งเตือนต้องเป็นแจ้งเตือนของทุกใบก่อน แล้วค่อยของคำขอเปลี่ยนที่นั่ง
        var notifications = plans.SelectMany(NotificationsFor).ToList();
        foreach (var plan in plans.Where(item => item.SeatChange is not null)) notifications.Add(WriteSeatChange(plan));

        db.ReceiptCounters.AddRange(counters);
        db.Notifications.AddRange(notifications);
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync();
        db.ChangeTracker.AutoDetectChangesEnabled = true;
        db.ChangeTracker.Clear();
    }

    private List<SeedSlips.SlipJob> SlipJobs(List<SalePlan> plans)
    {
        var jobs = new List<SeedSlips.SlipJob>();
        foreach (var plan in plans)
        {
            foreach (var payment in new[] { plan.Payment, plan.SeatChange?.Payment })
            {
                if (payment?.SlipPath is { } slipPath)
                {
                    jobs.Add(new SeedSlips.SlipJob(SlipKind.Payment, slipPath, () =>
                        slips.RenderPaymentSlip(payment.Amount, payment.Reference, plan.Code, At(payment.SlipUploadedAt!.Value))));
                }
                if (payment?.RefundSlipPath is { } refundSlipPath)
                {
                    jobs.Add(new SeedSlips.SlipJob(SlipKind.Refund, refundSlipPath, () =>
                        slips.RenderRefundSlip(payment.RefundAmount ?? 0, payment.Account?.AccountNo, plan.Code, At(payment.RefundedAt!.Value))));
                }
            }
        }
        return jobs;
    }

    /// <summary>
    /// สร้างประวัติการขายทั้งหมด — คืนการจองที่ pin ไว้ (key → plan ที่มี id แล้ว) ให้ SeedScenarios ใช้ต่อ
    /// </summary>
    public async Task<Dictionary<string, SalePlan>> RunAsync(IReadOnlyList<SalePin> pins, SeedTargets targets)
    {
        var plans = new List<SalePlan>();
        var pinned = new Dictionary<string, SalePlan>();

        foreach (var pin in pins)
        {
            var plan = BuildPinned(pin);
            plans.Add(plan);
            pinned[pin.Key] = plan;
        }

        int CapacityOf(SeedShowtime showtime) => world.Inventory[showtime.Theatre.Id].Total;
        plans.AddRange(FillShowtime(targets.SoldOut, CapacityOf(targets.SoldOut), allPaid: true));
        plans.AddRange(FillShowtime(targets.NearlyFull, (int)JsRound(CapacityOf(targets.NearlyFull) * 0.85), mustFill: true));
        foreach (var (showtime, fill) in targets.BusyPast)
        {
            plans.AddRange(FillShowtime(showtime, (int)JsRound(CapacityOf(showtime) * fill), mustFill: true));
        }

        // รอบที่ถูกยกเลิกไปเมื่อไม่กี่วันก่อน (ก่อนฉายราวชั่วโมงครึ่ง) — การจองทั้งหมดเกิดก่อนเวลายกเลิก
        var cancelledAt = targets.CancelledPast.StartsAt - 100 * Minute;
        const string reason = "ไฟฟ้าดับทั้งอาคาร";
        foreach (var plan in FillShowtime(targets.CancelledPast, 16, latestAt: cancelledAt - 10 * Minute))
        {
            if (plan.Status == BookingStatus.PAID) CancelWithShowtime(plan, cancelledAt, reason);
            plans.Add(plan);
        }

        var special = new HashSet<string>(
            new[] { targets.SoldOut.Id, targets.NearlyFull.Id, targets.CancelledPast.Id }
                .Concat(targets.BusyPast.Select(item => item.Showtime.Id)));
        var rest = world.Showtimes.Where(showtime => !special.Contains(showtime.Id)).ToList();
        var past = rest.Where(showtime => showtime.StartsAt <= world.Now).ToList();
        var upcoming = rest.Where(showtime => showtime.StartsAt > world.Now).ToList();
        // แบ่งงบทั้งสองฝั่งก่อน แล้วค่อยเติมทีละรอบ — ลำดับเดียวกับเดิม
        var distributed = Distribute(past, PastBudget).Concat(Distribute(upcoming, UpcomingBudget)).ToList();
        foreach (var (showtime, target) in distributed) plans.AddRange(FillShowtime(showtime, target));

        await WritePlansAsync(plans);
        var now = SeedTime.At(NowMs());
        await db.Showtimes.Where(s => s.Id == targets.CancelledPast.Id).ExecuteUpdateAsync(s => s
            .SetProperty(x => x.Status, ShowtimeStatus.CANCELLED)
            .SetProperty(x => x.UpdatedAt, now));
        await slips.StoreAsync(SlipJobs(plans));

        return pinned;
    }
}
