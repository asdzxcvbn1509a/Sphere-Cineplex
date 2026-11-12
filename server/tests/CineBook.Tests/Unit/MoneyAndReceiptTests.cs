using CineBook.Web.Emails;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;

namespace CineBook.Tests.Unit;

/// <summary>port จาก utils/bahtText.test.js, promptpay.test.js, receipt.test.js, emails/receipt.test.js</summary>
[Trait("Category", "Unit")]
public sealed class BahtTextTests
{
    [Theory]
    [InlineData(0, "ศูนย์บาทถ้วน")]
    [InlineData(1, "หนึ่งบาทถ้วน")]
    [InlineData(10, "สิบบาทถ้วน")]
    [InlineData(11, "สิบเอ็ดบาทถ้วน")]
    [InlineData(20, "ยี่สิบบาทถ้วน")]
    [InlineData(21, "ยี่สิบเอ็ดบาทถ้วน")]
    [InlineData(101, "หนึ่งร้อยเอ็ดบาทถ้วน")]
    [InlineData(560, "ห้าร้อยหกสิบบาทถ้วน")]
    [InlineData(1001, "หนึ่งพันเอ็ดบาทถ้วน")]
    [InlineData(1_000_000, "หนึ่งล้านบาทถ้วน")]
    [InlineData(1_000_001, "หนึ่งล้านเอ็ดบาทถ้วน")]
    [InlineData(11_000_000, "สิบเอ็ดล้านบาทถ้วน")]
    [InlineData(21_000_021, "ยี่สิบเอ็ดล้านยี่สิบเอ็ดบาทถ้วน")]
    [InlineData(1_234_567, "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน")]
    [InlineData(1_000_000_000_000, "หนึ่งล้านล้านบาทถ้วน")]
    public void อ่านภาษาไทย(long amount, string expected) => Assert.Equal(expected, BahtText.Thai(amount));

    [Theory]
    [InlineData(0, "Zero Baht Only")]
    [InlineData(1, "One Baht Only")]
    [InlineData(11, "Eleven Baht Only")]
    [InlineData(21, "Twenty-One Baht Only")]
    [InlineData(101, "One Hundred One Baht Only")]
    [InlineData(560, "Five Hundred Sixty Baht Only")]
    [InlineData(1001, "One Thousand One Baht Only")]
    [InlineData(1_000_001, "One Million One Baht Only")]
    [InlineData(1_234_567, "One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Baht Only")]
    public void อ่านภาษาอังกฤษ(long amount, string expected) => Assert.Equal(expected, BahtText.English(amount));

    [Fact]
    public void รับเฉพาะจำนวนเต็มบาทที่ไม่ติดลบ()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => BahtText.Thai(-1));
        Assert.Throws<ArgumentOutOfRangeException>(() => BahtText.English(-1));
    }
}

[Trait("Category", "Unit")]
public sealed class PromptPayTests
{
    [Fact]
    public void crc16ccittตรงกับค่าอ้างอิง() => Assert.Equal("29B1", PromptPay.Crc16Ccitt("123456789"));

    [Theory]
    // ค่าที่ไลบรารี promptpay-qr ของฝั่ง Express สร้าง — QR ของระบบใหม่ต้องเหมือนเดิมทุกไบต์
    [InlineData("0812345678", 360, "00020101021229370016A000000677010111011300668123456785802TH53037645406360.0063043F88")]
    [InlineData("0812345678", 1250, "00020101021229370016A000000677010111011300668123456785802TH530376454071250.0063040256")]
    [InlineData("1234567890123", 99, "00020101021229370016A000000677010111021312345678901235802TH5303764540599.0063045135")]
    [InlineData("123456789012345", 5, "00020101021229390016A00000067701011103151234567890123455802TH530376454045.0063042E2F")]
    public void payloadตรงกับpromptpayQrของเดิม(string target, int amount, string expected) =>
        Assert.Equal(expected, PromptPay.CreatePayload(target, amount));

    [Fact]
    public void payloadบรรจุยอดเงินสกุลเงินและประเทศครบ()
    {
        var payload = PromptPay.CreatePayload("0812345678", 1250);
        var tags = PromptPay.ParseTlv(payload);
        Assert.StartsWith("000201", payload);
        Assert.Equal("764", tags["53"]);
        Assert.Equal("TH", tags["58"]);
        Assert.Equal("1250.00", tags["54"]);
        Assert.True(tags.ContainsKey("29"));
        Assert.NotEqual(PromptPay.CreatePayload("0812345678", 100), PromptPay.CreatePayload("0812345678", 200));
    }

