using CineBook.Web.Data;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Infrastructure.Storage;
using CineBook.Web.Infrastructure.Uploads;
using CineBook.Web.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>
/// เงินที่กันที่นั่งรอโอน — ค่าตั๋ว (การจอง) กับส่วนต่างเปลี่ยนที่นั่ง (คำขอ) ใช้ขั้นตอนเดียวกันทั้งหมด
/// นับถอยหลัง → ส่งสลิป → ผู้ดูแลตรวจ · หมดเวลาแล้วจบ ไม่มีการรับโอนหลังหมดเวลา
/// ทั้งสองอย่างมีฟิลด์ชุดเดียวกัน (status, holdExpiresAt, payment) ฟังก์ชันในไฟล์นี้จึงรับได้ทั้งคู่ (holder)
/// </summary>
public sealed class SlipService(AppDbContext db, TimeProvider time, ISlipStorage storage)
{
    /// <summary>เวลาที่เหลือของ hold (วินาที) — null แปลว่าไม่ได้กำลังนับถอยหลัง (ใช้ทั้งการจองและคำขอเปลี่ยนที่นั่ง)</summary>
    public static long? HoldSecondsLeft(DateTime? holdExpiresAt, DateTime now) =>
        holdExpiresAt is null ? null : Math.Max(0, (long)Math.Floor((holdExpiresAt.Value - now).TotalSeconds));

    /// <summary>
    /// รายการนี้ส่งสลิปได้ไหม — ได้เฉพาะตอนรอชำระเงิน
    ///
    /// เลยกำหนดแล้วแต่ job (ทุก 30 วินาที) ยังไม่ได้ปล่อยที่นั่งก็ยังรับ เพราะที่นั่งยังเป็นของเขา
    /// คนที่กดส่งก่อนหมดเวลาแต่อัปโหลดเสร็จช้าไปไม่กี่วินาทีจะได้ไม่ตกไป (หน้าเว็บซ่อนฟอร์มตอนนับถึง 0 อยู่แล้ว)
    /// หมดเวลาแล้ว (EXPIRED) ไม่รับอีก — โอนแล้วแต่ส่งไม่ทันต้องติดต่อเจ้าหน้าที่ (ดู SlipRefusal)
    /// </summary>
    public static bool CanUploadSlip(BookingStatus status) => status == BookingStatus.PENDING_PAYMENT;

    public static bool CanUploadSlip(SeatChangeStatus status) => status == SeatChangeStatus.PENDING_PAYMENT;

    /// <summary>
    /// ทำรายการกับไฟล์สลิปที่เก็บลงที่เก็บไว้แล้ว — task ล้มเมื่อไหร่ ลบไฟล์นั้นทิ้งแล้วโยน error ต่อ
    /// ไม่งั้นไฟล์ของรายการที่ไม่สำเร็จจะค้างอยู่ในที่เก็บโดยไม่มีแถวไหนอ้างถึง (ไม่ได้แนบไฟล์มา = ไม่มีอะไรให้ลบ)
    /// </summary>
    public async Task<T> DiscardSlipOnErrorAsync<T>(StoredSlip? file, Func<Task<T>> task)
    {
        try
        {
            return await task();
        }
        catch
        {
            if (file is not null) await storage.RemoveAsync(file.Kind, file.FileName);
            throw;
        }
    }

    /// <summary>สถานะปัจจุบันของผู้ถือ hold — ใช้ตอบตามจริงหลังเขียนไม่สำเร็จ</summary>
    public sealed record HolderState(string Status, PaymentStatus? PaymentStatus);

