using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>
/// เปลี่ยนที่นั่งของการจองที่จ่ายแล้ว (จำนวนที่นั่งเท่าเดิม) — port จาก services/seatChanges.js
///
/// - ราคาเท่าเดิม / ถูกลง → ย้ายทันทีในคราวเดียว (ถูกลง = ส่วนต่างเข้าคิวคืนเงินที่ /admin/refunds)
/// - แพงขึ้น → กันที่นั่งใหม่ไว้ SEAT_HOLD_MINUTES รอโอนส่วนต่าง ระหว่างนี้ที่นั่งเดิมยังเป็นของลูกค้า
///   ย้ายจริงเมื่อผู้ดูแลอนุมัติสลิปส่วนต่าง (คิวตรวจสลิปเดียวกับค่าตั๋ว) แล้วออกใบเสร็จส่วนต่างให้
///
/// ทุกเมธอดล็อกตามลำดับล็อกทั้งระบบ (ดู Locks) สองรายการที่ชนกันจึงต่อคิวกัน ไม่รอกันเองจน deadlock
/// </summary>
public sealed class SeatChangeService(
    AppDbContext db,
    AppConfig config,
    TimeProvider time,
    BookingService bookings,
    SlipService slips,
    ReceiptService receipts,
    ISlipStorage storage)
{
    public sealed record ChangeResult(BookingResponse Booking, SeatChangeResponse SeatChange);

    private static string SeatIdsKey(IEnumerable<SeatSnapshot>? seats) =>
        string.Join(',', (seats ?? []).Select(seat => seat.Id).Order(StringComparer.Ordinal));

    private static string Labels(IEnumerable<SeatSnapshot> seats) => string.Join(", ", Seats.SeatLabels(seats));

    private static ApiException PendingError(string? seatChangeId) =>
        ApiException.Conflict(
            "SEAT_CHANGE_PENDING",
            "มีคำขอเปลี่ยนที่นั่งที่ยังไม่เสร็จอยู่ กรุณาชำระส่วนต่างหรือยกเลิกคำขอเดิมก่อน",
            new { seatChangeId });

    private ApiException LimitError() =>
        ApiException.Conflict(
            "SEAT_CHANGE_LIMIT",
            $"เปลี่ยนที่นั่งได้สูงสุด {config.MaxSeatChangesPerBooking} ครั้งต่อการจอง",
            new { max = config.MaxSeatChangesPerBooking });

    private static ApiException NotAllowedError() =>
        ApiException.Conflict("SEAT_CHANGE_NOT_ALLOWED", "เปลี่ยนที่นั่งได้เฉพาะการจองที่ชำระเงินแล้ว");

    private static ApiException ShowtimeCancelledError() => ApiException.BadRequest("SHOWTIME_CANCELLED", "รอบฉายนี้ถูกยกเลิกแล้ว");

    private static ApiException NotPayable() =>
        ApiException.Conflict("SEAT_CHANGE_NOT_PAYABLE", "คำขอนี้ไม่อยู่ในสถานะที่ชำระส่วนต่างได้แล้ว");

    /// <summary>แปลงเหตุผลจาก SeatChangeRules.Blocker เป็น error ที่หน้าเว็บเลือกข้อความได้</summary>
    private ApiException BlockedError(string reason, Booking booking) => reason switch
    {
        "NOT_PAID" => NotAllowedError(),
        "SHOWTIME_CANCELLED" => ShowtimeCancelledError(),
        "WINDOW_CLOSED" => ApiException.Forbidden(
            "SEAT_CHANGE_WINDOW_CLOSED",
            $"เปลี่ยนที่นั่งได้ก่อนรอบฉายอย่างน้อย {config.SeatChangeCutoffMinutes} นาทีเท่านั้น",
            new { cutoffMinutes = config.SeatChangeCutoffMinutes }),
        "PENDING" => PendingError(SeatChangeRules.OpenSeatChange(booking.SeatChanges)?.Id),
        _ => LimitError(),
    };

    private Task<Booking?> LoadBookingAsync(string bookingId) =>
        db.Bookings.AsNoTracking()
            .Include(b => b.Showtime).ThenInclude(s => s.ZonePrices)
            .Include(b => b.SeatChanges)
            .FirstOrDefaultAsync(b => b.Id == bookingId);

    /// <summary>คิดชุดที่นั่งใหม่จาก id ที่ลูกค้าเลือก — ที่นั่งต้องอยู่ในโรงของรอบนี้ และที่นั่งใหม่ต้องเปิดใช้งาน</summary>
    private async Task<SeatChangePlan> PlanForAsync(Booking booking, IEnumerable<string> seatIds)
    {
        var ids = seatIds.Distinct().ToList();
        var seats = await db.Seats.AsNoTracking()
            .Where(s => ids.Contains(s.Id) && s.TheatreId == booking.Showtime.TheatreId)
            .ToListAsync();
        // ที่นั่งที่คงไว้ใช้ต่อได้แม้ผู้ดูแลเพิ่งปิดใช้งาน (เป็นของลูกค้าอยู่แล้ว) ส่วนที่นั่งใหม่ต้องยังเปิดขายอยู่
        var current = booking.SeatSnapshot.Select(seat => seat.Id).ToHashSet();
        if (seats.Count != ids.Count || seats.Any(seat => !current.Contains(seat.Id) && !seat.IsActive))
        {
            throw ApiException.BadRequest("INVALID_SEATS", "มีที่นั่งบางที่ไม่ถูกต้องสำหรับรอบฉายนี้");
        }
        // ลำดับของ newSeats ไม่มีผล — แผนเรียงที่นั่งเองทุกจุด
        return SeatChangePlanner.Plan(
            booking.SeatSnapshot,
            seats,
            Pricing.ToPriceMap(booking.Showtime.ZonePrices, booking.Showtime.BasePrice));
    }

    private static NotificationContext SeatsChangedContext(string code, SeatChange change, string? receiptNo = null) => new()
    {
        Code = code,
        From = Labels(change.FromSeats),
        To = Labels(change.ToSeats),
        Diff = change.DiffAmount,
        ByAdmin = change.ByAdmin,
        Reason = change.Reason,
        ReceiptNo = receiptNo,
    };

    private static SeatChange NewChange(Booking booking, SeatChangePlan plan) => new()
    {
        BookingId = booking.Id,
        FromSeats = booking.SeatSnapshot,
        ToSeats = plan.ToSeats,
        FromAmount = plan.FromAmount,
        ToAmount = plan.ToAmount,
        DiffAmount = plan.DiffAmount,
    };

    /// <summary>ราคาเท่าเดิมหรือถูกลง — ย้ายเสร็จในคราวเดียว</summary>
    private async Task<SeatChange> CompleteNowAsync(
        Booking booking, SeatChangePlan plan, DateTime now, RefundAccount refundAccount, (string Id, string? Reason)? admin)
    {
        var change = NewChange(booking, plan);
        change.Status = SeatChangeStatus.COMPLETED;
        change.CompletedAt = now;
        change.ByAdmin = admin is not null;
        change.AdminId = admin?.Id;
        change.Reason = admin?.Reason;
        db.SeatChanges.Add(change);
        await db.SaveChangesAsync();

        // ปล่อยที่นั่งเดิมที่ไม่ได้ไปต่อ แล้วจองที่นั่งใหม่ — ที่นั่งใหม่ชนกับคนอื่น = unique ชนแล้วทั้ง transaction ย้อนกลับ
        // การจองจึงยังอยู่ที่นั่งเดิมครบ ไม่มีจังหวะที่ลูกค้าเสียที่นั่งเดิมไปก่อนได้ที่ใหม่
        await db.BookingSeats
            .Where(bs => bs.BookingId == booking.Id && bs.SeatChangeId == null && plan.Released.Contains(bs.SeatId))
            .ExecuteDeleteAsync();
        await Sql.InsertBookingSeatsAsync(db, booking.Id, booking.ShowtimeId, plan.Added);
        await db.Bookings.Where(b => b.Id == booking.Id).ExecuteUpdateAsync(s => s
            .SetProperty(b => b.SeatSnapshot, plan.ToSeats)
            .SetProperty(b => b.TotalAmount, plan.ToAmount)
            .SetProperty(b => b.UpdatedAt, now));

        if (plan.DiffAmount < 0)
        {
            // ส่วนต่างที่ต้องคืน — ระบบไม่ได้ตัดเงินเอง จึงเข้าคิวให้ผู้ดูแลโอนคืนเหมือนยกเลิกหลังจ่ายเงิน
            change.Payment = new Payment
            {
                BookingId = booking.Id,
                Kind = PaymentKind.SEAT_CHANGE_REFUND,
                SeatChangeId = change.Id,
                Amount = -plan.DiffAmount,
                RefundAmount = -plan.DiffAmount,
                Reference = Codes.GeneratePaymentReference(),
                Status = PaymentStatus.REFUND_PENDING,
                RefundDueAt = now,
                RefundBankName = refundAccount.BankName,
                RefundAccountNo = refundAccount.AccountNo,
                RefundAccountName = refundAccount.AccountName,
            };
            db.Payments.Add(change.Payment);
            await db.SaveChangesAsync();
        }

        await NotificationService.NotifyAsync(
            db, booking.UserId, NotificationType.SEATS_CHANGED,
            SeatsChangedContext(booking.Code, change),
            NotificationTemplates.Data(("bookingId", booking.Id), ("seatChangeId", change.Id)));
        return change;
    }

    /// <summary>แพงขึ้น — กันที่นั่งใหม่ไว้รอโอนส่วนต่าง ที่นั่งเดิมยังเป็นของลูกค้าจนกว่าผู้ดูแลจะยืนยันยอด</summary>
    private async Task<SeatChange> HoldForTopUpAsync(Booking booking, SeatChangePlan plan, DateTime now)
    {
        var change = NewChange(booking, plan);
        change.Status = SeatChangeStatus.PENDING_PAYMENT;
        change.HoldExpiresAt = now.AddMinutes(config.SeatHoldMinutes);
        db.SeatChanges.Add(change);
        await db.SaveChangesAsync();

        await Sql.InsertBookingSeatsAsync(db, booking.Id, booking.ShowtimeId, plan.Added, change.Id);
        change.Payment = new Payment
        {
            BookingId = booking.Id,
            Kind = PaymentKind.SEAT_CHANGE_TOPUP,
            SeatChangeId = change.Id,
            Amount = plan.DiffAmount,
            QrPayload = PromptPay.CreatePayload(config.PromptPayId, plan.DiffAmount),
            Reference = Codes.GeneratePaymentReference(),
        };
        db.Payments.Add(change.Payment);
        await db.SaveChangesAsync();
        return change;
    }

    /// <summary>
    /// บันทึกการเปลี่ยนที่นั่ง — ใช้ทั้งลูกค้าย้ายเองและผู้ดูแลย้ายแทน (admin = id และเหตุผล)
    /// ด่านจริงอยู่ใน transaction หลังล็อกแถวการจองแล้ว: ยัง PAID อยู่ ที่นั่งยังเป็นชุดที่ใช้คิดส่วนต่าง ไม่มีคำขอค้าง และโควตายังเหลือ
    /// </summary>
    private async Task<ChangeResult> ApplyAsync(
        Booking booking, SeatChangePlan plan, RefundAccount refundAccount, (string Id, string? Reason)? admin = null)
    {
        var now = time.UtcNowMs();
        SeatChange change;
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            // ล็อกแถวรอบฉายแบบแชร์แบบเดียวกับตอนจอง — ถ้าผู้ดูแลกำลังยกเลิกทั้งรอบ ตรงนี้รอจนเขาเสร็จแล้วเห็นสถานะใหม่
            if (await Locks.LockShowtimeAsync(db, booking.ShowtimeId) != ShowtimeStatus.SCHEDULED) throw ShowtimeCancelledError();

            // ล็อกแถวการจอง แล้วยืนยันว่ายังเป็นที่นั่งชุดเดียวกับที่ใช้คิดส่วนต่าง — สองคำขอที่มาพร้อมกันต่อคิวกันตรงนี้
            // คำขอที่ช้ากว่าเห็นที่นั่งชุดใหม่แล้วจึงตกไป แทนที่จะลบที่นั่งตามชุดเก่า จนเหลือที่นั่งค้างที่ไม่มีใครจ่าย
            var live = await Locks.LockBookingAsync(db, booking.Id);
            if (live?.Status != BookingStatus.PAID || SeatIdsKey(live.SeatSnapshot) != SeatIdsKey(booking.SeatSnapshot))
            {
                throw Locks.BookingStateChanged();
            }

            var changes = await db.SeatChanges.AsNoTracking().Where(c => c.BookingId == booking.Id).ToListAsync();
            var open = SeatChangeRules.OpenSeatChange(changes);
            if (open is not null) throw PendingError(open.Id);
            if (admin is null && SeatChangeRules.Used(changes) >= config.MaxSeatChangesPerBooking) throw LimitError();

            change = plan.DiffAmount > 0
                ? await HoldForTopUpAsync(booking, plan, now)
                : await CompleteNowAsync(booking, plan, now, refundAccount, admin);
            await tx.CommitAsync();
        }
        catch (Exception error) when (Locks.IsSeatConflict(error))
        {
            db.ChangeTracker.Clear();
            throw await Locks.SeatTakenErrorAsync(db, booking.ShowtimeId, plan.Added.Select(item => item.SeatId).ToList());
        }

        db.ChangeTracker.Clear();
        return new ChangeResult(await bookings.GetByIdAsync(booking.Id), SeatChangeRules.Shape(change, time.UtcNowMs()));
    }

    /// <summary>ลูกค้าขอเปลี่ยนที่นั่งเอง</summary>
    public async Task<ChangeResult> RequestAsync(string bookingId, string userId, IEnumerable<string> seatIds, RefundAccount refundAccount)
    {
        var booking = await LoadBookingAsync(bookingId) ?? throw BookingAccess.BookingNotFound();
        if (booking.UserId != userId) throw BookingAccess.NotBookingOwner("ไม่มีสิทธิ์เปลี่ยนที่นั่งของรายการจองนี้");
        if (SeatChangeRules.Blocker(booking, config, time.UtcNowMs()) is { } blocked) throw BlockedError(blocked, booking);

        var plan = await PlanForAsync(booking, seatIds);

        // ย้ายไปที่นั่งที่ถูกกว่า — ส่วนต่างต้องโอนคืนด้วยมือ จึงต้องรู้บัญชีปลายทางก่อน (แบบเดียวกับยกเลิกหลังจ่ายเงิน)
        if (plan.DiffAmount < 0 && !refundAccount.IsComplete)
        {
            throw ApiException.BadRequest(
                "REFUND_ACCOUNT_REQUIRED",
                "กรุณาระบุธนาคารและเลขที่บัญชีสำหรับรับเงินส่วนต่างคืน",
                new { diffAmount = plan.DiffAmount });
        }

        return await ApplyAsync(booking, plan, refundAccount);
    }

    /// <summary>
    /// ผู้ดูแลย้ายที่นั่งแทนลูกค้า (ที่นั่งชำรุด ลูกค้าโทรมาขอ) — ได้เฉพาะโซนเดิมทุกที่ จึงไม่มีส่วนต่างราคา
    /// ไม่ติดเส้นตายและไม่นับโควตาของลูกค้า แต่ย้อนหลังหลังรอบฉายจบแล้วไม่ได้
    /// </summary>
    public async Task<ChangeResult> AdminChangeAsync(string bookingId, string adminId, IEnumerable<string> seatIds, string? reason)
    {
        var booking = await LoadBookingAsync(bookingId) ?? throw BookingAccess.BookingNotFound();
        if (booking.Status != BookingStatus.PAID) throw NotAllowedError();
        if (booking.Showtime.Status != ShowtimeStatus.SCHEDULED) throw ShowtimeCancelledError();
        if (booking.Showtime.EndsAt <= time.UtcNowMs())
        {
            throw ApiException.Conflict("SHOWTIME_ENDED", "รอบนี้ฉายจบไปแล้ว เปลี่ยนที่นั่งย้อนหลังไม่ได้");
        }
        if (SeatChangeRules.OpenSeatChange(booking.SeatChanges) is { } open) throw PendingError(open.Id);

        var plan = await PlanForAsync(booking, seatIds);
        if (!SeatChangePlanner.SameZones(booking.SeatSnapshot, plan.ToSeats))
        {
            throw ApiException.BadRequest("SEAT_ZONE_MISMATCH", "ผู้ดูแลย้ายแทนได้เฉพาะที่นั่งโซนเดียวกับที่จองไว้ (ไม่มีส่วนต่างราคา)");
        }

        var note = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        return await ApplyAsync(booking, plan, RefundAccount.None, (adminId, note));
    }

    // ---------- ส่วนต่างที่ต้องโอนเพิ่ม ----------

    /// <summary>
    /// คำขอนี้ส่งสลิปส่วนต่างได้ไหม — กติกาเดียวกับค่าตั๋ว (ได้เฉพาะตอนรอโอน หมดเวลาแล้วไม่รับ)
    /// ใช้ได้เฉพาะคำขอที่มีรายการโอนส่วนต่าง
    /// </summary>
    private static bool CanUploadTopUpSlip(SeatChange change) =>
        change.Payment?.Kind == PaymentKind.SEAT_CHANGE_TOPUP && SlipService.CanUploadSlip(change.Status);

    /// <summary>คำขอเปลี่ยนที่นั่งหนึ่งรายการ (รวม payload สำหรับ render QR) — เจ้าของการจองหรือผู้ดูแลเท่านั้น</summary>
    public async Task<SeatChangeDetailResponse> GetAsync(string seatChangeId, CurrentUser requester)
    {
        var change = await db.SeatChanges.AsNoTracking()
            .Include(c => c.Payment)
            .Include(c => c.Booking).ThenInclude(b => b.Showtime).ThenInclude(s => s.Movie)
            .Include(c => c.Booking).ThenInclude(b => b.Showtime).ThenInclude(s => s.Theatre)
            .FirstOrDefaultAsync(c => c.Id == seatChangeId) ?? throw BookingAccess.SeatChangeNotFound();
        if (!BookingAccess.CanAccessBooking(requester, change.Booking.UserId)) throw BookingAccess.NotBookingOwner();

        var shaped = SeatChangeRules.Shape(change, time.UtcNowMs());
        var booking = change.Booking;
        var payment = change.Payment;
        return new SeatChangeDetailResponse(
            shaped.Id,
            shaped.Status,
            shaped.FromSeats,
            shaped.ToSeats,
            shaped.FromAmount,
            shaped.ToAmount,
            shaped.DiffAmount,
            shaped.ByAdmin,
            shaped.Reason,
            shaped.CloseReason,
            shaped.HoldExpiresAt,
            shaped.HoldSecondsLeft,
            shaped.CreatedAt,
            shaped.CompletedAt,
            payment is null || shaped.Payment is not { } p
                ? null
                : new SeatChangeDetailPayment(
                    p.Id, p.Kind, p.Status, p.Amount, p.RefundAmount, p.ReceiptNo, p.RejectReason,
                    p.RefundBankName, p.RefundAccountNo, p.RefundAccountName, p.RefundedAt, p.RefundNote, p.HasRefundSlip,
                    payment.Reference, payment.QrPayload, config.PromptPayId, config.PromptPayMerchantName,
                    payment.SlipUploadedAt, payment.SlipPath is not null),
            CanUploadTopUpSlip(change),
            new SeatChangeDetailBooking(
                booking.Id,
                booking.Code,
                booking.Status,
                new SeatChangeDetailShowtime(
                    booking.Showtime.Id,
                    booking.Showtime.StartsAt,
                    new SeatChangeDetailMovie(booking.Showtime.Movie.Id, booking.Showtime.Movie.TitleTh, booking.Showtime.Movie.TitleEn, booking.Showtime.Movie.PosterUrl),
                    new ShowtimeTheatre(booking.Showtime.Theatre.Id, booking.Showtime.Theatre.Name, booking.Showtime.Theatre.ScreenType))));
    }

    private Task<SeatChange?> LoadForSlipAsync(string seatChangeId) =>
        db.SeatChanges.AsNoTracking().Include(c => c.Payment).Include(c => c.Booking)
            .FirstOrDefaultAsync(c => c.Id == seatChangeId);

    /// <summary>
    /// ลูกค้าส่งสลิปส่วนต่าง — หยุดนับถอยหลังระหว่างรอผู้ดูแลตรวจ ที่นั่งใหม่ถูกกันไว้ต่อจนกว่าจะรู้ผล
    /// ใช้ขั้นตอนเดียวกับสลิปค่าตั๋ว (QueueSlipForReviewAsync — หมดเวลาแล้วส่งไม่ได้ และลบไฟล์ทิ้งเมื่อทำรายการไม่สำเร็จ)
    /// </summary>
    public async Task<SeatChangeDetailResponse> UploadSlipAsync(string seatChangeId, CurrentUser user, StoredSlip? file)
    {
        if (file is null) throw ApiException.BadRequest("NO_FILE", "กรุณาแนบรูปสลิปการโอนเงิน");

        var previousSlip = await slips.DiscardSlipOnErrorAsync(file, async () =>
        {
            var change = await LoadForSlipAsync(seatChangeId);
            if (change?.Payment is null) throw BookingAccess.SeatChangeNotFound();
            if (change.Booking.UserId != user.Id) throw BookingAccess.NotBookingOwner();
            var now = time.UtcNowMs();
            await slips.QueueSlipForReviewAsync(
                new SlipService.HolderState(change.Status.ToString(), change.Payment.Status),
                CanUploadTopUpSlip(change),
                () => db.SeatChanges
                    .Where(c => c.Id == change.Id && c.Status == SeatChangeStatus.PENDING_PAYMENT)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, SeatChangeStatus.PENDING_VERIFICATION)
                        .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(c => c.UpdatedAt, now)),
                change.Payment.Id,
                file.FileName,
                async () =>
                {
                    var current = await LoadForSlipAsync(seatChangeId);
                    return new SlipService.HolderState(current?.Status.ToString() ?? "", current?.Payment?.Status);
                },
                NotPayable,
                "SEAT_CHANGE_NOT_PAYABLE",
                change.Booking.Code);
            return change.Payment.SlipPath;
        });

        // ลบสลิปเก่าทิ้ง (ส่งใหม่หลังถูกปฏิเสธ) หลังบันทึกสำเร็จแล้วเท่านั้น
        if (previousSlip is not null && previousSlip != file.FileName) await storage.RemoveAsync(SlipKind.Payment, previousSlip);

        return await GetAsync(seatChangeId, user);
    }

    /// <summary>ปิดคำขอที่ยังรอโอนส่วนต่าง (ต้อง CAS สถานะคำขอสำเร็จก่อน) — คืนที่นั่งที่กันไว้ และปิดรายการเงินที่ยังไม่มีสลิป</summary>
    private async Task ReleaseTopUpHoldAsync(string seatChangeId, string rejectReason, DateTime now)
    {
        await db.BookingSeats.Where(bs => bs.SeatChangeId == seatChangeId).ExecuteDeleteAsync();
        await db.Payments
            .Where(p => p.SeatChangeId == seatChangeId && p.Status == PaymentStatus.AWAITING_SLIP)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                .SetProperty(p => p.RejectReason, rejectReason)
                .SetProperty(p => p.UpdatedAt, now));
    }

    /// <summary>ลูกค้ายกเลิกคำขอเอง — ได้เฉพาะก่อนส่งสลิปส่วนต่าง (ส่งแล้วต้องรอผลตรวจ เหตุผลเดียวกับการยกเลิกการจอง)</summary>
    public async Task<SeatChangeDetailResponse> CancelAsync(string seatChangeId, CurrentUser user)
    {
        var change = await db.SeatChanges.AsNoTracking().Include(c => c.Booking).FirstOrDefaultAsync(c => c.Id == seatChangeId)
            ?? throw BookingAccess.SeatChangeNotFound();
        if (change.Booking.UserId != user.Id) throw BookingAccess.NotBookingOwner();
        if (change.Status == SeatChangeStatus.PENDING_VERIFICATION)
        {
            throw ApiException.Conflict("SEAT_CHANGE_AWAITING_VERIFICATION", "สลิปส่วนต่างกำลังรอผู้ดูแลตรวจสอบ กรุณารอผลก่อน");
        }
        if (change.Status != SeatChangeStatus.PENDING_PAYMENT)
        {
            throw ApiException.Conflict("SEAT_CHANGE_CLOSED", "คำขอเปลี่ยนที่นั่งนี้จบไปแล้ว");
        }

        const string reason = "ลูกค้ายกเลิกคำขอเปลี่ยนที่นั่ง";
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var now = time.UtcNowMs();
            var count = await db.SeatChanges
                .Where(c => c.Id == seatChangeId && c.Status == SeatChangeStatus.PENDING_PAYMENT)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(c => c.Status, SeatChangeStatus.CANCELLED)
                    .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                    .SetProperty(c => c.CloseReason, reason)
                    .SetProperty(c => c.UpdatedAt, now));
            if (count == 0) throw Locks.BookingStateChanged();
            await ReleaseTopUpHoldAsync(seatChangeId, reason, now);
            await tx.CommitAsync();
        }

        return await GetAsync(seatChangeId, user);
    }

    /// <summary>
    /// ปิดคำขอหนึ่งรายการที่หมดเวลาโอนส่วนต่าง — คืน true ถ้าปิดจริง
    /// เงื่อนไข "ยังรอโอน + เลยเวลาแล้ว" อยู่ใน where เหมือนการจองที่หมดเวลา ถ้าลูกค้าส่งสลิปเข้ามาพอดีก็ไม่ไปทับ
    /// ที่นั่งเดิมของลูกค้าไม่ได้แตะเลย — แค่ที่นั่งใหม่ที่กันไว้ถูกปล่อย
    /// </summary>
    public async Task<bool> ExpireAsync(string id, string bookingId, string userId, string code, DateTime now)
    {
        const string reason = "หมดเวลาโอนส่วนต่าง";
        await using var tx = await db.Database.BeginTransactionAsync();
        var count = await db.SeatChanges
            .Where(c => c.Id == id && c.Status == SeatChangeStatus.PENDING_PAYMENT && c.HoldExpiresAt < now)
            // หมดเวลาแล้วจบ — ส่งสลิปส่วนต่างไม่ได้อีก · expiredAt เก็บไว้เป็นประวัติ
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Status, SeatChangeStatus.EXPIRED)
                .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                .SetProperty(c => c.ExpiredAt, now)
                .SetProperty(c => c.CloseReason, reason)
                .SetProperty(c => c.UpdatedAt, now));
        if (count == 0) return false;

        await ReleaseTopUpHoldAsync(id, reason, now);
        await NotificationService.NotifyAsync(
            db, userId, NotificationType.SEAT_CHANGE_EXPIRED,
            new NotificationContext { Code = code },
            NotificationTemplates.Data(("bookingId", bookingId), ("seatChangeId", id)));
        await tx.CommitAsync();
        return true;
    }

    /// <summary>ปล่อยที่นั่งที่กันไว้ของคำขอที่ไม่ได้โอนส่วนต่างภายในเวลา — เรียกจากงานเบื้องหลัง</summary>
    public async Task<int> ReleaseExpiredAsync()
    {
        var now = time.UtcNowMs();
        var candidates = await db.SeatChanges.AsNoTracking()
            .Where(c => c.Status == SeatChangeStatus.PENDING_PAYMENT && c.HoldExpiresAt < now)
            .Select(c => new { c.Id, c.BookingId, c.Booking.UserId, c.Booking.Code })
            .ToListAsync();

        var released = 0;
        foreach (var change in candidates)
        {
            if (await ExpireAsync(change.Id, change.BookingId, change.UserId, change.Code, now)) released += 1;
        }
        return released;
    }

    // ---------- ผู้ดูแลตรวจสลิปส่วนต่าง (เรียกจาก PaymentService.ApproveAsync / RejectAsync) ----------

    /// <summary>
    /// อนุมัติสลิปส่วนต่าง → ย้ายที่นั่งจริง + ออกใบเสร็จส่วนต่าง (และส่งทางอีเมล)
    /// payment โหลดมาพร้อม Booking (และ User) และ SeatChange แล้ว
    /// </summary>
    public async Task<BookingResponse> ApproveTopUpAsync(Payment payment, string adminId)
    {
        var change = payment.SeatChange!;

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var now = time.UtcNowMs();

            // ระหว่างที่สลิปส่วนต่างรอตรวจ ไม่มีใครเปลี่ยนที่นั่งหรือยกเลิกการจองนี้ได้ (มีด่านกันไว้ทุกทาง)
            // ที่นั่งของการจองจึงยังเป็น fromSeats อยู่ — เขียนชุดใหม่ทับได้ตรง ๆ ตามลำดับล็อก Booking → SeatChange → BookingSeat → Payment
            var moved = await db.Bookings
                .Where(b => b.Id == payment.BookingId && b.Status == BookingStatus.PAID)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(b => b.SeatSnapshot, change.ToSeats)
                    .SetProperty(b => b.TotalAmount, change.ToAmount)
                    .SetProperty(b => b.UpdatedAt, now));
            var settled = await db.SeatChanges
                .Where(c => c.Id == change.Id && c.Status == SeatChangeStatus.PENDING_VERIFICATION)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(c => c.Status, SeatChangeStatus.COMPLETED)
                    .SetProperty(c => c.CompletedAt, now)
                    .SetProperty(c => c.UpdatedAt, now));
            if (moved == 0 || settled == 0) throw Locks.PaymentNotPending();

            var toIds = change.ToSeats.Select(seat => seat.Id).ToHashSet();
            var released = change.FromSeats.Where(seat => !toIds.Contains(seat.Id)).Select(seat => seat.Id).ToList();
            await db.BookingSeats
                .Where(bs => bs.BookingId == payment.BookingId && bs.SeatChangeId == null && released.Contains(bs.SeatId))
                .ExecuteDeleteAsync();
            // ที่นั่งที่กันไว้กลายเป็นที่นั่งของการจองจริง
            await db.BookingSeats
                .Where(bs => bs.SeatChangeId == change.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(bs => bs.SeatChangeId, (string?)null));

            var paid = await db.Payments
                .Where(p => p.Id == payment.Id && p.Status == PaymentStatus.PENDING_VERIFICATION)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Status, PaymentStatus.APPROVED)
                    .SetProperty(p => p.VerifiedById, adminId)
                    .SetProperty(p => p.VerifiedAt, now)
                    .SetProperty(p => p.RejectReason, (string?)null)
                    .SetProperty(p => p.UpdatedAt, now));
            if (paid == 0) throw Locks.PaymentNotPending();
            // ออกเลขหลังผ่านด่านเช็กสถานะแล้วเท่านั้น (ผู้ดูแลที่กดซ้ำตกไปก่อนถึงตรงนี้ จึงไม่เปลืองเลข) — ReceiptCounter ล็อกเป็นลำดับสุดท้าย
            var receiptNo = await ReceiptService.IssueReceiptNoAsync(db, now);
            var payerName = payment.Booking.User.Name;
            await db.Payments.Where(p => p.Id == payment.Id).ExecuteUpdateAsync(s => s
                .SetProperty(p => p.ReceiptNo, receiptNo)
                .SetProperty(p => p.ReceiptName, payerName)
                .SetProperty(p => p.UpdatedAt, now));
            await NotificationService.NotifyAsync(
                db, payment.Booking.UserId, NotificationType.SEATS_CHANGED,
                SeatsChangedContext(payment.Booking.Code, change, receiptNo),
                NotificationTemplates.Data(("bookingId", payment.BookingId), ("seatChangeId", change.Id)));
            await tx.CommitAsync();
        }

        // ส่งหลัง commit แล้วเท่านั้น
        await receipts.EmailAsync(payment.BookingId, payment.Id);
        return await bookings.GetByIdAsync(payment.BookingId);
    }

    /// <summary>
    /// ปฏิเสธสลิปส่วนต่าง — ปกติคำขอกลับไปรอโอนใหม่ พร้อมเวลาใหม่ (REJECTED_RETRY_MINUTES) ที่นั่งใหม่ยังถูกกันไว้
    /// ยกเว้นรอบเริ่มฉายแล้ว — ปิดคำขอ คืนที่นั่งที่กันไว้ (ที่นั่งเดิมของลูกค้าไม่ได้แตะ) และส่งสลิปใหม่ไม่ได้อีก
    /// </summary>
    public async Task<BookingResponse> RejectTopUpAsync(Payment payment, string adminId, string reason)
    {
        var change = payment.SeatChange!;
        var now = time.UtcNowMs();
        var closed = payment.Booking.Showtime.StartsAt <= now;

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            int settled;
            if (closed)
            {
                var closeReason = $"สลิปส่วนต่างไม่ผ่านการตรวจสอบหลังรอบเริ่มฉาย: {reason}";
                settled = await db.SeatChanges
                    .Where(c => c.Id == change.Id && c.Status == SeatChangeStatus.PENDING_VERIFICATION)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, SeatChangeStatus.EXPIRED)
                        .SetProperty(c => c.ExpiredAt, now)
                        .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(c => c.CloseReason, closeReason)
                        .SetProperty(c => c.UpdatedAt, now));
                if (settled > 0) await db.BookingSeats.Where(bs => bs.SeatChangeId == change.Id).ExecuteDeleteAsync();
            }
            else
            {
                var retryUntil = now.AddMinutes(config.RejectedRetryMinutes);
                settled = await db.SeatChanges
                    .Where(c => c.Id == change.Id && c.Status == SeatChangeStatus.PENDING_VERIFICATION)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, SeatChangeStatus.PENDING_PAYMENT)
                        .SetProperty(c => c.HoldExpiresAt, retryUntil)
                        .SetProperty(c => c.UpdatedAt, now));
            }

            var rejected = await db.Payments
                .Where(p => p.Id == payment.Id && p.Status == PaymentStatus.PENDING_VERIFICATION)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                    .SetProperty(p => p.RejectReason, reason)
                    .SetProperty(p => p.VerifiedById, adminId)
                    .SetProperty(p => p.VerifiedAt, now)
                    .SetProperty(p => p.UpdatedAt, now));
            if (settled == 0 || rejected == 0) throw Locks.PaymentNotPending();

            await NotificationService.NotifyAsync(
                db, payment.Booking.UserId, NotificationType.SEAT_CHANGE_REJECTED,
                new NotificationContext { Code = payment.Booking.Code, Reason = reason, Closed = closed },
                NotificationTemplates.Data(("bookingId", payment.BookingId), ("seatChangeId", change.Id)));
            await tx.CommitAsync();
        }

        return await bookings.GetByIdAsync(payment.BookingId);
    }
}
