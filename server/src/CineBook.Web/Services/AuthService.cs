using System.Security.Cryptography;
using CineBook.Web.Data;
using CineBook.Web.Emails;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Infrastructure.Email;
using CineBook.Web.Infrastructure.Errors;
using CineBook.Web.Models.Entities;
using CineBook.Web.Models.Responses;
using CineBook.Web.Utils;
using Microsoft.EntityFrameworkCore;

namespace CineBook.Web.Services;

/// <summary>บัญชีผู้ใช้ เซสชัน และรหัสผ่าน (port จาก services/auth.js)</summary>
public sealed class AuthService(
    AppDbContext db,
    AppConfig config,
    TimeProvider time,
    AccessTokens accessTokens,
    PasswordHasher passwords,
    IMailer mailer)
{
    /// <summary>
    /// ใบที่เพิ่งถูก rotate ไปไม่เกินเท่านี้ ถือว่าเป็นคำขอที่ชนกันจากเบราว์เซอร์เดียวกัน ไม่ใช่ token ถูกขโมย
    /// (เปิดหลายแท็บพร้อมกัน — ทุกแท็บส่ง cookie ใบเดียวกันมาต่ออายุในเสี้ยววินาทีเดียวกัน)
    /// ตั้งไว้สั้นเพราะช่วงนี้เท่ากับช่วงที่ "การใช้ซ้ำ" ไม่ถูกนับเป็นการขโมย — คำขอที่ชนกันจริงห่างกันไม่ถึงวินาที
    /// </summary>
    private static readonly TimeSpan RefreshRaceGrace = TimeSpan.FromSeconds(10);

    /// <summary>
    /// เพิกถอนทุกเซสชันที่ยังใช้ได้ของผู้ใช้ — except = refresh token ของเครื่องที่ให้คงไว้ (ไม่ส่ง = ไม่เว้นเครื่องไหน)
    /// เรียกใน transaction ได้ (ใช้ DbContext เดียวกับ transaction ที่เปิดอยู่)
    /// </summary>
    public static Task<int> RevokeAllSessionsAsync(AppDbContext db, string userId, DateTime at, string? except = null)
    {
        var query = db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null);
        if (except is not null)
        {
            var keepHash = RefreshTokens.Hash(except);
            query = query.Where(t => t.TokenHash != keepHash);
        }
        return query.ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, at));
    }

    /// <summary>ข้อความเดียวกันทุกกรณีที่ล็อกอินไม่ผ่าน — ไม่บอกว่าผิดที่บัญชีหรือรหัสผ่าน</summary>
    private static ApiException InvalidCredentials() =>
        ApiException.Unauthorized("INVALID_CREDENTIALS", "อีเมล/เบอร์โทรศัพท์ หรือรหัสผ่านไม่ถูกต้อง");

    /// <summary>แปลง unique constraint เป็นข้อความที่ชี้ช่องที่ต้องแก้ได้</summary>
    private static ApiException DuplicateFieldError(IEnumerable<string> fields)
    {
        var list = fields.ToList();
        if (list.Contains("email")) return ApiException.Conflict("EMAIL_TAKEN", "อีเมลนี้ถูกใช้สมัครไปแล้ว กรุณาเข้าสู่ระบบแทน");
        if (list.Contains("phone")) return ApiException.Conflict("PHONE_TAKEN", "เบอร์โทรศัพท์นี้ถูกใช้สมัครไปแล้ว กรุณาเข้าสู่ระบบแทน");
        return ApiException.Conflict("DUPLICATE", "ข้อมูลซ้ำกับบัญชีที่มีอยู่แล้ว");
    }

    /// <summary>
    /// สมัครสมาชิก — อีเมลใช้เป็นชื่อผู้ใช้หลัก ส่วนเบอร์โทรเก็บไว้ติดต่อและใช้ล็อกอินได้เหมือนกัน
    /// สมัครเสร็จถือว่าล็อกอินให้เลย ผู้ใช้จะได้กลับไปจองที่นั่งต่อได้ทันทีโดยไม่ต้องกรอกซ้ำ
    /// </summary>
    public async Task<SessionResult> RegisterAsync(string name, string email, string phone, string password, string? userAgent)
    {
        var normalizedEmail = LoginIdentifier.NormalizeEmail(email);
        var normalizedPhone = Phone.RequireThaiMobile(phone);

        // เช็กก่อนเพื่อให้ได้ข้อความที่ชี้ช่องถูก — ส่วน unique index ใน DB เป็นด่านสุดท้ายกันสมัครพร้อมกัน
        var existing = await db.Users.AsNoTracking()
            .Where(u => u.Email == normalizedEmail || u.Phone == normalizedPhone)
            .Select(u => new { u.Email, u.Phone })
            .FirstOrDefaultAsync();
        if (existing is not null)
        {
            throw DuplicateFieldError([existing.Email == normalizedEmail ? "email" : "phone"]);
        }

        try
        {
            var user = new User
            {
                Name = name.Trim(),
                Email = normalizedEmail,
                Phone = normalizedPhone,
                PasswordHash = passwords.Hash(password),
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return await IssueSessionAsync(user, userAgent);
        }
        catch (DbUpdateException error) when (ApiExceptionMiddleware.IsUniqueViolation(error, out var fields))
        {
            throw DuplicateFieldError(fields);
        }
    }

    /// <summary>
    /// เข้าสู่ระบบด้วยอีเมลหรือเบอร์โทรศัพท์ก็ได้ — ดูจากว่ามี @ อยู่ในสิ่งที่กรอกมาหรือไม่
    /// LoginIdentifier.Lookup ตัวเดียวกับที่ rate limit ใช้ทำกุญแจ โควตาจึงนับตรงกับบัญชีที่ค้นเจอจริง
    /// </summary>
    public async Task<SessionResult> LoginAsync(string identifier, string password, string? userAgent)
    {
        var lookup = LoginIdentifier.Lookup(identifier);
        User? user = null;
        if (lookup?.Email is { } email) user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == email);
        else if (lookup?.Phone is { } phone) user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Phone == phone);

        // เทียบรหัสผ่านเสมอแม้ไม่เจอบัญชี เพื่อให้เวลาที่ใช้ตอบใกล้เคียงกันทุกกรณี
        var matched = passwords.Verify(password, user?.PasswordHash ?? passwords.DummyHash);
        if (user is null || !matched) throw InvalidCredentials();

        return await IssueSessionAsync(user, userAgent);
    }

    public async Task<SessionResult> IssueSessionAsync(User user, string? userAgent)
    {
        var (token, tokenHash) = RefreshTokens.Generate();
        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = tokenHash,
            ExpiresAt = RefreshTokens.Expiry(config, time),
            UserAgent = Truncate(userAgent, 255),
        });
        await db.SaveChangesAsync();
        return new SessionResult(UserResponse.From(user), accessTokens.Sign(user), token);
    }

    /// <summary>ตอบให้ฝั่งเว็บรอแป๊บแล้วลองใหม่ — ถึงตอนนั้น cookie ในเบราว์เซอร์จะเป็นใบใหม่ที่อีกแท็บเพิ่งได้ไปแล้ว</summary>
    private static ApiException RefreshRace() =>
        ApiException.Conflict("REFRESH_RACE", "กำลังต่ออายุเซสชันจากอีกแท็บ กรุณาลองใหม่อีกครั้ง");

    /// <summary>
    /// ต่ออายุเซสชันแบบ rotate — ใบเก่าถูก revoke ทันทีที่ออกใบใหม่
    /// ถ้ามีใครเอาใบที่ revoke แล้วมาใช้ซ้ำ = token ถูกขโมย → เพิกถอนทุกเซสชันของ user คนนั้น
    ///
    /// ยกเว้นใบที่เพิ่งถูก rotate ไปไม่กี่วินาที (RefreshRaceGrace) ซึ่งตอบ 409 REFRESH_RACE แทน
    /// ไม่ออกเซสชันใหม่ให้ — คนที่ถือใบเก่าจึงไม่ได้อะไรไป แต่ก็ไม่เตะเจ้าของออกจากทุกอุปกรณ์เพราะเปิดหลายแท็บ
    /// </summary>
    public async Task<SessionResult> RotateSessionAsync(string? rawToken, string? userAgent)
    {
        if (string.IsNullOrEmpty(rawToken))
        {
            throw ApiException.Unauthorized("NO_REFRESH_TOKEN", "ไม่พบเซสชัน กรุณาเข้าสู่ระบบใหม่");
        }

        var tokenHash = RefreshTokens.Hash(rawToken);
        var stored = await db.RefreshTokens.AsNoTracking().Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == tokenHash);
        if (stored is null)
        {
            throw ApiException.Unauthorized("INVALID_REFRESH_TOKEN", "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่");
        }

        var now = time.UtcNowMs();
        if (stored.RevokedAt is { } revokedAt)
        {
            // มี replacedById = ถูก rotate ตามปกติ (ไม่ใช่ถูกเพิกถอนเพราะ logout/เปลี่ยนรหัส)
            var justRotated = stored.ReplacedById is not null && now - revokedAt < RefreshRaceGrace;
            if (justRotated) throw RefreshRace();

            await RevokeAllSessionsAsync(db, stored.UserId, now);
            throw ApiException.Unauthorized(
                "REFRESH_TOKEN_REUSED",
                "ตรวจพบการใช้เซสชันซ้ำ ระบบได้ออกจากระบบทุกอุปกรณ์เพื่อความปลอดภัย");
        }

        if (stored.ExpiresAt <= now)
        {
            throw ApiException.Unauthorized("REFRESH_TOKEN_EXPIRED", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        }

        var (nextToken, nextHash) = RefreshTokens.Generate();
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var created = new RefreshToken
            {
                UserId = stored.UserId,
                TokenHash = nextHash,
                ExpiresAt = RefreshTokens.Expiry(config, time),
                UserAgent = Truncate(userAgent, 255),
            };
            db.RefreshTokens.Add(created);
            await db.SaveChangesAsync();
            // เพิกถอนใบเก่าได้ก็ต่อเมื่อยังไม่มีใครเพิกถอนไปก่อน — สองคำขอที่อ่านใบเดียวกันมาพร้อมกัน
            // จะได้ใบใหม่แค่คำขอเดียว อีกคำขอได้ REFRESH_RACE (ใบใหม่ที่สร้างไว้ถูก rollback ทิ้ง)
            var count = await db.RefreshTokens
                .Where(t => t.Id == stored.Id && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, time.UtcNowMs()).SetProperty(t => t.ReplacedById, created.Id));
            if (count == 0) throw RefreshRace();
            await tx.CommitAsync();
        }

        return new SessionResult(UserResponse.From(stored.User), accessTokens.Sign(stored.User), nextToken);
    }

    public async Task RevokeSessionAsync(string? rawToken)
    {
        if (string.IsNullOrEmpty(rawToken)) return;
        var tokenHash = RefreshTokens.Hash(rawToken);
        var now = time.UtcNowMs();
        await db.RefreshTokens
            .Where(t => t.TokenHash == tokenHash && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));
    }

    /// <summary>
    /// เปลี่ยนรหัสผ่านด้วยตัวเอง — ต้องยืนยันรหัสเดิมก่อน
    /// ถ้ามีใครขโมยเซสชันไปได้ จะได้ยึดบัญชีทั้งใบด้วยการเปลี่ยนรหัสไม่ได้
    ///
    /// เปลี่ยนสำเร็จแล้วเพิกถอนเซสชันอื่นทั้งหมด เหลือแค่เครื่องที่กำลังใช้อยู่
    /// เพราะเหตุผลหลักที่คนเปลี่ยนรหัสคือสงสัยว่ารหัสรั่ว การไล่เครื่องอื่นออกจึงเป็นสิ่งที่คาดหวัง
    /// </summary>
    public async Task<string> ChangePasswordAsync(string userId, string currentPassword, string newPassword, string? keepToken)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw ApiException.NotFound("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");

        if (!passwords.Verify(currentPassword, user.PasswordHash))
        {
            throw ApiException.BadRequest("WRONG_PASSWORD", "รหัสผ่านปัจจุบันไม่ถูกต้อง");
        }

        // tokenVersion +1 = access token ทุกใบที่ออกก่อนหน้าใช้ไม่ได้ทันที
        // เครื่องที่กดเปลี่ยนเองได้ใบใหม่กลับไปในคำตอบเลย ไม่ต้องไปเจอ 401 ก่อน (refresh token ของเครื่องนี้ก็ยังใช้ได้ — keepToken)
        var hash = passwords.Hash(newPassword);
        var now = time.UtcNowMs();
        await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s
            .SetProperty(u => u.PasswordHash, hash)
            .SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1)
            .SetProperty(u => u.UpdatedAt, now));
        var updated = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);

        await RevokeAllSessionsAsync(db, userId, time.UtcNowMs(), keepToken);
        return accessTokens.Sign(updated);
    }

    /// <summary>
    /// ปิดอีเมลไว้บางส่วนตอนเอาไปแสดงบนหน้าเว็บ
    /// คนที่ถือลิงก์จะได้ยืนยันว่าเป็นบัญชีของตัวเองจริง โดยที่ลิงก์หลุดไปก็ไม่ประกาศอีเมลเต็ม ๆ ให้คนอื่น
    /// </summary>
    public static string MaskEmail(string? email)
    {
        var parts = (email ?? "").Split('@');
        var name = parts[0];
        var domain = parts.Length > 1 ? parts[1] : "";
        var head = name.Length > 2 ? name[..2] : name;
        // จำนวนดาวคงที่ไม่เกิน 6 ตัว ไม่ได้ไล่ตามความยาวจริง — ความยาวอีเมลก็เป็นข้อมูลที่ไม่ต้องบอก
        var hidden = Math.Min(Math.Max(name.Length - head.Length, 1), 6);
        return $"{head}{new string('*', hidden)}@{domain}";
    }

    /// <summary>ลิงก์ผิด/ถูกใช้ไปแล้ว ใช้ข้อความเดียวกัน — ไม่บอกคนที่เดา token ว่าเดาใกล้เคียงแค่ไหน</summary>
    private static ApiException InvalidResetLink() =>
        ApiException.BadRequest("RESET_LINK_INVALID", "ลิงก์ตั้งรหัสผ่านนี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่อีกครั้ง");

    private async Task<PasswordResetToken> FindLiveResetTokenAsync(string? rawToken)
    {
        var token = rawToken ?? "";
        if (token.Length == 0) throw InvalidResetLink();

        var tokenHash = RefreshTokens.Hash(token);
        var stored = await db.PasswordResetTokens.AsNoTracking().Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == tokenHash);
        if (stored is null || stored.UsedAt is not null) throw InvalidResetLink();
        if (stored.ExpiresAt <= time.UtcNowMs())
        {
            // แยกรหัสจากกรณีลิงก์ผิด เพราะ "หมดอายุ" ผู้ใช้แก้เองได้ด้วยการขอใหม่ ไม่ใช่ความผิดพลาดของเขา
            throw ApiException.BadRequest(
                "RESET_LINK_EXPIRED",
                $"ลิงก์ตั้งรหัสผ่านหมดอายุแล้ว (ลิงก์มีอายุ {config.PasswordResetTtlMinutes} นาที) กรุณาขอลิงก์ใหม่อีกครั้ง");
        }
        return stored;
    }

    public sealed record ResetRequestResult(bool Ok, int TtlMinutes, string? DevResetUrl);

    /// <summary>
    /// ขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล
    ///
    /// ตอบ ok เหมือนกันทุกครั้งไม่ว่าอีเมลนั้นจะมีบัญชีอยู่จริงหรือไม่
    /// ไม่งั้นหน้านี้จะกลายเป็นเครื่องมือไล่เช็กว่าอีเมลไหนเป็นลูกค้าของเราบ้าง
    /// </summary>
    public async Task<ResetRequestResult> RequestPasswordResetAsync(string email, string? lang, string? ip)
    {
        // ตอบเหมือนกันทุกกรณี รวมถึงอายุลิงก์ที่หน้าเว็บเอาไปบอกผู้ใช้ว่าต้องกดภายในกี่นาที
        var answer = new ResetRequestResult(true, config.PasswordResetTtlMinutes, null);

        var normalized = LoginIdentifier.NormalizeEmail(email);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == normalized);
        if (user is null) return answer;

        // 32 ไบต์สุ่ม = เดาไม่ได้ในทางปฏิบัติ · base64url ใส่ใน query string ได้โดยไม่ต้อง encode
        var token = System.Buffers.Text.Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            // ขอใบใหม่แล้วใบเก่าใช้ไม่ได้ทันที (และเป็นการเก็บกวาดใบที่หมดอายุไปในตัว)
            // คนที่กด "ส่งอีกครั้ง" จะได้ไม่ต้องเดาว่าต้องเปิดเมลฉบับไหน — ฉบับล่าสุดเสมอ
            await db.PasswordResetTokens.Where(t => t.UserId == user.Id).ExecuteDeleteAsync();
            db.PasswordResetTokens.Add(new PasswordResetToken
            {
                UserId = user.Id,
                TokenHash = RefreshTokens.Hash(token),
                ExpiresAt = time.UtcNowMs().AddMinutes(config.PasswordResetTtlMinutes),
                RequestIp = ip,
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }

        var resetUrl = $"{config.AppUrl}/reset-password?token={token}";
        var result = await mailer.SendAsync(user.Email, PasswordResetEmail.Build(user.Name, resetUrl, config.PasswordResetTtlMinutes, lang));

        // ตอนพัฒนาที่ยังไม่ได้ตั้ง SMTP ส่งลิงก์กลับไปให้หน้าเว็บด้วย จะได้ทดสอบจนจบขั้นตอนได้โดยไม่ต้องมีเมลเซิร์ฟเวอร์
        // เงื่อนไขผูกกับโหมด Development ด้วย ต่อให้ลืมตั้ง SMTP ตอนขึ้นจริง ลิงก์ก็ไม่หลุดออกไปทาง API
        var exposeLink = config.IsDevelopment && !config.IsMailConfigured && !result.Delivered;
        return answer with { DevResetUrl = exposeLink ? resetUrl : null };
    }

    public sealed record ResetCheckResult(string Email, string Name, DateTime ExpiresAt);

    /// <summary>ตรวจลิงก์ก่อนแสดงฟอร์ม ผู้ใช้จะได้ไม่ตั้งรหัสใหม่จนเสร็จแล้วค่อยมารู้ว่าลิงก์หมดอายุ</summary>
    public async Task<ResetCheckResult> CheckResetTokenAsync(string? token)
    {
        var stored = await FindLiveResetTokenAsync(token);
        return new ResetCheckResult(MaskEmail(stored.User.Email), stored.User.Name, stored.ExpiresAt);
    }

    /// <summary>
    /// ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล
    ///
    /// เสร็จแล้วเพิกถอนเซสชันของบัญชีนั้น "ทุกเครื่อง" ไม่เว้นเครื่องไหนเลย
    /// ต่างจากการเปลี่ยนรหัสเองที่หน้าโปรไฟล์ เพราะกรณีนี้คนตั้งรหัสยังไม่ได้ล็อกอิน
    /// และเหตุผลที่ต้องรีเซ็ตมักเป็นเพราะบัญชีอาจถูกคนอื่นเข้าถึงอยู่
    /// </summary>
    public async Task<string> ResetPasswordAsync(string? token, string password)
    {
        var stored = await FindLiveResetTokenAsync(token);
        var passwordHash = passwords.Hash(password);
        var now = time.UtcNowMs();

        // ลำดับล็อก PasswordResetToken → User → RefreshToken ให้ตรงกับ UpdateProfileAsync
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            // ลิงก์ใช้ได้ครั้งเดียวจริง ๆ — สองคำขอที่ถือลิงก์เดียวกันมาพร้อมกันผ่าน FindLiveResetTokenAsync ได้ทั้งคู่
            // เงื่อนไข "ยังไม่ถูกใช้" อยู่ใน where จึงมีคำขอเดียวที่ปิดลิงก์ได้ อีกคำขอได้ข้อความเดียวกับลิงก์ที่ใช้ไปแล้ว
            var count = await db.PasswordResetTokens
                .Where(t => t.Id == stored.Id && t.UsedAt == null && t.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now));
            if (count == 0) throw InvalidResetLink();

            // ลิงก์อื่นของบัญชีนี้ที่ยังค้างอยู่ก็ใช้ไม่ได้อีก (ปกติไม่มี เพราะขอลิงก์ใหม่แล้วใบเก่าถูกลบ)
            await db.PasswordResetTokens
                .Where(t => t.UserId == stored.UserId && t.UsedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now));
            await db.Users.Where(u => u.Id == stored.UserId).ExecuteUpdateAsync(s => s
                .SetProperty(u => u.PasswordHash, passwordHash)
                .SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1)
                .SetProperty(u => u.UpdatedAt, now));
            await RevokeAllSessionsAsync(db, stored.UserId, now);
            await tx.CommitAsync();
        }

        // คืนอีเมลเต็มให้หน้าเว็บเอาไปเติมในช่องล็อกอินต่อ — คนที่ถือลิงก์คือคนที่เปิดเมลฉบับนั้นได้อยู่แล้ว
        return stored.User.Email;
    }

    /// <summary>
    /// แก้ข้อมูลของตัวเอง — แก้ชื่ออย่างเดียวไม่ต้องยืนยันอะไร
    ///
    /// เปลี่ยนอีเมลต้องยืนยันรหัสผ่านปัจจุบันก่อน แบบเดียวกับการเปลี่ยนรหัสผ่าน เพราะอีเมลคือช่องทางกู้บัญชี (ลืมรหัสผ่าน)
    /// ถ้าเปลี่ยนได้ด้วย access token อย่างเดียว คนที่ขโมยเซสชันไปได้จะเปลี่ยนเป็นอีเมลของตัวเอง
    /// แล้วขอลิงก์ตั้งรหัสใหม่ ยึดบัญชีไปถาวร และการรีเซ็ตยังเตะเจ้าของตัวจริงออกจากทุกเครื่องด้วย
    /// </summary>
    public async Task<UserResponse> UpdateProfileAsync(string userId, string? name, string? email, string? currentPassword)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw ApiException.NotFound("USER_NOT_FOUND", "ไม่พบบัญชีผู้ใช้");

        var nextEmail = email is null ? null : LoginIdentifier.NormalizeEmail(email);
        var emailChanged = nextEmail is not null && nextEmail != user.Email;
        if (emailChanged)
        {
            if (string.IsNullOrEmpty(currentPassword))
            {
                throw ApiException.BadRequest("CURRENT_PASSWORD_REQUIRED", "กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนอีเมล");
            }
            if (!passwords.Verify(currentPassword, user.PasswordHash))
            {
                throw ApiException.BadRequest("WRONG_PASSWORD", "รหัสผ่านปัจจุบันไม่ถูกต้อง");
            }
        }

        try
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            // ลิงก์ตั้งรหัสผ่านที่ส่งไปอีเมลเดิมต้องใช้ไม่ได้อีก — ลบก่อนแก้ผู้ใช้ ตามลำดับล็อกเดียวกับ ResetPasswordAsync
            if (emailChanged) await db.PasswordResetTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
            if (name is not null) user.Name = name;
            if (emailChanged) user.Email = nextEmail!;
            db.Entry(user).Property(u => u.UpdatedAt).CurrentValue = time.UtcNowMs();
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return UserResponse.From(user);
        }
        catch (DbUpdateException error) when (ApiExceptionMiddleware.IsUniqueViolation(error, out var fields))
        {
            throw DuplicateFieldError(fields);
        }
    }

    private static string? Truncate(string? value, int max) => value is null ? null : value.Length > max ? value[..max] : value;
}
