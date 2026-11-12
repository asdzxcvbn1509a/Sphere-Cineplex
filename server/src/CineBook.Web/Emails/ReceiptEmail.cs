using System.Globalization;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;

namespace CineBook.Web.Emails;

/// <summary>
/// เนื้อหาอีเมล "ใบเสร็จรับเงิน" ที่ส่งหลังผู้ดูแลอนุมัติสลิป
/// mailer = ส่งยังไง · ไฟล์นี้ = เขียนว่าอะไร
///
/// ใช้ label สองภาษาในฉบับเดียว ("ไทย / English" แบบใบเสร็จทั่วไปในไทย)
/// เพราะระบบไม่ได้เก็บภาษาที่ผู้ใช้เลือกไว้ และเมลนี้เกิดจากผู้ดูแลกดอนุมัติ ไม่ใช่จากหน้าเว็บของลูกค้า
/// เนื้อหาเป็นสรุปใบเสร็จ ส่วนฉบับเต็มที่พิมพ์/บันทึก PDF ได้อยู่บนหน้าเว็บตามลิงก์ในเมล
/// </summary>
public static class ReceiptEmail
{
    private static readonly Dictionary<string, string> MethodLabel = new() { ["PROMPTPAY"] = "พร้อมเพย์ / PromptPay" };

    private static string Money(int amount) => amount.ToString("#,##0.00", CultureInfo.InvariantCulture);

    private static string BilingualDate(DateTime? date) =>
        date is null ? "" : $"{BangkokTime.FormatLong(date.Value, "th")} ({BangkokTime.FormatLong(date.Value, "en")})";

    private static string MovieTitle(ReceiptMovie movie) =>
        !string.IsNullOrEmpty(movie.TitleEn) && movie.TitleEn != movie.TitleTh ? $"{movie.TitleTh} ({movie.TitleEn})" : movie.TitleTh;

