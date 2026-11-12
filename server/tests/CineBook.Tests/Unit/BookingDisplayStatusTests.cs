using CineBook.Web.Models.Entities;
using CineBook.Web.Utils;

namespace CineBook.Tests.Unit;

/// <summary>port จาก utils/bookingDisplayStatus.test.js — เพิ่มการตรวจว่าเงื่อนไขกรอง (Where) ตรงกับป้าย (Of) ทุกกรณี</summary>
[Trait("Category", "Unit")]
public sealed class BookingDisplayStatusTests
{
    private static Payment Money(PaymentKind kind, PaymentStatus status) => new() { Kind = kind, Status = status };

    private static SeatChange Change(SeatChangeStatus status, Payment? payment = null) => new() { Status = status, Payment = payment };

    /// <summary>แถวการจองแบบที่โหลดมาพร้อม Payment และ SeatChanges.Payment — ค่าเริ่มต้นคือใบที่จ่ายแล้วและไม่มีอะไรค้าง</summary>
    private static Booking Booking(
        BookingStatus status = BookingStatus.PAID,
        Payment? payment = null,
        params SeatChange[] seatChanges)
    {
        var main = payment ?? Money(PaymentKind.BOOKING, PaymentStatus.APPROVED);
        var booking = new Booking { Status = status, Payment = main, SeatChanges = [.. seatChanges] };
        // relation Payments (ที่เงื่อนไขในฐานข้อมูลใช้) = ใบหลัก + ส่วนต่างของทุกคำขอ
        booking.Payments = [main, .. seatChanges.Where(c => c.Payment is not null).Select(c => c.Payment!)];
        return booking;
    }

    /// <summary>ป้ายที่ได้ และยืนยันว่าเงื่อนไขกรองของทุกป้ายเลือกแถวนี้ตรงกับป้ายของมันพอดี</summary>
    private static string Of(Booking booking)
    {
        var status = BookingDisplayStatus.Of(booking);
        foreach (var candidate in BookingDisplayStatus.All)
        {
            var matches = BookingDisplayStatus.Where(candidate).Compile()(booking);
            Assert.True(matches == (candidate == status), $"Where({candidate}) ไม่ตรงกับป้าย {status}");
        }
        return status;
    }

    [Fact]
    public void ป้ายจากสถานะของการจองตรงๆ()
    {
        Assert.Equal("PENDING_PAYMENT", Of(Booking(BookingStatus.PENDING_PAYMENT, Money(PaymentKind.BOOKING, PaymentStatus.AWAITING_SLIP))));
        Assert.Equal("PENDING_VERIFICATION", Of(Booking(BookingStatus.PENDING_VERIFICATION, Money(PaymentKind.BOOKING, PaymentStatus.PENDING_VERIFICATION))));
        Assert.Equal("PAID", Of(Booking()));
        Assert.Equal("CANCELLED", Of(Booking(BookingStatus.CANCELLED, Money(PaymentKind.BOOKING, PaymentStatus.REJECTED))));
        Assert.Equal("EXPIRED", Of(Booking(BookingStatus.EXPIRED, Money(PaymentKind.BOOKING, PaymentStatus.REJECTED))));
        // แถวที่ไม่มีรายการเงินก็ต้องไม่พัง
        Assert.Equal("CANCELLED", BookingDisplayStatus.Of(new Booking { Status = BookingStatus.CANCELLED }));
    }