    /// <summary>
    /// เหตุที่ส่งสลิปไม่ได้ ตามสถานะของรายการตอนนี้
    /// สลิปเดิมรอตรวจอยู่ = 409 alreadySentCode · หมดเวลาแล้ว = 409 HOLD_EXPIRED · อื่น ๆ = notPayable
    /// </summary>
    public static ApiException SlipRefusal(HolderState holder, Func<ApiException> notPayable, string alreadySentCode, string bookingCode)
    {
        if (holder.PaymentStatus == PaymentStatus.PENDING_VERIFICATION)
        {
            return ApiException.Conflict(alreadySentCode, "ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ");
        }
        if (holder.Status == "EXPIRED")
        {
            return ApiException.Conflict(
                "HOLD_EXPIRED",
                $"หมดเวลาส่งสลิปแล้ว หากโอนเงินไปแล้วกรุณาติดต่อเจ้าหน้าที่ พร้อมรหัสการจอง {bookingCode}");
        }
        return notPayable();
    }

    /// <summary>
    /// รับสลิปเข้าคิวให้ผู้ดูแลตรวจ — การจอง (ค่าตั๋ว) หรือคำขอเปลี่ยนที่นั่ง (ส่วนต่าง)
    /// จุดสำคัญ: ตั้ง holdExpiresAt = null เพื่อ "หยุดนับถอยหลัง" ระหว่างรอผู้ดูแลตรวจ
    /// ที่นั่งจะถูกยึดไว้จนกว่าจะอนุมัติหรือปฏิเสธ ลูกค้าจึงไม่เสียสิทธิ์เพราะความล่าช้าของผู้ดูแล
    ///
    /// moveHolder = compare-and-set สถานะของผู้ถือ (PENDING_PAYMENT → PENDING_VERIFICATION) คืนจำนวนแถวที่โดน
    /// ไม่เช็กว่าเลยกำหนดหรือยัง — ถ้า job ยังไม่ปล่อยที่นั่ง ที่นั่งก็ยังเป็นของคนนี้ รับสลิปได้เลย
    /// </summary>
    public async Task QueueSlipForReviewAsync(
        HolderState current,
        bool canUpload,
        Func<Task<int>> moveHolder,
        string paymentId,
        string fileName,
        Func<Task<HolderState>> reload,
        Func<ApiException> notPayable,
        string alreadySentCode,
        string bookingCode)
    {
        if (!canUpload) throw SlipRefusal(current, notPayable, alreadySentCode, bookingCode);

        bool moved;
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            // เงื่อนไขสถานะอยู่ใน update — ถ้า job หมดเวลาหรือการยกเลิกชิงเปลี่ยนสถานะไปก่อนในจังหวะเดียวกัน
            // จะไม่โดนแถวไหน แทนที่จะเขียนทับสถานะที่เพิ่งเปลี่ยน
            moved = await moveHolder() > 0;
            if (moved)
            {
                // บันทึกสลิป และล้างผลตรวจของรอบก่อน (กรณีส่งใหม่หลังถูกปฏิเสธ)
                var now = time.UtcNowMs();
                await db.Payments.Where(p => p.Id == paymentId).ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.SlipPath, fileName)
                    .SetProperty(p => p.SlipUploadedAt, now)
                    .SetProperty(p => p.Status, PaymentStatus.PENDING_VERIFICATION)
                    .SetProperty(p => p.RejectReason, (string?)null)
                    .SetProperty(p => p.VerifiedById, (string?)null)
                    .SetProperty(p => p.VerifiedAt, (DateTime?)null)
                    .SetProperty(p => p.UpdatedAt, now));
            }
            await tx.CommitAsync();
        }

        // มีอย่างอื่นเปลี่ยนสถานะไปก่อนเสี้ยววินาที (job ปิดเพราะหมดเวลา, ยกเลิก, ส่งซ้ำจากอีกแท็บ)
        // อ่านใหม่แล้วตอบตามสถานะจริง — job ชนะก็คือหมดเวลาแล้ว ได้ HOLD_EXPIRED เหมือนส่งหลังหมดเวลา
        if (!moved) throw SlipRefusal(await reload(), notPayable, alreadySentCode, bookingCode);
    }
}
