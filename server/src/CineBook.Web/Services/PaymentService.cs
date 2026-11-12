using System.Linq.Expressions;
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

/// <summary>หน้าชำระเงิน สลิป คิวตรวจสลิป และคิวคืนเงิน (port จาก services/payments.js)</summary>
public sealed class PaymentService(
    AppDbContext db,
    AppConfig config,
    TimeProvider time,
    BookingService bookings,
    SeatChangeService seatChanges,
    SlipService slips,
    ReceiptService receipts,
    ISlipStorage storage)
{
    /// <summary>
    /// สลิปที่รอผู้ดูแลตรวจ — ใช้ชุดเดียวกันทั้งคิวตรวจสลิป ป้ายตัวเลขบนเมนู และหน้าภาพรวม
    /// ทั้งค่าตั๋วและส่วนต่างเปลี่ยนที่นั่ง โดยการจอง/คำขอเจ้าของสลิปต้องรอตรวจอยู่ด้วย
    /// </summary>
    public static readonly Expression<Func<Payment, bool>> PendingSlip = p =>
        p.Status == PaymentStatus.PENDING_VERIFICATION &&
        ((p.Kind == PaymentKind.BOOKING && p.Booking.Status == BookingStatus.PENDING_VERIFICATION) ||
            (p.Kind == PaymentKind.SEAT_CHANGE_TOPUP && p.SeatChange != null && p.SeatChange.Status == SeatChangeStatus.PENDING_VERIFICATION));

    /// <summary>ข้อมูลหน้าชำระเงินของผู้ใช้ (รวม payload สำหรับ render QR ฝั่ง client)</summary>
    public async Task<PaymentPageResponse> GetForBookingAsync(string bookingId, string userId)
    {
        var booking = await db.Bookings.AsNoTracking().Include(b => b.Payment).FirstOrDefaultAsync(b => b.Id == bookingId)
            ?? throw BookingAccess.BookingNotFound();
        if (booking.UserId != userId) throw BookingAccess.NotBookingOwner();
        var payment = booking.Payment ?? throw ApiException.NotFound("PAYMENT_NOT_FOUND", "ไม่พบข้อมูลการชำระเงิน");

        return new PaymentPageResponse(
            booking.Id,
            booking.Code,
            booking.Status,
            payment.Amount,
            payment.Reference,
            payment.QrPayload,
            config.PromptPayId,
            config.PromptPayMerchantName,
            payment.Status,
            payment.SlipUploadedAt,
            payment.SlipPath is not null,
            payment.RejectReason,
            booking.HoldExpiresAt,
            SlipService.HoldSecondsLeft(booking.HoldExpiresAt, time.UtcNowMs()),
            SlipService.CanUploadSlip(booking.Status));
    }

    private static ApiException NotPayable() =>
        ApiException.Conflict("BOOKING_NOT_PAYABLE", "รายการนี้ไม่อยู่ในสถานะที่ชำระเงินได้แล้ว");

    private Task<Booking?> LoadForSlipAsync(string bookingId) =>
        db.Bookings.AsNoTracking().Include(b => b.Payment).FirstOrDefaultAsync(b => b.Id == bookingId);

    /// <summary>
    /// ผู้ใช้ส่งสลิป — หยุดนับถอยหลังระหว่างรอ admin ตรวจ ที่นั่งถูกยึดไว้จนกว่าจะรู้ผล (ดู QueueSlipForReviewAsync)
    /// หมดเวลาแล้วส่งไม่ได้ (409 HOLD_EXPIRED) และลบไฟล์ทิ้งเมื่อทำรายการไม่สำเร็จ
    /// </summary>
    public async Task<PaymentPageResponse> UploadSlipAsync(string bookingId, string userId, StoredSlip? file)
    {
        if (file is null) throw ApiException.BadRequest("NO_FILE", "กรุณาแนบรูปสลิปการโอนเงิน");

        var previousSlip = await slips.DiscardSlipOnErrorAsync(file, async () =>
        {
            var booking = await LoadForSlipAsync(bookingId);
            if (booking?.Payment is null) throw BookingAccess.BookingNotFound();
            if (booking.UserId != userId) throw BookingAccess.NotBookingOwner();
            var now = time.UtcNowMs();
            await slips.QueueSlipForReviewAsync(
                new SlipService.HolderState(booking.Status.ToString(), booking.Payment.Status),
                SlipService.CanUploadSlip(booking.Status),
                () => db.Bookings
                    .Where(b => b.Id == booking.Id && b.Status == BookingStatus.PENDING_PAYMENT)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(b => b.Status, BookingStatus.PENDING_VERIFICATION)
                        .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(b => b.UpdatedAt, now)),
                booking.Payment.Id,
                file.FileName,
                async () =>
                {
                    var current = await LoadForSlipAsync(bookingId);
                    return new SlipService.HolderState(current?.Status.ToString() ?? "", current?.Payment?.Status);
                },
                NotPayable,
                "BOOKING_NOT_PAYABLE",
                booking.Code);
            return booking.Payment.SlipPath;
        });

        // ลบสลิปเก่าทิ้ง (กรณีส่งใหม่หลังถูกปฏิเสธ) หลังบันทึกสำเร็จแล้วเท่านั้น
        if (previousSlip is not null && previousSlip != file.FileName) await storage.RemoveAsync(SlipKind.Payment, previousSlip);

        return await GetForBookingAsync(bookingId, userId);
    }

    /// <summary>
    /// ชื่อไฟล์สลิปของรายการเงินในการจองนี้ — เฉพาะเจ้าของการจองหรือ admin
    /// (สลิปไม่ได้เปิดเป็น static file แต่ controller ส่งให้ผ่านที่เก็บสลิป)
    ///
    /// paymentId ไม่ระบุ = ใบหลัก (ค่าตั๋วตอนจอง) · ระบุ = รายการส่วนต่างเปลี่ยนที่นั่ง ต้องเป็นของการจองนี้เท่านั้น
    /// สิทธิ์จึงตรวจจากเจ้าของการจองเหมือนเดิม · ยังไม่มีสลิปตอบ 404 ก่อนดูว่าผู้ขอเป็นใคร
    /// </summary>
    private async Task<string> SlipFileNameAsync(
        string bookingId, string? paymentId, CurrentUser requester, Func<Payment, string?> field, Func<ApiException> notFound)
    {
        var booking = await db.Bookings.AsNoTracking().Include(b => b.Payment).FirstOrDefaultAsync(b => b.Id == bookingId);
        var payment = booking is not null && paymentId is not null
            ? await db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.Id == paymentId && p.BookingId == bookingId)
            : booking?.Payment;
        var fileName = payment is null ? null : field(payment);
        if (fileName is null) throw notFound();
        if (!BookingAccess.CanAccessBooking(requester, booking!.UserId))
        {
            throw BookingAccess.NotBookingOwner("ไม่มีสิทธิ์ดูสลิปของรายการนี้");
        }
        return fileName;
    }

    /// <summary>ชื่อไฟล์สลิปโอนเงิน — paymentId = สลิปส่วนต่างเปลี่ยนที่นั่ง</summary>
    public Task<string> GetSlipFileNameAsync(string bookingId, string? paymentId, CurrentUser requester) =>
        SlipFileNameAsync(bookingId, paymentId, requester, p => p.SlipPath,
            () => ApiException.NotFound("SLIP_NOT_FOUND", "ยังไม่มีสลิปสำหรับรายการนี้"));

    /// <summary>ชื่อไฟล์สลิปคืนเงิน — เจ้าของการจองหรือ admin เท่านั้น (paymentId = คืนส่วนต่างเปลี่ยนที่นั่ง)</summary>
    public Task<string> GetRefundSlipFileNameAsync(string bookingId, string? paymentId, CurrentUser requester) =>
        SlipFileNameAsync(bookingId, paymentId, requester, p => p.RefundSlipPath,
            () => ApiException.NotFound("REFUND_SLIP_NOT_FOUND", "ยังไม่มีสลิปคืนเงินสำหรับรายการนี้"));

    // ---------- ฝั่ง Admin ----------

    /// <summary>คิวสลิป/คิวคืนเงินโหลดการจองคู่กับรายการเงิน — ชื่อผู้จอง เบอร์ติดต่อ และรอบที่จอง</summary>
    private static IQueryable<Payment> WithQueueBooking(IQueryable<Payment> payments) =>
        payments
            .Include(p => p.Booking).ThenInclude(b => b.User)
            .Include(p => p.Booking).ThenInclude(b => b.Showtime).ThenInclude(s => s.Movie)
            .Include(p => p.Booking).ThenInclude(b => b.Showtime).ThenInclude(s => s.Theatre)
            .Include(p => p.SeatChange);

    private static UserContact Contact(User user) => new(user.Id, user.Name, user.Phone);

    private static QueueShowtime QueueShowtime(Showtime showtime) =>
        new(showtime.Id, showtime.StartsAt,
            new QueueMovie(showtime.Movie.TitleTh, showtime.Movie.TitleEn, showtime.Movie.PosterUrl),
            new QueueTheatre(showtime.Theatre.Name));

    public async Task<PageResult<PaymentQueueItem>> ListAsync(string? status, string? sort, int? page, int? pageSize)
    {
        // คิวที่กดอนุมัติ/ปฏิเสธได้ = PendingSlip — กันสลิปค้างคิวกรณีการจองถูกยกเลิกไปแล้ว (ซึ่ง admin กดอะไรไม่ได้)
        var query = db.Payments.AsNoTracking();
        status ??= "PENDING_VERIFICATION";
        if (status == "PENDING_VERIFICATION") query = query.Where(PendingSlip);
        else if (status != "ALL")
        {
            var value = Enum.Parse<PaymentStatus>(status);
            query = query.Where(p => p.Status == value);
        }
        // ค่าเริ่มต้นเก่าสุดขึ้นก่อน (ใครส่งก่อนได้ตรวจก่อน) · newest ให้ผู้ดูแลดูใบที่เพิ่งเข้ามา
        // id ต่อท้ายทิศเดียวกัน ให้ลำดับคงที่ระหว่างหน้าแม้ส่งสลิปเวลาเดียวกัน
        var newest = sort == "newest";
        var paged = await Pagination.FindPageAsync(
            query,
            filtered => WithQueueBooking(filtered.Include(p => p.VerifiedBy))
                .OrderBy(p => p.SlipUploadedAt, newest).ThenBy(p => p.Id, newest),
            page,
            pageSize);

        var items = paged.Rows.Select(p => new PaymentQueueItem(
            p.Id,
            p.Kind,
            SeatChangeRules.Summary(p.SeatChange),
            p.Status,
            p.Amount,
            p.Reference,
            p.SlipUploadedAt,
            p.SlipPath is not null,
            p.RejectReason,
            p.VerifiedAt,
            p.VerifiedBy is null ? null : new PersonRef(p.VerifiedBy.Id, p.VerifiedBy.Name),
            new PaymentQueueBooking(
                p.Booking.Id,
                p.Booking.Code,
                p.Booking.Status,
                p.Booking.TotalAmount,
                p.Booking.SeatSnapshot,
                Contact(p.Booking.User),
                QueueShowtime(p.Booking.Showtime),
                p.Booking.CreatedAt))).ToList();
        return new PageResult<PaymentQueueItem>(items, paged.Total, paged.Page, paged.PageSize);
    }

    /// <summary>
    /// ย้ายทั้งใบชำระเงินและการจองออกจาก "รอตรวจ" พร้อมกัน — ทั้งคู่ต้องยังอยู่ในสถานะที่คาดไว้ตอนเขียน
    /// ไม่งั้นทั้ง transaction ถูกยกเลิก (เช่น ผู้ดูแลสองคนกดพร้อมกัน หรือมีคนกดยกเลิกการจองไปก่อนเสี้ยววินาที)
    ///
    /// ลำดับสำคัญ: ล็อกแถว booking ก่อน payment เสมอ ให้ตรงกับการยกเลิก/ส่งสลิป/หมดเวลา
    /// ถ้าล็อกสลับลำดับกัน สองรายการที่ชนกันจะรอกันเองจนเกิด deadlock แล้วฝั่งหนึ่งได้ 500 แทน 409
    /// </summary>
    private async Task SettleAsync(
        Payment payment,
        Func<IQueryable<Booking>, Task<int>> moveBooking,
        Func<IQueryable<Payment>, Task<int>> movePayment)
    {
        var bookingMoved = await moveBooking(db.Bookings.Where(b => b.Id == payment.BookingId && b.Status == BookingStatus.PENDING_VERIFICATION));
        var paymentMoved = await movePayment(db.Payments.Where(p => p.Id == payment.Id && p.Status == PaymentStatus.PENDING_VERIFICATION));
        if (paymentMoved == 0 || bookingMoved == 0) throw Locks.PaymentNotPending();
    }

    private async Task<Payment> LoadPendingAsync(string paymentId)
    {
        var payment = await db.Payments.AsNoTracking()
            .Include(p => p.Booking).ThenInclude(b => b.Showtime)
            // ชื่อผู้จ่ายและที่นั่งที่จะพิมพ์ลงใบเสร็จตอนอนุมัติ
            .Include(p => p.Booking).ThenInclude(b => b.User)
            // สลิปส่วนต่างเปลี่ยนที่นั่ง — อนุมัติแล้วต้องรู้ว่าย้ายจากไหนไปไหน
            .Include(p => p.SeatChange)
            .FirstOrDefaultAsync(p => p.Id == paymentId) ?? throw ApiException.NotFound("PAYMENT_NOT_FOUND", "ไม่พบรายการชำระเงินนี้");
        if (payment.Status != PaymentStatus.PENDING_VERIFICATION)
        {
            throw ApiException.Conflict("PAYMENT_NOT_PENDING", "รายการนี้ถูกตรวจสอบไปแล้ว");
        }
        // ส่วนต่างเปลี่ยนที่นั่งดูสถานะของคำขอ ไม่ใช่ของการจอง (การจองเป็น PAID ตลอดระหว่างนั้น)
        var live = payment.Kind == PaymentKind.SEAT_CHANGE_TOPUP
            ? payment.SeatChange?.Status.ToString()
            : payment.Booking.Status.ToString();
        if (live != "PENDING_VERIFICATION")
        {
            throw ApiException.Conflict("BOOKING_NOT_PENDING", "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอ");
        }
        return payment;
    }

    /// <summary>อนุมัติสลิป → ออกตั๋ว + ใบเสร็จรับเงิน (และส่งใบเสร็จทางอีเมล)</summary>
    public async Task<BookingResponse> ApproveAsync(string paymentId, string adminId)
    {
        var payment = await LoadPendingAsync(paymentId);
        // ส่วนต่างเปลี่ยนที่นั่งใช้คิวและปุ่มเดียวกัน แต่อนุมัติแล้วต้องย้ายที่นั่งจริง — มีขั้นตอนของตัวเอง
        if (payment.Kind == PaymentKind.SEAT_CHANGE_TOPUP) return await seatChanges.ApproveTopUpAsync(payment, adminId);

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var now = time.UtcNowMs();
            await SettleAsync(
                payment,
                q => q.ExecuteUpdateAsync(s => s
                    .SetProperty(b => b.Status, BookingStatus.PAID)
                    .SetProperty(b => b.PaidAt, now)
                    .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                    .SetProperty(b => b.UpdatedAt, now)),
                q => q.ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Status, PaymentStatus.APPROVED)
                    .SetProperty(p => p.VerifiedById, adminId)
                    .SetProperty(p => p.VerifiedAt, now)
                    .SetProperty(p => p.RejectReason, (string?)null)
                    .SetProperty(p => p.UpdatedAt, now)));
            // ออกเลขหลังผ่านด่านเช็กสถานะแล้วเท่านั้น — ผู้ดูแลอีกคนที่กดใบเดียวกันพร้อมกันตกไปก่อนถึงตรงนี้ จึงไม่เปลืองเลข
            // ลำดับล็อก Booking → Payment → ReceiptCounter (แถว payment ถูกล็อกไว้แล้วตั้งแต่ SettleAsync)
            var receiptNo = await ReceiptService.IssueReceiptNoAsync(db, now);
            // ตรึงชื่อและที่นั่งไว้กับใบเสร็จ — แก้ชื่อหรือเปลี่ยนที่นั่งทีหลัง ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม
            var payerName = payment.Booking.User.Name;
            var seats = payment.Booking.SeatSnapshot;
            await db.Payments.Where(p => p.Id == payment.Id).ExecuteUpdateAsync(s => s
                .SetProperty(p => p.ReceiptNo, receiptNo)
                .SetProperty(p => p.ReceiptName, payerName)
                .SetProperty(p => p.ReceiptSeats, seats)
                .SetProperty(p => p.UpdatedAt, now));
            await NotificationService.NotifyAsync(
                db, payment.Booking.UserId, NotificationType.PAYMENT_APPROVED,
                new NotificationContext { Code = payment.Booking.Code, ReceiptNo = receiptNo },
                NotificationTemplates.Data(("bookingId", payment.BookingId)));
            await tx.CommitAsync();
        }

        // ส่งหลัง commit แล้วเท่านั้น
        await receipts.EmailAsync(payment.BookingId);
        return await bookings.GetByIdAsync(payment.BookingId);
    }

    /// <summary>
    /// ปฏิเสธสลิป — ปกติคืนการจองกลับไปสถานะรอชำระเงิน พร้อมให้เวลาใหม่
    /// (ไม่ยกเลิกทิ้งทันที เพราะผู้ใช้อาจแค่แนบสลิปผิดรูป)
    ///
    /// ยกเว้นรอบเริ่มฉายไปแล้ว — ปิดเป็นหมดเวลาแทน และส่งสลิปใหม่ไม่ได้อีก ถ้าเงินโอนมาจริง แจ้งเตือนบอกให้ติดต่อเจ้าหน้าที่
    /// </summary>
    public async Task<BookingResponse> RejectAsync(string paymentId, string adminId, string reason)
    {
        var payment = await LoadPendingAsync(paymentId);
        if (payment.Kind == PaymentKind.SEAT_CHANGE_TOPUP) return await seatChanges.RejectTopUpAsync(payment, adminId, reason);
        var now = time.UtcNowMs();
        var showtimeStarted = payment.Booking.Showtime.StartsAt <= now;

        Task<int> RejectPayment(IQueryable<Payment> q) => q.ExecuteUpdateAsync(s => s
            .SetProperty(p => p.Status, PaymentStatus.REJECTED)
            .SetProperty(p => p.RejectReason, reason)
            .SetProperty(p => p.VerifiedById, adminId)
            .SetProperty(p => p.VerifiedAt, now)
            .SetProperty(p => p.UpdatedAt, now));

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            if (showtimeStarted)
            {
                var cancelReason = $"สลิปไม่ผ่านการตรวจสอบหลังรอบเริ่มฉาย: {reason}";
                await SettleAsync(
                    payment,
                    q => q.ExecuteUpdateAsync(s => s
                        .SetProperty(b => b.Status, BookingStatus.EXPIRED)
                        .SetProperty(b => b.ExpiredAt, now)
                        .SetProperty(b => b.HoldExpiresAt, (DateTime?)null)
                        .SetProperty(b => b.CancelReason, cancelReason)
                        .SetProperty(b => b.UpdatedAt, now)),
                    RejectPayment);
                await db.BookingSeats.Where(bs => bs.BookingId == payment.BookingId).ExecuteDeleteAsync();
            }
            else
            {
                var retryUntil = now.AddMinutes(config.RejectedRetryMinutes);
                await SettleAsync(
                    payment,
                    q => q.ExecuteUpdateAsync(s => s
                        .SetProperty(b => b.Status, BookingStatus.PENDING_PAYMENT)
                        .SetProperty(b => b.HoldExpiresAt, retryUntil)
                        .SetProperty(b => b.UpdatedAt, now)),
                    RejectPayment);
            }
            await NotificationService.NotifyAsync(
                db, payment.Booking.UserId, NotificationType.PAYMENT_REJECTED,
                new NotificationContext { Code = payment.Booking.Code, Reason = reason, Closed = showtimeStarted },
                NotificationTemplates.Data(("bookingId", payment.BookingId)));
            await tx.CommitAsync();
        }

        return await bookings.GetByIdAsync(payment.BookingId);
    }

    // ---------- การคืนเงิน ----------

    /// <summary>
    /// คิวรอคืนเงิน — การจองที่จ่ายเงินมาแล้วแต่ถูกยกเลิกภายหลัง และส่วนต่างที่ต้องคืนจากการย้ายไปที่นั่งที่ถูกกว่า
    /// ระบบนี้รับเงินด้วยการโอน + ตรวจสลิป การคืนเงินจึงเป็นการโอนคืนด้วยมือเช่นกัน
    /// หน้าที่ของระบบคือเตือนว่ายังค้างอยู่ และเก็บหลักฐานว่าโอนคืนไปแล้วเมื่อไหร่ โดยใคร
    /// </summary>
    public async Task<PageResult<RefundQueueItem>> ListRefundsAsync(string? status, string? sort, int? page, int? pageSize)
    {
        status ??= "REFUND_PENDING";
        var query = db.Payments.AsNoTracking();
        if (status == "ALL")
        {
            query = query.Where(p => p.Status == PaymentStatus.REFUND_PENDING || p.Status == PaymentStatus.REFUNDED);
        }
        else
        {
            var value = Enum.Parse<PaymentStatus>(status);
            query = query.Where(p => p.Status == value);
        }

        // คืนแล้วเรียงตามเวลาที่โอนคืน ที่เหลือเรียงตามเวลาที่เข้าคิว
        // ไม่ระบุ sort = รอคืน: ค้างนานสุดขึ้นก่อน (ใครรอก่อนได้ก่อน) · คืนแล้ว: ล่าสุดขึ้นก่อน
        var byRefundedAt = status == "REFUNDED";
        var newest = (sort ?? (byRefundedAt ? "newest" : "oldest")) == "newest";
        var paged = await Pagination.FindPageAsync(
            query,
            filtered =>
            {
                var withBooking = WithQueueBooking(filtered.Include(p => p.RefundedBy));
                // id ต่อท้ายทิศเดียวกัน ให้ลำดับคงที่ระหว่างหน้าแม้เวลาเท่ากัน
                return byRefundedAt
                    ? withBooking.OrderBy(p => p.RefundedAt, newest).ThenBy(p => p.Id, newest)
                    : withBooking.OrderBy(p => p.RefundDueAt, newest).ThenBy(p => p.Id, newest);
            },
            page,
            pageSize);

        var items = paged.Rows.Select(p => new RefundQueueItem(
            p.Id,
            // BOOKING = ยกเลิกหลังจ่ายเงิน · SEAT_CHANGE_REFUND = คืนส่วนต่างที่ย้ายไปที่ถูกกว่า
            p.Kind,
            SeatChangeRules.Summary(p.SeatChange),
            p.Status,
            p.Amount,
            p.RefundAmount ?? p.Amount,
            p.Reference,
            p.Booking.PaidAt,
            p.SlipUploadedAt,
            p.RefundDueAt,
            p.RefundedAt,
            p.RefundedBy is null ? null : new PersonRef(p.RefundedBy.Id, p.RefundedBy.Name),
            p.RefundNote,
            p.RefundBankName,
            p.RefundAccountNo,
            p.RefundAccountName,
            p.RefundSlipPath is not null,
            new RefundQueueBooking(
                p.Booking.Id,
                p.Booking.Code,
                p.Booking.Status,
                p.Booking.TotalAmount,
                p.Booking.SeatSnapshot,
                Contact(p.Booking.User),
                QueueShowtime(p.Booking.Showtime),
                p.Booking.CancelledAt,
                p.Booking.CancelReason))).ToList();
        return new PageResult<RefundQueueItem>(items, paged.Total, paged.Page, paged.PageSize);
    }

    /// <summary>ผู้ดูแลโอนคืนเองแล้วมาบันทึก ต้องแนบสลิปคืนเงิน เพราะลูกค้าเปิดดูเป็นหลักฐานได้ที่หน้าการจองของฉัน</summary>
    public async Task CompleteRefundAsync(string paymentId, string adminId, string? note, StoredSlip? file)
    {
        if (file is null) throw ApiException.BadRequest("NO_FILE", "กรุณาแนบสลิปการโอนคืน");

        await slips.DiscardSlipOnErrorAsync(file, async () =>
        {
            var payment = await db.Payments.AsNoTracking().Include(p => p.Booking).FirstOrDefaultAsync(p => p.Id == paymentId)
                ?? throw ApiException.NotFound("PAYMENT_NOT_FOUND", "ไม่พบรายการชำระเงินนี้");
            if (payment.Status != PaymentStatus.REFUND_PENDING)
            {
                throw ApiException.Conflict(
                    "REFUND_NOT_PENDING",
                    payment.Status == PaymentStatus.REFUNDED ? "รายการนี้คืนเงินไปแล้ว" : "รายการนี้ไม่ได้อยู่ในสถานะรอคืนเงิน");
            }

            await using var tx = await db.Database.BeginTransactionAsync();
            // กดบันทึกซ้ำ/ผู้ดูแลสองคนกดพร้อมกัน — ครั้งที่สองต้องไม่ผ่าน ไม่งั้นลูกค้าได้แจ้งเตือนซ้ำ
            // และสลิปใบแรกถูกเขียนทับจนกลายเป็นไฟล์กำพร้า
            var now = time.UtcNowMs();
            var count = await db.Payments
                .Where(p => p.Id == paymentId && p.Status == PaymentStatus.REFUND_PENDING)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Status, PaymentStatus.REFUNDED)
                    .SetProperty(p => p.RefundedAt, now)
                    .SetProperty(p => p.RefundedById, adminId)
                    .SetProperty(p => p.RefundNote, note)
                    .SetProperty(p => p.RefundSlipPath, file.FileName)
                    .SetProperty(p => p.UpdatedAt, now));
            if (count == 0) throw ApiException.Conflict("REFUND_NOT_PENDING", "รายการนี้คืนเงินไปแล้ว");
            await NotificationService.NotifyAsync(
                db, payment.Booking.UserId, NotificationType.REFUND_COMPLETED,
                new NotificationContext { Code = payment.Booking.Code, Amount = payment.RefundAmount ?? payment.Amount },
                NotificationTemplates.Data(("bookingId", payment.BookingId)));
            await tx.CommitAsync();
            return true;
        });
    }

    /// <summary>
    /// แก้รายการที่บันทึกคืนเงินไปแล้ว — เปลี่ยนสลิป (ถ้าแนบมาใหม่) และหมายเหตุ
    /// ไม่แตะสถานะ/เวลาคืนเงิน และไม่แจ้งเตือนลูกค้าซ้ำ เพราะเงินถูกโอนไปแล้วจริง แค่แก้หลักฐานให้ถูก
    /// </summary>
    public async Task UpdateRefundAsync(string paymentId, string? note, StoredSlip? file)
    {
        var previousSlip = await slips.DiscardSlipOnErrorAsync(file, async () =>
        {
            var payment = await db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.Id == paymentId)
                ?? throw ApiException.NotFound("PAYMENT_NOT_FOUND", "ไม่พบรายการชำระเงินนี้");
            if (payment.Status != PaymentStatus.REFUNDED)
            {
                throw ApiException.Conflict("REFUND_NOT_COMPLETED", "รายการนี้ยังไม่ได้บันทึกการคืนเงิน");
            }

            var now = time.UtcNowMs();
            var cleanNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            var count = await db.Payments
                .Where(p => p.Id == paymentId && p.Status == PaymentStatus.REFUNDED)
                .ExecuteUpdateAsync(s =>
                {
                    s.SetProperty(p => p.RefundNote, cleanNote).SetProperty(p => p.UpdatedAt, now);
                    if (file is not null) s.SetProperty(p => p.RefundSlipPath, file.FileName);
                });
            if (count == 0) throw ApiException.Conflict("REFUND_NOT_COMPLETED", "รายการนี้ยังไม่ได้บันทึกการคืนเงิน");
            return payment.RefundSlipPath;
        });

        // สลิปเก่าไม่มีใครอ้างถึงแล้ว ลบทิ้งหลังบันทึกสำเร็จเท่านั้น
        if (file is not null && previousSlip is not null) await storage.RemoveAsync(SlipKind.Refund, previousSlip);
    }
}