    [Fact]
    public void ส่วนต่างเปลี่ยนที่นั่ง_รอโอน_สลิปรอตรวจ_รอคืน()
    {
        Assert.Equal("TOPUP_PENDING_PAYMENT",
            Of(Booking(seatChanges: Change(SeatChangeStatus.PENDING_PAYMENT, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.AWAITING_SLIP)))));
        Assert.Equal("TOPUP_PENDING_VERIFICATION",
            Of(Booking(seatChanges: Change(SeatChangeStatus.PENDING_VERIFICATION, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.PENDING_VERIFICATION)))));
        Assert.Equal("DIFF_REFUND_PENDING",
            Of(Booking(seatChanges: Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUND_PENDING)))));
    }

    [Fact]
    public void ย้ายฟรีหรือจ่ายส่วนต่างจบแล้วยังเป็นชำระเงินสำเร็จ()
    {
        Assert.Equal("PAID", Of(Booking(seatChanges: Change(SeatChangeStatus.COMPLETED))));
        Assert.Equal("PAID", Of(Booking(seatChanges: Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.APPROVED)))));
        Assert.Equal("PAID", Of(Booking(seatChanges: Change(SeatChangeStatus.CANCELLED, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.REJECTED)))));
    }

    [Fact]
    public void การจองที่ยกเลิกแล้วรอเงินคืน_และคืนแล้ว()
    {
        Assert.Equal("CANCELLED_REFUND_PENDING", Of(Booking(BookingStatus.CANCELLED, Money(PaymentKind.BOOKING, PaymentStatus.REFUND_PENDING))));
        Assert.Equal("REFUNDED", Of(Booking(BookingStatus.CANCELLED, Money(PaymentKind.BOOKING, PaymentStatus.REFUNDED))));
        Assert.Equal("REFUNDED",
            Of(Booking(seatChanges: Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUNDED)))));
    }

    [Fact]
    public void ลำดับกฎ_เรื่องที่ยังค้างชนะเรื่องที่จบไปแล้ว()
    {
        SeatChange Refunded() => Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUNDED));

        Assert.Equal("DIFF_REFUND_PENDING", Of(Booking(seatChanges:
            [Refunded(), Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUND_PENDING))])));
        Assert.Equal("TOPUP_PENDING_PAYMENT", Of(Booking(seatChanges:
            [Refunded(), Change(SeatChangeStatus.PENDING_PAYMENT, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.AWAITING_SLIP))])));
        Assert.Equal("TOPUP_PENDING_VERIFICATION", Of(Booking(seatChanges:
        [
            Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUND_PENDING)),
            Change(SeatChangeStatus.PENDING_VERIFICATION, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.PENDING_VERIFICATION)),
        ])));
        Assert.Equal("CANCELLED_REFUND_PENDING", Of(Booking(
            BookingStatus.CANCELLED, Money(PaymentKind.BOOKING, PaymentStatus.REFUND_PENDING), Refunded())));
        Assert.Equal("CANCELLED_REFUND_PENDING", Of(Booking(
            BookingStatus.CANCELLED,
            Money(PaymentKind.BOOKING, PaymentStatus.REFUNDED),
            Change(SeatChangeStatus.COMPLETED, Money(PaymentKind.SEAT_CHANGE_REFUND, PaymentStatus.REFUND_PENDING)))));
    }

    [Fact]
    public void ค่าที่เป็นไปได้ไม่ซ้ำกัน_และค่าที่ไม่รู้จักถูกปฏิเสธ()
    {
        Assert.Equal(10, BookingDisplayStatus.All.Count);
        Assert.Equal(10, BookingDisplayStatus.All.Distinct().Count());
        Assert.Throws<ArgumentException>(() => BookingDisplayStatus.Where("NOPE"));
        Assert.Throws<ArgumentException>(() => BookingDisplayStatus.AnyWhere(["PAID", "NOPE"]));
    }

    [Fact]
    public void กรองเป็นกลุ่ม_หลายป้ายORกัน_และค่าซ้ำไม่เปลี่ยนผล()
    {
        var unpaid = Booking(BookingStatus.PENDING_PAYMENT, Money(PaymentKind.BOOKING, PaymentStatus.AWAITING_SLIP));
        var topUp = Booking(seatChanges: Change(SeatChangeStatus.PENDING_PAYMENT, Money(PaymentKind.SEAT_CHANGE_TOPUP, PaymentStatus.AWAITING_SLIP)));
        var paid = Booking();
        var group = BookingDisplayStatus.AnyWhere(["PENDING_PAYMENT", "TOPUP_PENDING_PAYMENT"]).Compile();
        Assert.True(group(unpaid));
        Assert.True(group(topUp));
        Assert.False(group(paid));
        Assert.True(BookingDisplayStatus.AnyWhere(["EXPIRED", "EXPIRED"]).Compile()(Booking(BookingStatus.EXPIRED, Money(PaymentKind.BOOKING, PaymentStatus.REJECTED))));
    }
}