    [Fact]
    public void IsValidPayloadจับpayloadที่ถูกแก้ไขได้()
    {
        var payload = PromptPay.CreatePayload("0812345678", 500);
        Assert.True(PromptPay.IsValidPayload(payload));
        Assert.False(PromptPay.IsValidPayload($"{payload[..^4]}0000"));
        Assert.False(PromptPay.IsValidPayload(""));
        Assert.False(PromptPay.IsValidPayload(null));
    }
}

[Trait("Category", "Unit")]
public sealed class ReceiptTests
{
    private static SeatSnapshot Seat(string label, SeatZone zone, int price) =>
        new($"seat-{label}", label[..1], int.Parse(label[1..]), label, zone, price);

    private static readonly ReceiptIssuer Issuer = new("Sphere Cineplex", null);

    private static Booking PaidBooking(
        BookingStatus status = BookingStatus.PAID,
        List<SeatSnapshot>? seatSnapshot = null,
        PaymentStatus paymentStatus = PaymentStatus.APPROVED,
        DateTime? refundedAt = null,
        List<SeatSnapshot>? receiptSeats = null)
    {
        var booking = new Booking
        {
            Id = "b1",
            UserId = "u1",
            Code = "TRS-ABC234",
            Status = status,
            PaidAt = new DateTime(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc),
            SeatSnapshot = seatSnapshot ?? [Seat("A1", SeatZone.NORMAL, 200), Seat("B1", SeatZone.PREMIUM, 280), Seat("B2", SeatZone.PREMIUM, 280)],
            User = new User { Id = "u1", Name = "ชื่อปัจจุบัน", Email = "u1@test.local" },
            Showtime = new Showtime
            {
                StartsAt = new DateTime(2026, 10, 3, 12, 0, 0, DateTimeKind.Utc),
                Movie = new Movie { TitleTh = "ฤดูฝนที่หายไป", TitleEn = "The Vanished Monsoon" },
                Theatre = new Theatre { Name = "Theatre 1" },
            },
        };
        booking.Payment = new Payment
        {
            Method = "PROMPTPAY",
            Reference = "12345678",
            Amount = 760,
            Status = paymentStatus,
            ReceiptNo = "RC-2026-000001",
            ReceiptName = "ชื่อตอนจ่าย",
            RefundedAt = refundedAt,
            ReceiptSeats = receiptSeats,
        };
        return booking;
    }

    [Fact]
    public void เลขที่ใบเสร็จเติมศูนย์ให้ครบ6หลักและไม่ตัดทิ้งเมื่อเกิน()
    {
        Assert.Equal("RC-2026-000123", Receipts.FormatReceiptNo(2026, 123));
        Assert.Equal("RC-2026-1234567", Receipts.FormatReceiptNo(2026, 1_234_567));
    }

    [Fact]
    public void ปีของเลขที่ใบเสร็จนับตามเวลาไทย()
    {
        Assert.Equal(2026, Receipts.ReceiptYear(DateTime.Parse("2026-12-31T16:59:59.999Z").ToUniversalTime()));
        Assert.Equal(2027, Receipts.ReceiptYear(DateTime.Parse("2026-12-31T17:00:00Z").ToUniversalTime()));
    }

    [Fact]
    public void ReceiptLinesรวมที่นั่งโซนและราคาเดียวกันเป็นบรรทัดเดียว()
    {
        var lines = Receipts.ReceiptLines([Seat("A1", SeatZone.NORMAL, 200), Seat("B1", SeatZone.PREMIUM, 280), Seat("B2", SeatZone.PREMIUM, 280)]);
        Assert.Equal(2, lines.Count);
        Assert.Equal(new SeatsReceiptLine("SEATS", SeatZone.NORMAL, 200, 1, 200, ["A1"]) with { Seats = lines[0].Seats }, lines[0]);
        Assert.Equal(["A1"], lines[0].Seats);
        Assert.Equal((SeatZone.PREMIUM, 280, 2, 560), (lines[1].Zone, lines[1].UnitPrice, lines[1].Quantity, lines[1].Amount));
        Assert.Equal(["B1", "B2"], lines[1].Seats);
        Assert.Equal(2, Receipts.ReceiptLines([Seat("A1", SeatZone.NORMAL, 200), Seat("A2", SeatZone.NORMAL, 180)]).Count);
    }

