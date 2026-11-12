namespace CineBook.Web.Models.Entities;

// ชื่อสมาชิกตรงกับ label ของ enum ใน PostgreSQL และค่าใน JSON ที่หน้าเว็บใช้อยู่ทุกตัว (PENDING_PAYMENT ฯลฯ)
// จึงไม่ต้องมีตัวแปลงชื่อทั้งฝั่งฐานข้อมูลและฝั่ง JSON — ลำดับสมาชิกก็ตรงกับลำดับ label ในฐาน (ลำดับที่ migration สร้างไว้)

public enum Role
{
    USER,
    ADMIN,
}

public enum MovieStatus
{
    NOW_SHOWING,
    COMING_SOON,
    ARCHIVED,
}

public enum SeatZone
{
    NORMAL,
    PREMIUM,
    SOFA,
}

public enum ShowtimeStatus
{
    SCHEDULED,
    CANCELLED,
}

public enum BookingStatus
{
    PENDING_PAYMENT,
    PENDING_VERIFICATION,
    PAID,
    CANCELLED,
    EXPIRED,
}

public enum PaymentStatus
{
    AWAITING_SLIP,
    PENDING_VERIFICATION,
    APPROVED,
    REJECTED,
    /// <summary>ยกเลิกการจองหลังจ่ายเงินแล้ว ต้องรอผู้ดูแลโอนเงินคืน</summary>
    REFUND_PENDING,
    /// <summary>ผู้ดูแลโอนคืนและบันทึกหลักฐานแล้ว</summary>
    REFUNDED,
}

/// <summary>ชนิดของรายการเงิน — การจองหนึ่งใบมีได้หลายรายการ (ค่าตั๋วตอนจอง + ส่วนต่างจากการเปลี่ยนที่นั่ง)</summary>
public enum PaymentKind
{
    /// <summary>ค่าตั๋วตอนจอง — มีใบเดียวต่อการจองเสมอ</summary>
    BOOKING,
    /// <summary>ลูกค้าโอนส่วนต่างเพิ่มเพราะย้ายไปที่นั่งที่แพงกว่า (ตรวจสลิปและออกใบเสร็จแบบเดียวกับค่าตั๋ว)</summary>
    SEAT_CHANGE_TOPUP,
    /// <summary>ส่วนต่างที่ต้องโอนคืนเพราะย้ายไปที่นั่งที่ถูกกว่า — ไม่มีเงินขาเข้า เข้าคิวคืนเงินตั้งแต่สร้าง</summary>
    SEAT_CHANGE_REFUND,
}

public enum SeatChangeStatus
{
    /// <summary>ย้ายไปที่นั่งที่แพงกว่า — กันที่นั่งใหม่ไว้รอโอนส่วนต่าง ระหว่างนี้ที่นั่งเดิมยังเป็นของลูกค้า</summary>
    PENDING_PAYMENT,
    /// <summary>ส่งสลิปส่วนต่างแล้ว รอผู้ดูแลตรวจ (หยุดนับถอยหลัง)</summary>
    PENDING_VERIFICATION,
    /// <summary>ย้ายเสร็จแล้ว</summary>
    COMPLETED,
    /// <summary>ลูกค้ายกเลิกคำขอเอง หรือการจอง/รอบถูกยกเลิกระหว่างรอ</summary>
    CANCELLED,
    /// <summary>ไม่ได้โอนส่วนต่างภายในเวลา หรือสลิปถูกปฏิเสธหลังรอบเริ่มฉาย</summary>
    EXPIRED,
}

public enum NotificationType
{
    PAYMENT_APPROVED,
    PAYMENT_REJECTED,
    BOOKING_CANCELLED,
    BOOKING_EXPIRED,
    SHOWTIME_REMINDER,
    REFUND_COMPLETED,
    /// <summary>ผู้ดูแลยกเลิกทั้งรอบ (เครื่องฉายเสีย โรงปิด ฯลฯ) — ใบที่จ่ายแล้วเข้าคิวคืนเงิน</summary>
    SHOWTIME_CANCELLED,
    /// <summary>เลิกสร้างแล้ว (ระบบไม่รับสลิปหลังหมดเวลา) — คงไว้ให้แจ้งเตือนเก่าในฐานข้อมูล</summary>
    LATE_PAYMENT_REFUND,
    /// <summary>ย้ายที่นั่งเสร็จแล้ว (ลูกค้าย้ายเอง หรือผู้ดูแลย้ายให้)</summary>
    SEATS_CHANGED,
    /// <summary>สลิปส่วนต่างของการเปลี่ยนที่นั่งไม่ผ่านการตรวจสอบ</summary>
    SEAT_CHANGE_REJECTED,
    /// <summary>ไม่ได้โอนส่วนต่างภายในเวลา — คำขอเปลี่ยนที่นั่งปิด ที่นั่งเดิมยังอยู่</summary>
    SEAT_CHANGE_EXPIRED,
    /// <summary>เลิกสร้างแล้ว (ระบบไม่รับสลิปส่วนต่างหลังหมดเวลา) — คงไว้ให้แจ้งเตือนเก่าในฐานข้อมูล</summary>
    SEAT_CHANGE_LATE_REFUND,
}
