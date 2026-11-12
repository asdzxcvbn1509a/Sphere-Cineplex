using System.Globalization;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;

namespace CineBook.Web.Utils;

/// <summary>
/// ใบเสร็จรับเงิน (E-Receipt) — ส่วนที่ไม่แตะฐานข้อมูล ไม่ผูกกับ config และเทสต์ได้ตรง ๆ
/// การออกเลขและการตรวจสิทธิ์อยู่ที่ Services/ReceiptService
/// </summary>
public static class Receipts
{
    public const string Prefix = "RC";

    private static readonly PaymentStatus[] RefundStatuses = [PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED];

    /// <summary>ปีของเลขที่ใบเสร็จ = ปี ค.ศ. ตามเวลาไทย — อนุมัติตอนตีหนึ่งของวันที่ 1 ม.ค. (เวลาไทย) ต้องขึ้นชุดของปีใหม่แล้ว</summary>
    public static int ReceiptYear(DateTime utc) => BangkokTime.ToBangkok(utc).Year;

    /// <summary>RC-2026-000123 — เกินล้านใบในปีเดียวเลขก็แค่ยาวขึ้น ไม่ถูกตัดจนซ้ำกัน</summary>
    public static string FormatReceiptNo(int year, long sequence) =>
        $"{Prefix}-{year}-{sequence.ToString(CultureInfo.InvariantCulture).PadLeft(6, '0')}";

    /// <summary>
    /// รายการบนใบเสร็จ — ที่นั่งโซนเดียวกันราคาเดียวกันรวมเป็นบรรทัดเดียว เช่น "พรีเมียม B1, B2 × 2"
    /// ใช้ราคาจาก seatSnapshot (ราคา ณ ตอนจอง) ไม่ใช่ราคาปัจจุบันของรอบ เพราะผู้ดูแลแก้ราคารอบทีหลังได้
    /// </summary>
    public static List<SeatsReceiptLine> ReceiptLines(IEnumerable<SeatSnapshot>? seats)
    {
        // เก็บลำดับตามที่เจอครั้งแรก (Map ของ JavaScript เดิมก็เรียงตามลำดับที่ใส่)
        var order = new List<string>();
        var lines = new Dictionary<string, (SeatZone Zone, int UnitPrice, int Quantity, int Amount, List<string> Seats)>();
        foreach (var seat in seats ?? [])
        {
            var key = $"{seat.Zone}:{seat.Price}";
            if (!lines.TryGetValue(key, out var line))
            {
                line = (seat.Zone, seat.Price, 0, 0, []);
                order.Add(key);
            }
            line.Seats.Add(seat.Label);
            lines[key] = (line.Zone, line.UnitPrice, line.Quantity + 1, line.Amount + seat.Price, line.Seats);
        }
        return order
            .Select(key => lines[key])
            .Select(line => new SeatsReceiptLine("SEATS", line.Zone, line.UnitPrice, line.Quantity, line.Amount, line.Seats))
            .ToList();
    }

    /// <summary>
    /// ใบเสร็จส่วนต่างจากการเปลี่ยนที่นั่ง — บรรทัดเดียว บอกว่าย้ายจากที่นั่งไหนไปไหน
    /// ที่นั่งเอาจากคำขอเปลี่ยนที่นั่ง (ไม่เปลี่ยนอีกหลังย้ายเสร็จ) ใบเสร็จจึงคงเดิมแม้จะย้ายต่ออีกรอบ
    /// </summary>
    private static SeatChangeReceiptLine SeatChangeLine(Payment payment) =>
        new(
            "SEAT_CHANGE",
            Seats.SeatLabels(payment.SeatChange?.FromSeats),
            Seats.SeatLabels(payment.SeatChange?.ToSeats),
            1,
            payment.Amount,
            payment.Amount);

    private static List<string> SortedLabels(IEnumerable<SeatSnapshot>? seats) =>
        (seats ?? []).Select(seat => seat.Label).OrderBy(label => label, StringComparer.Ordinal).ToList();

