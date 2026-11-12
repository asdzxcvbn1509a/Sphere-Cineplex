using System.Linq.Expressions;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>บัญชีรับเงินคืนที่ลูกค้ากรอกมา (ตัดช่องว่างแล้ว) — ช่องที่ไม่ได้ส่งมาเป็น null</summary>
public sealed record RefundAccount(string? BankName, string? AccountNo, string? AccountName)
{
    public static readonly RefundAccount None = new(null, null, null);

    /// <summary>ตัดช่องว่างหัวท้าย — ค่าว่างถือว่าไม่ได้ส่งมา (ใช้ร่วมกับการเปลี่ยนที่นั่ง)</summary>
    public static RefundAccount Read(string? bankName, string? accountNo, string? accountName)
    {
        static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        // ชื่อบัญชีไม่บังคับ — client รุ่นก่อนไม่ได้ส่งมา จึงไม่อยู่ในเงื่อนไข REFUND_ACCOUNT_REQUIRED
        return new RefundAccount(Clean(bankName), Clean(accountNo), Clean(accountName));
    }

    public bool IsComplete => BankName is not null && AccountNo is not null;
}

/// <summary>การจอง การยกเลิก และการหมดเวลาชำระ (port จาก services/bookings.js)</summary>
public sealed class BookingService(AppDbContext db, AppConfig config, TimeProvider time)
{
    // ---------- โหลดและจัดรูป ----------

    /// <summary>
    /// การจองพร้อมทุกอย่างที่การ์ดการจองต้องใช้ — รอบฉาย (หนัง/โรง) ใบชำระเงินหลัก
    /// และประวัติการเปลี่ยนที่นั่ง + รายการเงินของส่วนต่าง (ปุ่มเปลี่ยนที่นั่ง ป้ายรอโอนส่วนต่าง/รอคืนส่วนต่าง)
    /// </summary>
    public static IQueryable<Booking> WithCard(IQueryable<Booking> bookings) =>
        bookings
            .Include(b => b.Showtime).ThenInclude(s => s.Movie)
            .Include(b => b.Showtime).ThenInclude(s => s.Theatre)
            .Include(b => b.Payment)
            .Include(b => b.SeatChanges.OrderBy(c => c.CreatedAt)).ThenInclude(c => c.Payment)
            .AsSplitQuery();

    private static bool HasTopUpAwaitingVerification(Booking booking) =>
        (booking.SeatChanges ?? []).Any(change => change.Status == SeatChangeStatus.PENDING_VERIFICATION);

    private static ApiException SeatChangeAwaitingVerification() =>
        ApiException.Conflict(
            "SEAT_CHANGE_AWAITING_VERIFICATION",
            "สลิปส่วนต่างเปลี่ยนที่นั่งกำลังรอผู้ดูแลตรวจสอบ กรุณารอผลก่อนจึงจะยกเลิกการจองได้");

    private bool CanCancel(Booking booking, DateTime now)
    {
        if (booking.Status == BookingStatus.PENDING_PAYMENT) return true;
        // ส่งสลิปแล้วรอผู้ดูแลตัดสิน — ยกเลิกเองไม่ได้ ไม่งั้นเงินที่โอนมาแล้วจะหลุดออกนอกระบบ
        if (booking.Status == BookingStatus.PENDING_VERIFICATION) return false;
        if (booking.Status != BookingStatus.PAID) return false;
        if (HasTopUpAwaitingVerification(booking)) return false;
        return booking.Showtime.StartsAt - now >= TimeSpan.FromHours(config.CancelCutoffHours);
    }

    public BookingResponse Shape(Booking booking, bool includeUser = false)
    {
        var now = time.UtcNowMs();
        var payment = booking.Payment;
        var showtime = booking.Showtime;
        return new BookingResponse(
            booking.Id,
            booking.Code,
            booking.Status,
            booking.TotalAmount,
            booking.HoldExpiresAt,
            SlipService.HoldSecondsLeft(booking.HoldExpiresAt, now),
            booking.SeatSnapshot,
            booking.CreatedAt,
            booking.PaidAt,
            booking.CancelledAt,
            booking.ExpiredAt,
            booking.CancelReason,
            SlipService.CanUploadSlip(booking.Status),
            CanCancel(booking, now),
            config.CancelCutoffHours,
            SeatChangeRules.Info(booking, config, now),
            new BookingShowtimeInfo(
                showtime.Id,
                showtime.StartsAt,
                showtime.EndsAt,
                new BookingMovie(showtime.Movie.Id, showtime.Movie.TitleTh, showtime.Movie.TitleEn, showtime.Movie.PosterUrl, showtime.Movie.DurationMin),
                new ShowtimeTheatre(showtime.Theatre.Id, showtime.Theatre.Name, showtime.Theatre.ScreenType)),
            payment is null
                ? null
                : new BookingPaymentInfo(
                    payment.Id,
                    payment.Status,
                    payment.Amount,
                    payment.Reference,
                    payment.ReceiptNo,
                    payment.SlipUploadedAt,
                    payment.RefundBankName,
                    payment.RefundAccountNo,
                    payment.RefundAccountName,
                    payment.SlipPath is not null,
                    payment.RejectReason,
                    payment.RefundedAt,
                    payment.RefundNote,
                    payment.RefundSlipPath is not null),
            includeUser ? new UserContact(booking.User.Id, booking.User.Name, booking.User.Phone) : null);
    }

