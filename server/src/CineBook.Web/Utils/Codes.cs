using System.Security.Cryptography;

namespace CineBook.Web.Utils;

public static class Codes
{
    // ตัดตัวอักษรที่สับสนออก (0/O, 1/I/L) เพราะรหัสนี้ผู้ใช้ต้องอ่านออกเสียง/พิมพ์ตามหน้าเคาน์เตอร์
    private const string BookingAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private const string Digits = "0123456789";
    private const string FileIdAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

    /// <summary>รหัสการจองที่ผู้ใช้เห็น เช่น TRS-7K2QX9</summary>
    public static string GenerateBookingCode() => $"TRS-{RandomNumberGenerator.GetString(BookingAlphabet, 6)}";

    /// <summary>เลขอ้างอิงการชำระเงิน (ใช้เทียบกับสลิปตอน admin ตรวจ)</summary>
    public static string GeneratePaymentReference() => RandomNumberGenerator.GetString(Digits, 8);

    /// <summary>ส่วนสุ่มของชื่อไฟล์สลิป — ไม่ใช้ชื่อไฟล์จากผู้ใช้เลย กัน path traversal และชื่อซ้ำ</summary>
    public static string FileId(int length = 24) => RandomNumberGenerator.GetString(FileIdAlphabet, length);
}
