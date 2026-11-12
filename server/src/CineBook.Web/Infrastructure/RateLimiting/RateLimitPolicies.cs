using System.Net;
using System.Net.Sockets;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Utils;

namespace CineBook.Web.Infrastructure.RateLimiting;

public enum RateLimitSkip
{
    /// <summary>นับทุกคำขอ</summary>
    None,
    /// <summary>นับเฉพาะคำขอที่ไม่สำเร็จ (status ≥ 400) — คนใช้งานปกติจึงไม่มีวันโดนบล็อก</summary>
    SuccessfulRequests,
    /// <summary>นับเฉพาะคำขอที่สำเร็จ (status &lt; 400)</summary>
    FailedRequests,
}

/// <summary>ข้อมูลของคำขอที่ตัวสร้างกุญแจใช้ได้ — body ที่ bind แล้ว (ถ้ามี) ผู้ใช้ และไอพี</summary>
public sealed record RateLimitRequest(HttpContext Http, IDictionary<string, object?> Arguments)
{
    public string Ip => RateLimitKeys.IpKey(Http.Connection.RemoteIpAddress);

    public CurrentUser? User => Http.OptionalUser();

    public T? Body<T>() where T : class => Arguments.Values.OfType<T>().FirstOrDefault();
}

public sealed record RateLimitPolicy(
    string Name,
    Func<AppConfig, int> Limit,
    Func<AppConfig, TimeSpan> Window,
    RateLimitSkip Skip,
    Func<RateLimitRequest, string> Key,
    string Code,
    string Message);

public static class RateLimitKeys
{
    /// <summary>
    /// กุญแจของไอพี — เหมือน ipKeyGenerator ของ express-rate-limit: IPv4 ใช้ตรง ๆ, IPv4 ที่ห่อเป็น IPv6 แกะออก
    /// และ IPv6 ใช้ทั้ง subnet /56 (ผู้ให้บริการแจก /56 ให้บ้านหนึ่งหลัง เปลี่ยนเลขท้ายเองหลบโควตาไม่ได้)
    /// </summary>
    public static string IpKey(IPAddress? address)
    {
        if (address is null) return "unknown";
        if (address.IsIPv4MappedToIPv6) return address.MapToIPv4().ToString();
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return address.ToString();
        var bytes = address.GetAddressBytes();
        bytes[7] = 0;
        for (var i = 8; i < bytes.Length; i += 1) bytes[i] = 0;
        return $"{new IPAddress(bytes)}/56";
    }
}