    /// <summary>การจองหนึ่งใบ — ownerId = เจ้าของที่ต้องตรง (null = ไม่ตรวจ เช่นผู้ดูแล)</summary>
    public async Task<BookingResponse> GetByIdAsync(string id, string? ownerId = null)
    {
        var booking = await WithCard(db.Bookings.AsNoTracking().Include(b => b.User)).FirstOrDefaultAsync(b => b.Id == id)
            ?? throw BookingAccess.BookingNotFound();
        if (ownerId is not null && booking.UserId != ownerId) throw BookingAccess.NotBookingOwner();
        return Shape(booking, includeUser: true);
    }

    public async Task<List<BookingResponse>> ListMineAsync(string userId, string? scope)
    {
        var now = time.UtcNowMs();
        var query = db.Bookings.AsNoTracking().Where(b => b.UserId == userId);
        if (scope == "upcoming")
        {
            BookingStatus[] live = [BookingStatus.PENDING_PAYMENT, BookingStatus.PENDING_VERIFICATION, BookingStatus.PAID];
            query = query.Where(b => live.Contains(b.Status) && b.Showtime.StartsAt >= now);
        }
        else if (scope == "history")
        {
            BookingStatus[] closed = [BookingStatus.CANCELLED, BookingStatus.EXPIRED];
            query = query.Where(b => closed.Contains(b.Status) || b.Showtime.StartsAt < now);
        }

        var bookings = await WithCard(query).OrderByDescending(b => b.CreatedAt).ToListAsync();
        return bookings.Select(b => Shape(b)).ToList();
    }

    // ---------- สร้างการจอง ----------

    /// <summary>
    /// นโยบายกักที่นั่ง — การจองที่ยังไม่จ่ายถือที่นั่งไว้ได้ 10 นาที ถ้าไม่จำกัด บัญชีเดียวก็วนจองกักได้ทั้งโรง
    ///
    /// - รอบเดียวกันมีการจองที่ยังรอชำระอยู่แล้ว → ให้ไปจ่ายใบเดิมหรือยกเลิกก่อน
    ///   (ส่วนใหญ่คือกด back จากหน้าชำระเงินมาเลือกใหม่ ที่นั่งชุดเดิมของตัวเองจะค้างอยู่ 10 นาทีโดยไม่รู้ตัว)
    ///   ส่วนใบที่ส่งสลิปแล้ว (รอตรวจ) ไม่นับ — จองเพิ่มให้เพื่อนในรอบเดียวกันได้ตามปกติ
    /// - ถือที่นั่งค้างรวมทุกรอบเกิน MAX_PENDING_BOOKINGS_PER_USER รายการ → ปฏิเสธ
    ///
    /// เช็กก่อนสร้างโดยไม่ได้ล็อก — สองคำขอของคนเดียวกันที่มาพร้อมกันเป๊ะอาจผ่านได้ทั้งคู่
    /// ยอมรับได้เพราะเพดานนี้มีไว้กันการกักแบบวนซ้ำ ไม่ใช่นับให้ตรงทุกเสี้ยววินาที
    /// </summary>
    private async Task AssertCanHoldMoreSeatsAsync(string userId, string showtimeId)
    {
        var now = time.UtcNowMs();
        var holding = await db.Bookings.AsNoTracking()
            .Where(b => b.UserId == userId &&
                ((b.Status == BookingStatus.PENDING_PAYMENT && b.HoldExpiresAt > now) || b.Status == BookingStatus.PENDING_VERIFICATION))
            .Select(b => new { b.Id, b.Status, b.ShowtimeId, b.SeatSnapshot })
            .ToListAsync();

        var unpaidSameShowtime = holding.FirstOrDefault(b => b.Status == BookingStatus.PENDING_PAYMENT && b.ShowtimeId == showtimeId);
        if (unpaidSameShowtime is not null)
        {
            throw ApiException.Conflict(
                "PENDING_BOOKING_EXISTS",
                "คุณมีการจองรอบนี้ที่ยังรอชำระเงินอยู่ กรุณาชำระเงินหรือยกเลิกรายการเดิมก่อนจองใหม่",
                new { bookingId = unpaidSameShowtime.Id, seats = Seats.SeatLabels(unpaidSameShowtime.SeatSnapshot) });
        }

        if (holding.Count >= config.MaxPendingBookingsPerUser)
        {
            throw ApiException.Conflict(
                "TOO_MANY_PENDING_BOOKINGS",
                $"คุณมีการจองที่ยังไม่เสร็จ (รอชำระเงิน/รอตรวจสลิป) อยู่ {holding.Count} รายการ กรุณาจัดการรายการเดิมก่อนจองเพิ่ม",
                new { count = holding.Count, limit = config.MaxPendingBookingsPerUser });
        }
    }

