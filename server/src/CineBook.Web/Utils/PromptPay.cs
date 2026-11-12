using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace CineBook.Web.Utils;

/// <summary>
/// สร้าง payload มาตรฐาน EMVCo สำหรับ PromptPay (อัลกอริทึมเดียวกับไลบรารี promptpay-qr ที่ฝั่ง Express ใช้)
///
/// QR ที่ได้เป็น payload มาตรฐานที่สแกนจ่ายได้จริง ปลายทางคือหมายเลขพร้อมเพย์ใน PROMPTPAY_ID
/// ระบบไม่ได้ต่อกับธนาคารเพื่อตรวจยอดเข้าอัตโนมัติ การยืนยันการชำระเงินจึงทำโดย Admin ตรวจสลิปที่ผู้ใช้อัปโหลดเข้ามา
/// </summary>
public static partial class PromptPay
{
    private const string IdPayloadFormat = "00";
    private const string IdPoiMethod = "01";
    private const string IdMerchantInformationBot = "29";
    private const string IdTransactionCurrency = "53";
    private const string IdTransactionAmount = "54";
    private const string IdCountryCode = "58";
    private const string IdCrc = "63";

    private const string PayloadFormatEmvQrcpsMerchantPresentedMode = "01";
    private const string PoiMethodStatic = "11";
    private const string PoiMethodDynamic = "12";
    private const string MerchantInformationTemplateIdGuid = "00";
    private const string BotIdMerchantPhoneNumber = "01";
    private const string BotIdMerchantTaxId = "02";
    private const string BotIdMerchantEwalletId = "03";
    private const string GuidPromptPay = "A000000677010111";
    private const string TransactionCurrencyThb = "764";
    private const string CountryCodeTh = "TH";

    [GeneratedRegex("[^0-9]")]
    private static partial Regex NonDigit();

    /// <param name="target">เบอร์โทร / เลขผู้เสียภาษี / e-wallet ID ของผู้รับเงิน</param>
    /// <param name="amountBaht">ยอดเงิน (บาท) — 0 = QR แบบไม่ระบุยอด</param>
    public static string CreatePayload(string target, decimal amountBaht)
    {
        var sanitized = Sanitize(target);
        var targetType = sanitized.Length >= 15
            ? BotIdMerchantEwalletId
            : sanitized.Length >= 13 ? BotIdMerchantTaxId : BotIdMerchantPhoneNumber;

        var data = new List<string>
        {
            Field(IdPayloadFormat, PayloadFormatEmvQrcpsMerchantPresentedMode),
            Field(IdPoiMethod, amountBaht != 0 ? PoiMethodDynamic : PoiMethodStatic),
            Field(IdMerchantInformationBot,
                Field(MerchantInformationTemplateIdGuid, GuidPromptPay) + Field(targetType, FormatTarget(sanitized))),
            Field(IdCountryCode, CountryCodeTh),
            Field(IdTransactionCurrency, TransactionCurrencyThb),
        };
        if (amountBaht != 0) data.Add(Field(IdTransactionAmount, amountBaht.ToString("0.00", CultureInfo.InvariantCulture)));

        var dataToCrc = string.Concat(data) + IdCrc + "04";
        data.Add(Field(IdCrc, Crc16Ccitt(dataToCrc)));
        return string.Concat(data);
    }

    private static string Field(string id, string value) =>
        id + value.Length.ToString("00", CultureInfo.InvariantCulture)[^2..] + value;

    private static string Sanitize(string id) => NonDigit().Replace(id, "");

    private static string FormatTarget(string numbers)
    {
        if (numbers.Length >= 13) return numbers;
        var withCountry = numbers.StartsWith('0') ? $"66{numbers[1..]}" : numbers;
        return ("0000000000000" + withCountry)[^13..];
    }

    /// <summary>CRC-16/CCITT-FALSE — checksum ที่ EMVCo ใช้ปิดท้าย payload (tag 63)</summary>
    public static string Crc16Ccitt(string input)
    {
        var crc = 0xffff;
        foreach (var b in Encoding.UTF8.GetBytes(input))
        {
            crc ^= b << 8;
            for (var bit = 0; bit < 8; bit += 1)
            {
                crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
            }
        }
        return crc.ToString("X4", CultureInfo.InvariantCulture);
    }

    /// <summary>แยก payload เป็น map ของ tag → value (เฉพาะระดับบนสุด)</summary>
    public static Dictionary<string, string> ParseTlv(string payload)
    {
        var result = new Dictionary<string, string>();
        var cursor = 0;
        while (cursor + 4 <= payload.Length)
        {
            var tag = payload.Substring(cursor, 2);
            if (!int.TryParse(payload.AsSpan(cursor + 2, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var length))
            {
                break;
            }
            var start = cursor + 4;
            result[tag] = payload.Substring(start, Math.Min(length, payload.Length - start));
            cursor += 4 + length;
        }
        return result;
    }

    /// <summary>ตรวจว่า checksum ท้าย payload ถูกต้อง</summary>
    public static bool IsValidPayload(string? payload)
    {
        if (payload is null || payload.Length < 8) return false;
        var body = payload[..^4];
        var checksum = payload[^4..];
        if (!body.EndsWith("6304", StringComparison.Ordinal)) return false;
        return Crc16Ccitt(body) == checksum;
    }
}