    /// <summary>
    /// ข้อมูลใบเสร็จที่ส่งให้หน้าเว็บ และใช้ทำอีเมล
    /// booking ต้องโหลด User, Showtime.Movie, Showtime.Theatre และ Payment (ใบหลัก) มาแล้ว
    /// payment = รายการเงินที่ออกใบเสร็จ — ไม่ส่งมาคือใบหลัก (ค่าตั๋วตอนจอง)
    ///   ส่งรายการส่วนต่าง (SEAT_CHANGE_TOPUP ที่โหลด SeatChange มาแล้ว) มาคือใบเสร็จส่วนต่างเปลี่ยนที่นั่ง
    ///
    /// ชื่อผู้จ่ายและที่นั่งใช้สำเนาที่เก็บไว้ตอนออกใบเสร็จ (receiptName, receiptSeats) ก่อนเสมอ
    /// ผู้ใช้แก้ชื่อหรือเปลี่ยนที่นั่งทีหลังได้ แต่ใบเสร็จที่ออกไปแล้วต้องไม่เปลี่ยนตาม
    /// </summary>
    public static ReceiptResponse Shape(Booking booking, ReceiptIssuer issuer, Payment? payment = null)
    {
        payment ??= booking.Payment ?? throw new InvalidOperationException("การจองนี้ไม่มีรายการเงินหลัก");
        var showtime = booking.Showtime;
        var topUp = payment.Kind == PaymentKind.SEAT_CHANGE_TOPUP;
        var seats = payment.ReceiptSeats ?? booking.SeatSnapshot;
        // เปลี่ยนที่นั่งหลังออกใบเสร็จ — ใบเสร็จยังเป็นที่นั่งตอนจ่าย แต่บอกที่นั่งปัจจุบันไว้ คนถือใบเสร็จจะได้ไม่งงว่าทำไมไม่ตรงตั๋ว
        var current = SortedLabels(booking.SeatSnapshot);
        var seatsChanged = !topUp && string.Join(',', current) != string.Join(',', SortedLabels(seats));
        // ยกเลิกหลังจ่ายแล้วคืนเงินเป็นยอดสุทธิในรายการเดียวบนใบหลัก ใบเสร็จส่วนต่างจึงดูสถานะคืนเงินจากใบหลักด้วย
        var main = booking.Payment ?? payment;

        List<object> lines = topUp
            ? [SeatChangeLine(payment)]
            : ReceiptLines(seats).Cast<object>().ToList();

        return new ReceiptResponse(
            payment.ReceiptNo,
            payment.Kind,
            // วันที่ใบเสร็จ = เวลาที่ผู้ดูแลยืนยันยอด (ใบหลักตั้งพร้อม paidAt และไม่เปลี่ยนอีกหลังอนุมัติ)
            topUp ? payment.VerifiedAt : booking.PaidAt,
            new ReceiptIssuer(issuer.Name, string.IsNullOrEmpty(issuer.Address) ? null : issuer.Address),
            new ReceiptCustomer(payment.ReceiptName ?? booking.User?.Name ?? ""),
            // userId ให้หน้าเว็บรู้ว่าผู้ดูแลกำลังเปิดใบเสร็จของตัวเองหรือของลูกค้า (ทางกลับคนละหน้า)
            new ReceiptBookingRef(booking.Id, booking.Code, booking.Status, booking.UserId),
            new ReceiptShowtime(
                showtime.StartsAt,
                new ReceiptMovie(showtime.Movie.TitleTh, showtime.Movie.TitleEn),
                new ReceiptTheatre(showtime.Theatre.Name)),
            lines,
            seatsChanged ? current : null,
            payment.Amount,
            // ตั้งชื่อแบบ xxxTh/xxxEn ให้หน้าเว็บใช้ pick(receipt, 'amountText') ได้เหมือนชื่อเรื่อง
            BahtText.Thai(payment.Amount),
            BahtText.English(payment.Amount),
            new ReceiptPayment(payment.Method, payment.Reference),
            // ยกเลิกหลังจ่ายแล้ว — ใบเสร็จยังอยู่ (เป็นหลักฐานว่ารับเงินมาจริง) แต่ต้องบอกว่าเงินก้อนนี้คืน/กำลังคืนแล้ว
            RefundStatuses.Contains(main.Status) ? new ReceiptRefund(main.Status, main.RefundedAt) : null);
    }
}