    /// <summary>
    /// สร้างการจอง
    ///
    /// ด่านกันจองซ้ำอยู่ที่ unique (showtimeId, seatId) บนตาราง BookingSeat
    /// ถ้าสองคนกดพร้อมกัน PostgreSQL จะปล่อยให้ transaction เดียวผ่าน อีกอันชน unique
    /// แล้วเราแปลงเป็น 409 พร้อมบอกว่าที่นั่งไหนโดนตัดหน้าไป
    /// </summary>
    public async Task<BookingResponse> CreateAsync(string userId, string showtimeId, IEnumerable<string> seatIds)
    {
        var uniqueSeatIds = seatIds.Distinct().ToList();
        if (uniqueSeatIds.Count == 0) throw ApiException.BadRequest("NO_SEATS", "กรุณาเลือกที่นั่งอย่างน้อย 1 ที่");
        if (uniqueSeatIds.Count > config.MaxSeatsPerBooking)
        {
            throw ApiException.BadRequest("TOO_MANY_SEATS", $"จองได้สูงสุด {config.MaxSeatsPerBooking} ที่นั่งต่อครั้ง");
        }

        var showtime = await db.Showtimes.AsNoTracking().Include(s => s.ZonePrices).FirstOrDefaultAsync(s => s.Id == showtimeId)
            ?? throw ApiException.NotFound("SHOWTIME_NOT_FOUND", "ไม่พบรอบฉายนี้");
        if (showtime.Status != ShowtimeStatus.SCHEDULED) throw ApiException.BadRequest("SHOWTIME_CANCELLED", "รอบฉายนี้ถูกยกเลิกแล้ว");
        if (showtime.StartsAt <= time.UtcNowMs())
        {
            throw ApiException.BadRequest("SHOWTIME_STARTED", "รอบฉายนี้เริ่มไปแล้ว กรุณาเลือกรอบอื่น");
        }

        var seats = await db.Seats.AsNoTracking()
            .Where(s => uniqueSeatIds.Contains(s.Id) && s.TheatreId == showtime.TheatreId && s.IsActive)
            .ToListAsync();
        if (seats.Count != uniqueSeatIds.Count)
        {
            throw ApiException.BadRequest("INVALID_SEATS", "มีที่นั่งบางที่ไม่ถูกต้องสำหรับรอบฉายนี้");
        }

        await AssertCanHoldMoreSeatsAsync(userId, showtimeId);

        var priceMap = Pricing.ToPriceMap(showtime.ZonePrices, showtime.BasePrice);
        var (items, total) = Pricing.PriceSeats(seats, priceMap);
        // บันทึกที่นั่งเรียงตาม id เสมอ — สองคนที่จองชุดที่นั่งซ้อนกันจะชนกันที่ที่นั่งแรกเหมือนกัน
        // แล้วคนที่ช้ากว่าได้ SEAT_TAKEN ตามปกติ ถ้าลำดับสลับกันจะรอกันเองจนเกิด deadlock
        items = items.OrderBy(i => i.SeatId, StringComparer.Ordinal).ToList();
        var seatSnapshot = Seats.SortSeats(seats).Select(seat => Seats.SnapshotSeat(seat, priceMap[seat.Zone])).ToList();

        var booking = new Booking
        {
            Code = Codes.GenerateBookingCode(),
            UserId = userId,
            ShowtimeId = showtimeId,
            Status = BookingStatus.PENDING_PAYMENT,
            TotalAmount = total,
            HoldExpiresAt = time.UtcNowMs().AddMinutes(config.SeatHoldMinutes),
            SeatSnapshot = seatSnapshot,
        };

        try
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            // ล็อกแถวรอบฉายแบบแชร์ไว้จนจบ transaction — ถ้าผู้ดูแลกำลังยกเลิกรอบนี้อยู่ ตรงนี้จะรอจนเขาเสร็จ
            // แล้วเห็นสถานะใหม่ ไม่งั้นการจองที่เข้ามาพอดีจังหวะจะหลุดไปค้างอยู่ในรอบที่ถูกยกเลิกแล้ว
            if (await Locks.LockShowtimeAsync(db, showtimeId) != ShowtimeStatus.SCHEDULED)
            {
                throw ApiException.BadRequest("SHOWTIME_CANCELLED", "รอบฉายนี้ถูกยกเลิกแล้ว");
            }

            db.Bookings.Add(booking);
            await db.SaveChangesAsync();
            // INSERT เดียวทุกที่นั่ง ตามลำดับ seatId ที่เรียงไว้แล้ว — กันจองชนกันเหมือนเดิม
            await Sql.InsertBookingSeatsAsync(db, booking.Id, showtimeId, items);
            db.Payments.Add(new Payment
            {
                BookingId = booking.Id,
                // ใบหลัก (ค่าตั๋วตอนจอง) — booking.Payment อ่านผ่านตัวนี้
                MainBookingId = booking.Id,
                Amount = total,
                QrPayload = PromptPay.CreatePayload(config.PromptPayId, total),
                Reference = Codes.GeneratePaymentReference(),
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        catch (Exception error) when (Locks.IsSeatConflict(error))
        {
            db.ChangeTracker.Clear();
            throw await Locks.SeatTakenErrorAsync(db, showtimeId, uniqueSeatIds);
        }

        db.ChangeTracker.Clear();
        return await GetByIdAsync(booking.Id);
    }

    // ---------- ยกเลิก ----------

    /// <summary>ยกเลิกการจอง — ปล่อยที่นั่งคืนด้วยการลบแถว BookingSeat</summary>
    public async Task<BookingResponse> CancelAsync(
        string bookingId, string? userId, bool byAdmin, string? reason, RefundAccount refundAccount)
    {
        var booking = await db.Bookings.AsNoTracking()
            .Include(b => b.Showtime)
            .Include(b => b.Payment)
            .Include(b => b.SeatChanges.Where(c => SeatChangeRules.OpenStatuses.Contains(c.Status)))
            .FirstOrDefaultAsync(b => b.Id == bookingId) ?? throw BookingAccess.BookingNotFound();
        if (!byAdmin && booking.UserId != userId) throw BookingAccess.NotBookingOwner("ไม่มีสิทธิ์ยกเลิกรายการจองนี้");
        if (booking.Status is BookingStatus.CANCELLED or BookingStatus.EXPIRED)
        {
            throw ApiException.Conflict("ALREADY_CLOSED", "รายการนี้ถูกยกเลิกหรือหมดอายุไปแล้ว");
        }

        // สลิปส่วนต่างเปลี่ยนที่นั่งรอตรวจ — ห้ามยกเลิกทั้งลูกค้าและผู้ดูแล เพราะเงินส่วนต่างอาจเข้ามาแล้วจริง
        // ยกเลิกทับตอนนี้ ยอดคืนเงิน (ยอดสุทธิของการจอง) จะไม่รวมส่วนต่างก้อนนั้น ต้องให้ผู้ดูแลตัดสินสลิปก่อน
        if (HasTopUpAwaitingVerification(booking)) throw SeatChangeAwaitingVerification();

        // ระหว่างที่สลิปอยู่ในคิวตรวจ ห้ามผู้ใช้ยกเลิกเอง ต้องรอผลอนุมัติ/ปฏิเสธก่อน
        // ถ้าปล่อยให้ยกเลิกตรงนี้ ใบชำระเงินจะถูกปิดเป็น REJECTED ทั้งที่อาจโอนเงินมาแล้วจริง
        if (!byAdmin && booking.Status == BookingStatus.PENDING_VERIFICATION)
        {
            throw ApiException.Conflict(
                "AWAITING_VERIFICATION",
                "สลิปกำลังรอผู้ดูแลตรวจสอบ กรุณารอผลอนุมัติหรือปฏิเสธก่อนจึงจะยกเลิกได้");
        }

        var now = time.UtcNowMs();
        if (!byAdmin && booking.Status == BookingStatus.PAID)
        {
            var hoursLeft = (booking.Showtime.StartsAt - now).TotalHours;
            if (hoursLeft < config.CancelCutoffHours)
            {
                throw ApiException.Forbidden(
                    "CANCEL_WINDOW_CLOSED",
                    $"ยกเลิกได้ก่อนรอบฉายอย่างน้อย {config.CancelCutoffHours} ชั่วโมงเท่านั้น",
                    new { cancelCutoffHours = config.CancelCutoffHours, hoursLeft = Math.Max(hoursLeft, 0) });
            }
        }

        // ใบที่จ่ายเงินมาแล้วต้องรู้ปลายทางก่อน ไม่งั้นผู้ดูแลได้แต่คิวคืนเงินที่โอนคืนไม่ได้
        var willRefund = booking.Payment?.Status == PaymentStatus.APPROVED;
        if (willRefund && !byAdmin && !refundAccount.IsComplete)
        {
            throw ApiException.BadRequest("REFUND_ACCOUNT_REQUIRED", "กรุณาระบุธนาคารและเลขที่บัญชีสำหรับรับเงินคืน");
        }

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var cancelReason = reason ?? (byAdmin ? "ยกเลิกโดยผู้ดูแลระบบ" : "ผู้ใช้ยกเลิกเอง");
            // ยกเลิกได้เฉพาะเมื่อสถานะยังเป็นแบบเดียวกับที่ตรวจเงื่อนไขไว้ข้างบน — ถ้าระหว่างนี้ผู้ดูแลเพิ่งอนุมัติสลิป
            // หรือการจองเพิ่งหมดเวลา update จะไม่โดนแถวไหน แล้ว transaction ทั้งก้อนถูกยกเลิก
            // ยอดสุทธิต้องยังเป็นยอดที่ใช้คิดเงินคืนข้างล่างด้วย — ถ้าการเปลี่ยนที่นั่งที่มีส่วนต่างเพิ่งเสร็จไปพอดี ให้ทำรายการใหม่
            var count = await db.Bookings
                .Where(b => b.Id == bookingId && b.Status == booking.Status && b.TotalAmount == booking.TotalAmount)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(b => b.Status, BookingStatus.CANCELLED)
                    .SetProperty(b => b.CancelledAt, now)
                    .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                    .SetProperty(b => b.CancelReason, cancelReason)
                    .SetProperty(b => b.UpdatedAt, now));
            if (count == 0) throw Locks.BookingStateChanged();

            // คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่าง ปิดไปพร้อมการจอง (ที่นั่งที่กันไว้ถูกลบพร้อมที่นั่งของการจองข้างล่าง)
            // ถ้าสถานะคำขอเปลี่ยนไปพอดี (ลูกค้าเพิ่งส่งสลิปส่วนต่าง หรือหมดเวลาพอดี) update จะไม่โดนแถวไหน — ยกเลิกทั้งก้อน
            // ปิดคำขอก่อนลบที่นั่ง ตามลำดับล็อกเดียวกับที่อื่น (Booking → SeatChange → BookingSeat → Payment)
            foreach (var change in booking.SeatChanges)
            {
                var closed = await db.SeatChanges
                    .Where(c => c.Id == change.Id && c.Status == SeatChangeStatus.PENDING_PAYMENT)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, SeatChangeStatus.CANCELLED)
                        .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(c => c.CloseReason, cancelReason)
                        .SetProperty(c => c.UpdatedAt, now));
                if (closed == 0) throw Locks.BookingStateChanged();
            }