/// <summary>
/// โควตาทั้งหมดของระบบ — ตัวเลข กุญแจ และข้อความตรงกับ express-rate-limit ที่ตั้งไว้ใน routes เดิม
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// กันการยิงเดารหัสผ่าน — นับเฉพาะครั้งที่ล็อกอินไม่ผ่าน คนที่ใช้งานปกติจึงไม่มีวันโดนบล็อก
    /// นับแยกตาม "ไอพี + บัญชีที่พยายามเข้า" เพื่อไม่ให้คนร้ายยิงบัญชีเดียวจนล็อกเจ้าของตัวจริงที่อยู่คนละไอพี
    /// บัญชีใช้ LoginIdentifier.Key ซึ่ง normalize แบบเดียวกับตอนค้นบัญชี — 081-234-5678 กับ 0812345678 ต้องนับเป็นบัญชีเดียวกัน
    /// </summary>
    public static readonly RateLimitPolicy Login = new(
        "login",
        c => c.LoginLimit,
        c => TimeSpan.FromMinutes(c.LoginWindowMinutes),
        RateLimitSkip.SuccessfulRequests,
        r => $"{r.Ip}|{LoginIdentifier.Key(r.Body<Models.Requests.LoginRequest>()?.Identifier)}",
        "LOGIN_RATE_LIMITED",
        "พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันสคริปต์สมัครบัญชีรัว ๆ จากไอพีเดียว — นับเฉพาะครั้งที่สมัครสำเร็จ
    /// คนที่กรอกผิดหรือสมัครซ้ำหลายรอบจะได้ไม่โดนบล็อกทั้งที่ยังไม่ได้บัญชีสักใบ
    /// </summary>
    public static readonly RateLimitPolicy Register = new(
        "register",
        c => c.RegisterLimit,
        c => TimeSpan.FromMinutes(c.RegisterWindowMinutes),
        RateLimitSkip.FailedRequests,
        r => r.Ip,
        "REGISTER_RATE_LIMITED",
        "สมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันสคริปต์ใช้หน้าสมัครไล่เช็กว่าอีเมล/เบอร์ไหนมีบัญชีแล้ว (สมัครซ้ำได้ EMAIL_TAKEN/PHONE_TAKEN แต่ตัวบนนับเฉพาะที่สำเร็จ)
    /// นับเฉพาะครั้งที่ไม่สำเร็จ ต่อไอพี — ตั้งหลวมพอให้คนจริงที่กรอกผิดหลายรอบ หรือหลายคนในออฟฟิศเดียวกันไม่โดน
    /// </summary>
    public static readonly RateLimitPolicy RegisterFailure = new(
        "registerFailure",
        _ => 30,
        _ => TimeSpan.FromMinutes(15),
        RateLimitSkip.SuccessfulRequests,
        r => r.Ip,
        "REGISTER_RATE_LIMITED",
        "สมัครสมาชิกไม่สำเร็จหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันการเดา "รหัสผ่านปัจจุบัน" จากเซสชันที่ถูกขโมยไป — ทั้งตอนเปลี่ยนรหัสผ่านและตอนเปลี่ยนอีเมล (นับรวมกัน)
    /// นับรายบัญชี ไม่ใช่รายไอพี เพราะคนร้ายที่ถือ token อยู่ย้ายไอพีได้ง่ายกว่าเปลี่ยนบัญชี
    /// </summary>
    public static readonly RateLimitPolicy CurrentPassword = new(
        "currentPassword",
        c => c.LoginLimit,
        c => TimeSpan.FromMinutes(c.LoginWindowMinutes),
        RateLimitSkip.SuccessfulRequests,
        r => r.User?.Id ?? r.Ip,
        "LOGIN_RATE_LIMITED",
        "กรอกรหัสผ่านปัจจุบันผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันเอาระบบไปถล่มเมลคนอื่นเล่น และกันไล่เช็กว่าอีเมลไหนมีบัญชีในระบบ
    /// นับตาม (ไอพี + อีเมล) ไม่ใช่อีเมลอย่างเดียว ไม่งั้นคนร้ายยิงขอลิงก์ของเหยื่อรัว ๆ จนเต็มโควตา
    /// เจ้าของตัวจริงก็จะขอลิงก์ไม่ได้ กลายเป็นล็อกไม่ให้เขากู้บัญชีเสียเอง
    /// </summary>
    public static readonly RateLimitPolicy ForgotPassword = new(
        "forgotPassword",
        c => c.PasswordResetLimit,
        c => TimeSpan.FromMinutes(c.PasswordResetWindowMinutes),
        RateLimitSkip.None,
        r => $"{r.Ip}|{(r.Body<Models.Requests.ForgotPasswordRequest>()?.Email ?? "").Trim().ToLowerInvariant()}",
        "RESET_RATE_LIMITED",
        "ขอลิงก์ตั้งรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// token สุ่ม 32 ไบต์เดาไม่ได้อยู่แล้ว ตัวนี้จึงเป็นแค่กันเหนียวไม่ให้ใครยิงถี่ ๆ ใส่ endpoint นี้
    /// ตั้งไว้หลวมพอที่คนกดลิงก์แล้วรีเฟรชหน้าหลายรอบจะไม่โดนบล็อก
    /// </summary>
    public static readonly RateLimitPolicy ResetPassword = new(
        "resetPassword",
        _ => 60,
        c => TimeSpan.FromMinutes(c.PasswordResetWindowMinutes),
        RateLimitSkip.None,
        r => r.Ip,
        "RESET_RATE_LIMITED",
        "ลองตั้งรหัสผ่านใหม่บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันสคริปต์วนจอง-ยกเลิกจนที่นั่งกระพริบให้คนอื่นจองไม่ได้ — นับเฉพาะการจองที่สำเร็จ ต่อบัญชี
    /// </summary>
    public static readonly RateLimitPolicy CreateBooking = new(
        "createBooking",
        _ => 10,
        _ => TimeSpan.FromMinutes(10),
        RateLimitSkip.FailedRequests,
        r => r.User?.Id ?? r.Ip,
        "BOOKING_RATE_LIMITED",
        "ทำรายการจองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>กันการสลับที่นั่งไปมารัว ๆ — นับเฉพาะคำขอที่สำเร็จ ต่อบัญชี</summary>
    public static readonly RateLimitPolicy SeatChange = new(
        "seatChange",
        _ => 10,
        _ => TimeSpan.FromMinutes(10),
        RateLimitSkip.FailedRequests,
        r => r.User?.Id ?? r.Ip,
        "SEAT_CHANGE_RATE_LIMITED",
        "ขอเปลี่ยนที่นั่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    /// <summary>
    /// กันสคริปต์อัปโหลดสลิปวนรัว ๆ — ทุกครั้งที่อัปโหลด ไฟล์ถูกอ่านเข้า memory และเขียนลงที่เก็บก่อน
    /// service จะตรวจว่าเป็นเจ้าของการจองหรือไม่ แล้วค่อยลบทิ้งเมื่อไม่ผ่าน คนที่ไม่ได้เป็นเจ้าของก็ทำให้เปลืองได้
    /// ลูกค้าจริงส่งสลิปไม่กี่ครั้งต่อการจอง จึงนับทุกคำขอต่อบัญชี — ใช้ตัวเดียวกันทั้งสลิปค่าตั๋วและสลิปส่วนต่าง โควตาจึงรวมกัน
    /// </summary>
    public static readonly RateLimitPolicy SlipUpload = new(
        "slipUpload",
        _ => 20,
        _ => TimeSpan.FromHours(1),
        RateLimitSkip.None,
        r => r.User?.Id ?? r.Ip,
        "SLIP_RATE_LIMITED",
        "ส่งสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");

    public static readonly IReadOnlyDictionary<string, RateLimitPolicy> All = new[]
    {
        Login, Register, RegisterFailure, CurrentPassword, ForgotPassword, ResetPassword, CreateBooking, SeatChange, SlipUpload,
    }.ToDictionary(p => p.Name);
}