    public static EmailContent Build(ReceiptResponse receipt, string receiptUrl, string ticketUrl)
    {
        var issuer = receipt.Issuer;
        var showtime = receipt.Showtime;
        var payment = receipt.Payment;
        // ใบเสร็จส่วนต่างเปลี่ยนที่นั่งมีบรรทัดเดียวที่บอกว่าย้ายจากไหนไปไหน ส่วนใบหลักไล่ที่นั่งทุกบรรทัด
        var seatChange = receipt.Lines.OfType<SeatChangeReceiptLine>().FirstOrDefault();
        var seatRow = seatChange is not null
            ? ("ส่วนต่างเปลี่ยนที่นั่ง / Seat change", $"{string.Join(", ", seatChange.FromSeats)} → {string.Join(", ", seatChange.ToSeats)}")
            : ("ที่นั่ง / Seats", string.Join(", ", receipt.Lines.OfType<SeatsReceiptLine>().SelectMany(line => line.Seats)));
        var method = MethodLabel.GetValueOrDefault(payment.Method, payment.Method);

        var rows = new List<(string Label, string Value)>
        {
            ("เลขที่ / Receipt no.", receipt.ReceiptNo ?? ""),
            ("วันที่ / Date", BilingualDate(receipt.IssuedAt)),
            ("ได้รับเงินจาก / Received from", receipt.Customer.Name),
            ("รหัสการจอง / Booking code", receipt.Booking.Code),
            ("ภาพยนตร์ / Movie", MovieTitle(showtime.Movie)),
            ("รอบฉาย / Showtime", $"{BilingualDate(showtime.StartsAt)} · {showtime.Theatre.Name}"),
            seatRow,
            ("ชำระโดย / Paid via", $"{method} · Ref. {payment.Reference}"),
        };
        var total = $"{Money(receipt.TotalAmount)} บาท (THB)";
        var amountInWords = $"({receipt.AmountTextTh} / {receipt.AmountTextEn})";
        const string electronicNote = "ใบเสร็จนี้ออกโดยระบบอิเล็กทรอนิกส์ / This receipt was issued electronically.";

        var subject = $"ใบเสร็จรับเงิน / Receipt {receipt.ReceiptNo} · {issuer.Name}";

        var textLines = new List<string> { issuer.Name };
        if (!string.IsNullOrEmpty(issuer.Address)) textLines.Add(issuer.Address);
        textLines.Add("ใบเสร็จรับเงิน / Receipt");
        textLines.Add("");
        textLines.AddRange(rows.Select(row => $"{row.Label}: {row.Value}"));
        textLines.AddRange(
        [
            "",
            $"รวมทั้งสิ้น / Total: {total}",
            amountInWords,
            "",
            "เปิดหรือพิมพ์ใบเสร็จฉบับเต็ม / View or print the full receipt:",
            receiptUrl,
            "",
            "E-Ticket:",
            ticketUrl,
            "",
            electronicNote,
        ]);
        var text = string.Join('\n', textLines);

        // พื้นสว่างและกำหนดสีเองทั้งหมดเหมือนอีเมลตั้งรหัสผ่าน — อ่านได้ทั้งในโปรแกรมอ่านเมลที่เป็นธีมมืดและสว่าง
        // สีมาจาก palette ของ Design System (docs/design-system.md): ปุ่ม Gold 60 ตัวอักษร Cocoa 100/70 ลิงก์ Gold 80
        // ฟอนต์เว็บโหลดในอีเมลไม่ได้แน่นอน — ใส่ Inter / Noto Sans Thai ไว้หน้า เครื่องที่มีจะได้ใช้ ที่ไม่มีก็ตกไปที่ฟอนต์ระบบเดิม
        var rowHtml = string.Concat(rows.Select(row => $"""

      <tr>
        <td style="padding:6px 12px 6px 0;color:#605e5c;font-size:13px;vertical-align:top;white-space:nowrap">{Html.Escape(row.Label)}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#1c1a17">{Html.Escape(row.Value)}</td>
      </tr>
"""));

        var addressHtml = !string.IsNullOrEmpty(issuer.Address)
            ? $"""<p style="margin:4px 0 0;font-size:12px;color:#605e5c">{Html.Escape(issuer.Address)}</p>"""
            : "";

        var html = $"""
<div style="margin:0;padding:24px;background:#fff6e8;font-family:Inter,'Noto Sans Thai','Segoe UI',Tahoma,sans-serif;color:#1c1a17">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <p style="margin:0;font-size:18px;font-weight:700;color:#1c1a17">{Html.Escape(issuer.Name)}</p>
    {addressHtml}
    <p style="margin:24px 0 4px;font-size:12px;letter-spacing:1px;color:#605e5c">ใบเสร็จรับเงิน / RECEIPT</p>
    <p style="margin:0 0 16px;font-size:22px;font-weight:700;font-family:Inter,'Segoe UI',Tahoma,sans-serif;font-variant-numeric:tabular-nums;color:#1c1a17">{Html.Escape(receipt.ReceiptNo)}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">{rowHtml}
    </table>
    <div style="margin:20px 0 24px;padding:16px;border:1px solid #e8dfcf;border-radius:12px">
      <p style="margin:0;font-size:13px;color:#605e5c">รวมทั้งสิ้น / Total</p>
      <p style="margin:4px 0;font-size:24px;font-weight:700;color:#1c1a17">{Html.Escape(total)}</p>
      <p style="margin:0;font-size:13px;color:#605e5c">{Html.Escape(amountInWords)}</p>
    </div>
    <p style="margin:0 0 12px">
      <a href="{Html.Escape(receiptUrl)}"
         style="display:inline-block;background:#c89d56;color:#1c1a17;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px">
        เปิด / พิมพ์ใบเสร็จ · View receipt
      </a>
    </p>
    <p style="margin:0 0 24px;font-size:13px">
      <a href="{Html.Escape(ticketUrl)}" style="color:#8e6b33">E-Ticket</a>
    </p>
    <p style="margin:0;font-size:12px;color:#605e5c">{Html.Escape(electronicNote)}</p>
  </div>
</div>
""";

        return new EmailContent(subject, text, html);
    }
}