    [Fact]
    public void Shapeใช้ชื่อที่เก็บไว้ตอนออกใบเสร็จ()
    {
        var receipt = Receipts.Shape(PaidBooking(), Issuer);
        Assert.Equal("ชื่อตอนจ่าย", receipt.Customer.Name);
        Assert.Equal("RC-2026-000001", receipt.ReceiptNo);
        Assert.Equal("u1", receipt.Booking.UserId);
        Assert.Equal(760, receipt.TotalAmount);
        Assert.Equal("เจ็ดร้อยหกสิบบาทถ้วน", receipt.AmountTextTh);
        Assert.Equal("Seven Hundred Sixty Baht Only", receipt.AmountTextEn);
        Assert.Equal(new ReceiptIssuer("Sphere Cineplex", null), receipt.Issuer);
        Assert.Equal(2, receipt.Lines.Count);
        Assert.Null(receipt.Refund);
    }

    [Fact]
    public void Shapeใส่สถานะคืนเงินเมื่อยกเลิกหลังจ่ายแล้ว()
    {
        var refundedAt = new DateTime(2026, 10, 4, 3, 0, 0, DateTimeKind.Utc);
        var pending = Receipts.Shape(PaidBooking(BookingStatus.CANCELLED, paymentStatus: PaymentStatus.REFUND_PENDING), Issuer);
        var refunded = Receipts.Shape(
            PaidBooking(BookingStatus.CANCELLED, paymentStatus: PaymentStatus.REFUNDED, refundedAt: refundedAt),
            new ReceiptIssuer("Sphere Cineplex", "123 ถนนตัวอย่าง"));

        Assert.Equal(new ReceiptRefund(PaymentStatus.REFUND_PENDING, null), pending.Refund);
        Assert.Equal(new ReceiptRefund(PaymentStatus.REFUNDED, refundedAt), refunded.Refund);
        Assert.Equal("123 ถนนตัวอย่าง", refunded.Issuer.Address);
        Assert.Equal("RC-2026-000001", refunded.ReceiptNo);
    }

    [Fact]
    public void Shapeใช้ที่นั่งที่ตรึงไว้_และบอกที่นั่งปัจจุบันเมื่อเปลี่ยนภายหลัง()
    {
        var original = PaidBooking().SeatSnapshot;
        Assert.Null(Receipts.Shape(PaidBooking(receiptSeats: original), Issuer).SeatsChangedTo);

        var moved = Receipts.Shape(
            PaidBooking(
                seatSnapshot: [Seat("A4", SeatZone.NORMAL, 200), Seat("B1", SeatZone.PREMIUM, 280), Seat("B2", SeatZone.PREMIUM, 280)],
                receiptSeats: original),
            Issuer);
        Assert.Equal(["A1"], ((SeatsReceiptLine)moved.Lines[0]).Seats);
        Assert.Equal(["A4", "B1", "B2"], moved.SeatsChangedTo);
        Assert.Equal(760, moved.TotalAmount);
    }

    [Fact]
    public void Shapeใบเสร็จส่วนต่างเปลี่ยนที่นั่ง()
    {
        var verifiedAt = new DateTime(2026, 10, 2, 15, 0, 0, DateTimeKind.Utc);
        var topUp = new Payment
        {
            Kind = PaymentKind.SEAT_CHANGE_TOPUP,
            Method = "PROMPTPAY",
            Reference = "87654321",
            Amount = 80,
            Status = PaymentStatus.APPROVED,
            ReceiptNo = "RC-2026-000002",
            ReceiptName = "ชื่อตอนจ่าย",
            VerifiedAt = verifiedAt,
            SeatChange = new SeatChange
            {
                FromSeats = [Seat("A1", SeatZone.NORMAL, 200)],
                ToSeats = [Seat("C1", SeatZone.PREMIUM, 280)],
            },
        };

        var receipt = Receipts.Shape(PaidBooking(), Issuer, topUp);
        Assert.Equal(PaymentKind.SEAT_CHANGE_TOPUP, receipt.Kind);
        Assert.Equal("RC-2026-000002", receipt.ReceiptNo);
        Assert.Equal(verifiedAt, receipt.IssuedAt);
        var line = Assert.IsType<SeatChangeReceiptLine>(Assert.Single(receipt.Lines));
        Assert.Equal(("SEAT_CHANGE", 1, 80, 80), (line.Kind, line.Quantity, line.UnitPrice, line.Amount));
        Assert.Equal(["A1"], line.FromSeats);
        Assert.Equal(["C1"], line.ToSeats);
        Assert.Equal("แปดสิบบาทถ้วน", receipt.AmountTextTh);
        Assert.Equal("87654321", receipt.Payment.Reference);
        Assert.Null(receipt.SeatsChangedTo);
        Assert.Null(receipt.Refund);

        var cancelled = Receipts.Shape(PaidBooking(BookingStatus.CANCELLED, paymentStatus: PaymentStatus.REFUND_PENDING), Issuer, topUp);
        Assert.Equal(new ReceiptRefund(PaymentStatus.REFUND_PENDING, null), cancelled.Refund);
    }
}