            await db.BookingSeats.Where(bs => bs.BookingId == bookingId).ExecuteDeleteAsync();
            // ปิดใบชำระเงินที่ยังรอดำเนินการ ไม่งั้นสลิปจะค้างอยู่ในคิวตรวจของ admin ตลอดไป
            PaymentStatus[] waiting = [PaymentStatus.AWAITING_SLIP, PaymentStatus.PENDING_VERIFICATION];
            await db.Payments
                .Where(p => p.MainBookingId == bookingId && waiting.Contains(p.Status))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                    .SetProperty(p => p.RejectReason, cancelReason)
                    .SetProperty(p => p.UpdatedAt, now));
            // ส่วนต่างของคำขอที่เพิ่งปิด (ยังไม่ได้ส่งสลิป) — ไม่ต้องรอใครโอนแล้ว
            if (booking.SeatChanges.Count > 0)
            {
                var changeIds = booking.SeatChanges.Select(c => c.Id).ToList();
                await db.Payments
                    .Where(p => p.SeatChangeId != null && changeIds.Contains(p.SeatChangeId) && p.Status == PaymentStatus.AWAITING_SLIP)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                        .SetProperty(p => p.RejectReason, cancelReason)
                        .SetProperty(p => p.UpdatedAt, now));
            }

            // ใบที่จ่ายเงินมาแล้วจริง ต้องเข้าคิวรอผู้ดูแลโอนเงินคืน
            // ระบบไม่ได้ตัดเงินเอง จึงคืนเองไม่ได้ หน้าที่ของระบบคือไม่ปล่อยให้ลืม
            // คืนเป็นยอดสุทธิของการจองในรายการเดียว — การจองที่เคยเปลี่ยนที่นั่ง ยอดนี้รวมส่วนต่างที่โอนเพิ่มแล้ว
            // และหักส่วนต่างที่คืนไปแล้ว ผู้ดูแลจึงโอนครั้งเดียวจบ ไม่ต้องไล่รวมเองจากหลายรายการ
            await db.Payments
                .Where(p => p.MainBookingId == bookingId && p.Status == PaymentStatus.APPROVED)
                .ExecuteUpdateAsync(s =>
                {
                    s.SetProperty(p => p.Status, PaymentStatus.REFUND_PENDING)
                        .SetProperty(p => p.RefundDueAt, now)
                        .SetProperty(p => p.RefundAmount, booking.TotalAmount)
                        .SetProperty(p => p.UpdatedAt, now);
                    if (refundAccount.BankName is { } bankName) s.SetProperty(p => p.RefundBankName, bankName);
                    if (refundAccount.AccountNo is { } accountNo) s.SetProperty(p => p.RefundAccountNo, accountNo);
                    if (refundAccount.AccountName is { } accountName) s.SetProperty(p => p.RefundAccountName, accountName);
                });
            await NotificationService.NotifyAsync(
                db, booking.UserId, NotificationType.BOOKING_CANCELLED,
                new NotificationContext { Code = booking.Code },
                NotificationTemplates.Data(("bookingId", bookingId)));
            await tx.CommitAsync();
        }

        return await GetByIdAsync(bookingId);
    }

    /// <summary>
    /// ลูกค้าแจ้ง (หรือแก้) บัญชีรับเงินคืนเอง ใช้ได้ตลอดที่ใบนั้นยังรอโอนคืนอยู่
    ///
    /// ใบที่ผู้ดูแลยกเลิกแทน — ยกเลิกทั้งรอบ หรือลูกค้าโทรมาให้ยกเลิก — ไม่มีบัญชีติดมาด้วย
    /// ถ้าไม่มีช่องให้ลูกค้ากรอกเอง ผู้ดูแลต้องไล่โทรถามทีละคน ซึ่งยกเลิกทั้งรอบทีอาจเป็นร้อยสาย
    /// </summary>
    public async Task<BookingResponse> UpdateRefundAccountAsync(
        string bookingId, string userId, string bankName, string accountNo, string? accountName)
    {
        var ownerId = await db.Bookings.Where(b => b.Id == bookingId).Select(b => b.UserId).FirstOrDefaultAsync()
            ?? throw BookingAccess.BookingNotFound();
        if (ownerId != userId) throw BookingAccess.NotBookingOwner("ไม่มีสิทธิ์แก้ไขรายการจองนี้");

        // เงื่อนไขสถานะอยู่ใน where เลย — ถ้าผู้ดูแลเพิ่งกดว่าโอนคืนแล้ว บัญชีที่ใช้โอนไปต้องไม่ถูกเขียนทับ
        // ชื่อบัญชีเขียนทับเสมอ (ไม่ส่งมา = null) — เปลี่ยนบัญชีแล้วชื่อของบัญชีเดิมอาจไม่ตรงกับบัญชีใหม่
        var now = time.UtcNowMs();
        var name = string.IsNullOrWhiteSpace(accountName) ? null : accountName.Trim();
        var count = await db.Payments
            .Where(p => p.BookingId == bookingId && p.Status == PaymentStatus.REFUND_PENDING)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.RefundBankName, bankName.Trim())
                .SetProperty(p => p.RefundAccountNo, accountNo)
                .SetProperty(p => p.RefundAccountName, name)
                .SetProperty(p => p.UpdatedAt, now));
        if (count == 0)
        {
            throw ApiException.Conflict("REFUND_NOT_PENDING", "รายการนี้ไม่ได้รอคืนเงินอยู่แล้ว จึงแก้บัญชีรับเงินคืนไม่ได้");
        }

        return await GetByIdAsync(bookingId, userId);
    }

    // ---------- หมดเวลาชำระ ----------

    /// <summary>
    /// ปิดการจองหนึ่งใบที่หมดเวลาชำระเงิน — คืน true ถ้าปิดจริง
    ///
    /// เงื่อนไข "ยังรอชำระ + เลยเวลาแล้ว" อยู่ใน where ของคำสั่ง update เลย ไม่ได้อาศัยข้อมูลที่อ่านไว้ก่อน
    /// ถ้าลูกค้าส่งสลิปเข้ามาในจังหวะเดียวกัน (สถานะกลายเป็นรอตรวจแล้ว) update จะไม่โดนแถวไหน
    /// แล้วเราก็ไม่แตะอะไรต่อ — เดิม job เขียนทับเป็น EXPIRED ได้ทั้งที่สลิปเข้าคิวไปแล้ว
    /// ผลคือที่นั่งถูกปล่อย และสลิปหายจากคิวตรวจ (เงินที่โอนมาไม่มีใครเห็น)
    /// </summary>
    public async Task<bool> ExpireAsync(string id, string code, string userId, DateTime now)
    {
        const string reason = "หมดเวลาชำระเงิน";
        await using var tx = await db.Database.BeginTransactionAsync();
        var count = await db.Bookings
            .Where(b => b.Id == id && b.Status == BookingStatus.PENDING_PAYMENT && b.HoldExpiresAt < now)
            .ExecuteUpdateAsync(s => s
                .SetProperty(b => b.Status, BookingStatus.EXPIRED)
                .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                // หมดเวลาแล้วจบ — ส่งสลิปไม่ได้อีก · expiredAt เก็บไว้เป็นประวัติ
                .SetProperty(b => b.ExpiredAt, now)
                .SetProperty(b => b.CancelReason, reason)
                .SetProperty(b => b.UpdatedAt, now));
        if (count == 0) return false;

        await db.BookingSeats.Where(bs => bs.BookingId == id).ExecuteDeleteAsync();
        await db.Payments
            .Where(p => p.BookingId == id && p.Status == PaymentStatus.AWAITING_SLIP)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                .SetProperty(p => p.RejectReason, reason)
                .SetProperty(p => p.UpdatedAt, now));
        await NotificationService.NotifyAsync(
            db, userId, NotificationType.BOOKING_EXPIRED,
            new NotificationContext { Code = code },
            NotificationTemplates.Data(("bookingId", id)));
        await tx.CommitAsync();
        return true;
    }

    /// <summary>
    /// ปล่อยที่นั่งของการจองที่หมดเวลาชำระเงิน — เรียกจากงานเบื้องหลัง
    /// นับเฉพาะ PENDING_PAYMENT เท่านั้น การจองที่รอ admin ตรวจสลิปมี holdExpiresAt = null จึงไม่โดน
    /// </summary>
    public async Task<int> ReleaseExpiredHoldsAsync()
    {
        var now = time.UtcNowMs();
        var candidates = await db.Bookings.AsNoTracking()
            .Where(b => b.Status == BookingStatus.PENDING_PAYMENT && b.HoldExpiresAt < now)
            .Select(b => new { b.Id, b.Code, b.UserId })
            .ToListAsync();

        var released = 0;
        foreach (var booking in candidates)
        {
            if (await ExpireAsync(booking.Id, booking.Code, booking.UserId, now)) released += 1;
        }
        return released;
    }

    /// <summary>ข้อมูลสำหรับ E-Ticket — ออกให้เฉพาะรายการที่ชำระเงินแล้ว (เจ้าของการจองเท่านั้น)</summary>
    public async Task<BookingResponse> GetTicketAsync(string bookingId, string userId)
    {
        var booking = await GetByIdAsync(bookingId, userId);
        if (booking.Status != BookingStatus.PAID)
        {
            throw ApiException.Forbidden("TICKET_NOT_READY", "ตั๋วจะออกให้หลังการชำระเงินได้รับการยืนยันแล้ว");
        }
        return booking with { TicketQr = booking.Code };
    }

    // ---------- ฝั่ง Admin ----------

    /// <summary>สลิปที่ยังรอผู้ดูแลตัดสินในรอบนี้ — ค่าตั๋วที่รอตรวจ และส่วนต่างเปลี่ยนที่นั่งที่รอตรวจ (ที่นั่งใหม่ถูกกันไว้อยู่)</summary>
    private async Task<int> CountPendingSlipsAsync(string showtimeId)
    {
        var bookings = await db.Bookings.CountAsync(b => b.ShowtimeId == showtimeId && b.Status == BookingStatus.PENDING_VERIFICATION);
        var topUps = await db.SeatChanges.CountAsync(c =>
            c.Status == SeatChangeStatus.PENDING_VERIFICATION && c.Booking.ShowtimeId == showtimeId);
        return bookings + topUps;
    }

    private static ApiException PendingSlipsError(int count) =>
        ApiException.Conflict(
            "SHOWTIME_HAS_PENDING_SLIPS",
            $"รอบนี้มีสลิปรอตรวจ {count} รายการ กรุณาอนุมัติหรือปฏิเสธให้เสร็จก่อนจึงจะยกเลิกรอบได้",
            new { count });

    public sealed record CancelShowtimeResult(ShowtimeResponse Showtime, int CancelledBookings, int RefundsQueued);

    /// <summary>
    /// ยกเลิกทั้งรอบ (เครื่องฉายเสีย โรงปิดซ่อม ฯลฯ) — ปิดทุกการจองของรอบนี้ในคราวเดียว
    ///
    /// ใบที่จ่ายแล้วเข้าคิวคืนเงินเหมือนตอนลูกค้ายกเลิกเอง ใบที่ยังไม่จ่ายถูกปิดและคืนที่นั่ง
    /// ส่วนสลิปที่ยังรอตรวจต้องให้ผู้ดูแลตัดสินก่อน เพราะยังไม่รู้ว่าเงินเข้าจริงไหม
    /// ถ้ายกเลิกทับไปเลย ใบนั้นจะไม่มีทางไปต่อ — จะคืนเงินก็ไม่รู้ว่ามีเงินให้คืนหรือเปล่า
    ///
    /// ทำทั้งหมดใน transaction เดียวด้วยคำสั่งแบบกลุ่ม จำนวน query จึงคงที่ไม่ว่ารอบนั้นจะมีกี่การจอง
    /// </summary>
    public async Task<CancelShowtimeResult> CancelShowtimeAsync(string showtimeId, string? reason, ShowtimeService showtimes)
    {
        var showtime = await db.Showtimes.AsNoTracking().Include(s => s.Movie).FirstOrDefaultAsync(s => s.Id == showtimeId)
            ?? throw ApiException.NotFound("SHOWTIME_NOT_FOUND", "ไม่พบรอบฉายนี้");
        if (showtime.Status == ShowtimeStatus.CANCELLED)
        {
            throw ApiException.Conflict("SHOWTIME_ALREADY_CANCELLED", "รอบนี้ถูกยกเลิกไปแล้ว");
        }
        if (showtime.EndsAt <= time.UtcNowMs())
        {
            throw ApiException.Conflict("SHOWTIME_ENDED", "รอบนี้ฉายจบไปแล้ว ยกเลิกย้อนหลังไม่ได้");
        }

        var pendingSlips = await CountPendingSlipsAsync(showtimeId);
        if (pendingSlips > 0) throw PendingSlipsError(pendingSlips);

        var note = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        var cancelReason = note is not null ? $"รอบฉายถูกยกเลิก: {note}" : "รอบฉายถูกยกเลิก";
        var context = new NotificationContext
        {
            MovieTh = showtime.Movie.TitleTh,
            MovieEn = showtime.Movie.TitleEn,
            WhenTh = BangkokTime.FormatShort(showtime.StartsAt, "th"),
            WhenEn = BangkokTime.FormatShort(showtime.StartsAt, "en"),
            Reason = note,
        };

        int cancelledBookings;
        int refundsQueued;
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var now = time.UtcNowMs();
            // เปลี่ยนสถานะรอบก่อน — การจองใหม่ที่กำลังเข้ามาจะรอล็อกแถวนี้ แล้วเห็นว่ารอบถูกยกเลิก
            var closed = await db.Showtimes
                .Where(s => s.Id == showtimeId && s.Status == ShowtimeStatus.SCHEDULED)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, ShowtimeStatus.CANCELLED).SetProperty(x => x.UpdatedAt, now));
            if (closed == 0) throw ApiException.Conflict("SHOWTIME_ALREADY_CANCELLED", "รอบนี้ถูกยกเลิกไปแล้ว");

            BookingStatus[] open = [BookingStatus.PENDING_PAYMENT, BookingStatus.PAID];
            var bookings = await db.Bookings.AsNoTracking()
                .Where(b => b.ShowtimeId == showtimeId && open.Contains(b.Status))
                .Select(b => new { b.Id, b.Code, b.UserId, b.Status })
                .ToListAsync();
            var ids = bookings.Select(b => b.Id).ToList();

            if (ids.Count > 0)
            {
                var updated = await db.Bookings
                    .Where(b => ids.Contains(b.Id) && open.Contains(b.Status))
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(b => b.Status, BookingStatus.CANCELLED)
                        .SetProperty(b => b.CancelledAt, now)
                        .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(b => b.CancelReason, cancelReason)
                        .SetProperty(b => b.UpdatedAt, now));
                // มีใบไหนเปลี่ยนสถานะไประหว่างทาง (ส่งสลิปพอดี หมดเวลาพอดี) — ยกเลิกทั้งชุด ให้ผู้ดูแลกดใหม่
                if (updated != ids.Count) throw Locks.BookingStateChanged();

                // คำขอเปลี่ยนที่นั่งที่ยังรอโอนส่วนต่างปิดไปด้วย (ที่นั่งที่กันไว้ถูกลบพร้อมที่นั่งของการจองข้างล่าง)
                await db.SeatChanges
                    .Where(c => ids.Contains(c.BookingId) && c.Status == SeatChangeStatus.PENDING_PAYMENT)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, SeatChangeStatus.CANCELLED)
                        .SetProperty(c => c.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(c => c.CloseReason, cancelReason)
                        .SetProperty(c => c.UpdatedAt, now));
            }

            // สลิปที่ส่งเข้ามาหลังเช็กรอบแรก (รวมสลิปส่วนต่างเปลี่ยนที่นั่ง) — ต้องให้ผู้ดูแลตรวจก่อนเหมือนกัน
            var slipsArrived = await CountPendingSlipsAsync(showtimeId);
            if (slipsArrived > 0) throw PendingSlipsError(slipsArrived);

            if (ids.Count == 0)
            {
                cancelledBookings = 0;
                refundsQueued = 0;
            }
            else
            {
                await db.BookingSeats.Where(bs => ids.Contains(bs.BookingId)).ExecuteDeleteAsync();
                PaymentStatus[] dead = [PaymentStatus.AWAITING_SLIP, PaymentStatus.REJECTED];
                await db.Payments
                    .Where(p => ids.Contains(p.BookingId) && dead.Contains(p.Status))
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(p => p.Status, PaymentStatus.REJECTED)
                        .SetProperty(p => p.RejectReason, cancelReason)
                        .SetProperty(p => p.UpdatedAt, now));
                // ไม่มีบัญชีปลายทางติดมา ลูกค้าแจ้งเองได้ที่หน้าการจองของฉัน (UpdateRefundAccountAsync)
                var refunds = await db.Payments
                    .Where(p => p.MainBookingId != null && ids.Contains(p.MainBookingId) && p.Status == PaymentStatus.APPROVED)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(p => p.Status, PaymentStatus.REFUND_PENDING)
                        .SetProperty(p => p.RefundDueAt, now)
                        .SetProperty(p => p.UpdatedAt, now));
                // คืนเป็นยอดสุทธิของแต่ละการจองแบบเดียวกับการยกเลิกทีละใบ — ยอดไม่เท่ากันทุกใบ คำสั่งกลุ่มตั้งได้แค่ค่าเดียว
                // จึงคัดลอกจาก Booking ด้วย SQL ตรงอีกคำสั่ง (ยังเป็นจำนวน query คงที่ ไม่ว่ารอบนั้นจะมีกี่การจอง)
                if (refunds > 0)
                {
                    await Sql.ExecuteAsync(
                        db,
                        """
                        UPDATE "Payment" p SET "refundAmount" = b."totalAmount"
                        FROM "Booking" b
                        WHERE p."mainBookingId" = b."id" AND b."id" = ANY(@ids)
                          AND p."status" = 'REFUND_PENDING' AND p."refundAmount" IS NULL
                        """,
                        Sql.P("ids", ids.ToArray()));
                }
                db.Notifications.AddRange(bookings.Select(b => NotificationTemplates.Create(
                    b.UserId,
                    NotificationType.SHOWTIME_CANCELLED,
                    context with { Code = b.Code, Refund = b.Status == BookingStatus.PAID },
                    NotificationTemplates.Data(("bookingId", b.Id), ("showtimeId", showtimeId)))));
                await db.SaveChangesAsync();
                cancelledBookings = ids.Count;
                refundsQueued = refunds;
            }
            await tx.CommitAsync();
        }

        return new CancelShowtimeResult(await showtimes.GetByIdAsync(showtimeId), cancelledBookings, refundsQueued);
    }

    /// <summary>
    /// รายการการจองทั้งหมดของผู้ดูแล — status กรองตามสถานะการจอง (แบบเดิม)
    /// displayStatuses กรองตามป้ายในหน้าการจอง: ตรงป้ายใดป้ายหนึ่งก็ผ่าน
    /// เงื่อนไขทุกตัวต่อกันด้วย AND — OR ของคำค้นจะได้ไม่ไปทับ OR/NOT ที่อยู่ในเงื่อนไขของ displayStatus
    /// </summary>
    public async Task<PageResult<BookingResponse>> ListAllAsync(
        BookingStatus? status, List<string>? displayStatuses, string? date, string? q, int? page, int? pageSize)
    {
        var query = db.Bookings.AsNoTracking();
        if (status is not null) query = query.Where(b => b.Status == status);
        if (displayStatuses is { Count: > 0 }) query = query.Where(BookingDisplayStatus.AnyWhere(displayStatuses));
        if (date is not null && BangkokTime.DayRange(date) is { } range)
        {
            query = query.Where(b => b.Showtime.StartsAt >= range.Start && b.Showtime.StartsAt < range.End);
        }
        if (!string.IsNullOrEmpty(q))
        {
            var pattern = Like.Contains(q);
            // ลูกค้าที่ติดต่อมาเรื่องเงินมักอ้างเลขบนใบเสร็จ ไม่ใช่รหัสการจอง (รวมใบเสร็จส่วนต่างเปลี่ยนที่นั่ง)
            query = query.Where(b =>
                EF.Functions.ILike(b.Code, pattern, Like.Escape) ||
                b.Payments.Any(p => p.ReceiptNo != null && EF.Functions.ILike(p.ReceiptNo, pattern, Like.Escape)) ||
                b.User.Phone.Contains(q) ||
                EF.Functions.ILike(b.User.Name, pattern, Like.Escape));
        }

        var paged = await Pagination.FindPageAsync(
            query,
            // id ต่อท้ายให้ลำดับคงที่ — แถวที่สร้างพร้อมกันจะไม่สลับไปมาจนโผล่ซ้ำ/หายระหว่างหน้า
            filtered => WithCard(filtered.Include(b => b.User)).OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id),
            page,
            pageSize);
        // ป้ายคิดจากแถวที่โหลดมาแล้ว (มีรายการเงินและคำขอเปลี่ยนที่นั่งครบ) ไม่ต้อง query เพิ่ม
        var items = paged.Rows
            .Select(row => Shape(row, includeUser: true) with { DisplayStatus = BookingDisplayStatus.Of(row) })
            .ToList();
        return new PageResult<BookingResponse>(items, paged.Total, paged.Page, paged.PageSize);
    }
}