[Trait("Category", "Unit")]
public sealed class ReceiptEmailTests
{
    private static ReceiptResponse Receipt(ReceiptIssuer? issuer = null, List<object>? lines = null, int total = 560) => new(
        "RC-2026-000042",
        PaymentKind.BOOKING,
        new DateTime(2026, 10, 2, 12, 5, 0, DateTimeKind.Utc),
        issuer ?? new ReceiptIssuer("Sphere Cineplex", null),
        new ReceiptCustomer("<b>สมชาย</b>"),
        new ReceiptBookingRef("b1", "TRS-ABC234", BookingStatus.PAID, "u1"),
        new ReceiptShowtime(
            new DateTime(2026, 10, 3, 12, 0, 0, DateTimeKind.Utc),
            new ReceiptMovie("ฤดูฝนที่หายไป", "The Vanished Monsoon"),
            new ReceiptTheatre("Theatre 1")),
        lines ?? [new SeatsReceiptLine("SEATS", SeatZone.PREMIUM, 280, 2, 560, ["B1", "B2"])],
        null,
        total,
        "ห้าร้อยหกสิบบาทถ้วน",
        "Five Hundred Sixty Baht Only",
        new ReceiptPayment("PROMPTPAY", "12345678"),
        null);

    private const string ReceiptUrl = "http://localhost:5173/booking/b1/receipt";
    private const string TicketUrl = "http://localhost:5173/booking/b1/ticket";

    [Fact]
    public void หัวเรื่องมีเลขที่ใบเสร็จและชื่อผู้ออก()
    {
        var email = ReceiptEmail.Build(Receipt(), ReceiptUrl, TicketUrl);
        Assert.Contains("RC-2026-000042", email.Subject);
        Assert.Contains("Sphere Cineplex", email.Subject);
    }

    [Fact]
    public void ข้อความล้วนมียอดเงิน_จำนวนเงินเป็นตัวอักษร_ที่นั่ง_และลิงก์()
    {
        var text = ReceiptEmail.Build(Receipt(), ReceiptUrl, TicketUrl).Text;
        Assert.Contains("560.00", text);
        Assert.Contains("ห้าร้อยหกสิบบาทถ้วน", text);
        Assert.Contains("B1, B2", text);
        Assert.Contains(ReceiptUrl, text);
        Assert.Contains(TicketUrl, text);
        // วันที่สองภาษาแบบเดียวกับ Intl ของฝั่ง Express
        Assert.Contains("2 ตุลาคม 2569 เวลา 19:05 (2 October 2026 at 19:05)", text);
    }

    [Fact]
    public void ค่าที่มาจากผู้ใช้ถูกescapeก่อนลงHTML()
    {
        var html = ReceiptEmail.Build(Receipt(), ReceiptUrl, TicketUrl).Html;
        Assert.Contains("&lt;b&gt;สมชาย&lt;/b&gt;", html);
        Assert.DoesNotContain("<b>สมชาย</b>", html);
        Assert.Contains($"href=\"{ReceiptUrl}\"", html);
    }

    [Fact]
    public void ไม่มีที่อยู่ผู้ออกก็ไม่เว้นบรรทัดว่าง_มีก็แสดง()
    {
        var without = ReceiptEmail.Build(Receipt(), ReceiptUrl, TicketUrl);
        var with = ReceiptEmail.Build(Receipt(new ReceiptIssuer("Sphere Cineplex", "99 ถนนตัวอย่าง")), ReceiptUrl, TicketUrl);
        Assert.DoesNotContain("", without.Text.Split('\n').Take(2));
        Assert.Contains("99 ถนนตัวอย่าง", with.Text);
        Assert.Contains("99 ถนนตัวอย่าง", with.Html);
    }

    [Fact]
    public void ใบเสร็จส่วนต่างบอกว่าย้ายจากที่นั่งไหนไปไหน()
    {
        var email = ReceiptEmail.Build(
            Receipt(lines: [new SeatChangeReceiptLine("SEAT_CHANGE", ["A1", "A2"], ["C1", "C2"], 1, 160, 160)], total: 160),
            ReceiptUrl,
            TicketUrl);
        Assert.Contains("A1, A2 → C1, C2", email.Text);
        Assert.Contains("Seat change", email.Text);
        Assert.Contains("A1, A2 → C1, C2", email.Html);
    }
}
