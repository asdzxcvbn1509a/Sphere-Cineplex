using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Web.Infrastructure.Config;
using CineBook.Web.Models.Entities;

namespace CineBook.Web.Infrastructure.Auth;

public sealed record AccessTokenPayload(string Sub, string Role, int Tv, long Iat, long Exp);

public enum AccessTokenError
{
    Invalid,
    Expired,
}

/// <summary>
/// access token แบบ JWT (HS256) รูปเดียวกับที่ jsonwebtoken ของฝั่ง Express ออกให้ทุกไบต์
/// payload มีแค่ { sub, role, tv, iat, exp } — หน้าเว็บอ่าน exp − iat ไปคำนวณเวลาต่ออายุล่วงหน้า
///
/// เขียนเองด้วย HMACSHA256 ของ .NET แทนไลบรารี JWT เพราะ:
/// - ใช้อัลกอริทึมเดียวทั้งตอนเซ็นและตอนตรวจ ไม่ปล่อยให้ header ของ token เป็นคนเลือกว่าจะตรวจด้วยอะไร
/// - secret เดิมยาวขั้นต่ำ 16 ตัวอักษร แต่ไลบรารีของ Microsoft ไม่ยอมรับ key HS256 ที่สั้นกว่า 32 ไบต์
/// - token ที่ Express ออกไปก่อนย้ายระบบยังใช้ต่อได้จนหมดอายุ (เซ็นด้วย secret เดิม แบบเดียวกัน)
/// ไม่ใส่เบอร์โทรหรือข้อมูลส่วนตัวอื่น — payload ของ JWT ใครถือ token ก็ถอดอ่านได้ และ server ก็อ่านผู้ใช้จากฐานข้อมูลทุกครั้งอยู่แล้ว
/// </summary>
public sealed class AccessTokens(AppConfig config, TimeProvider time)
{
    // header เดียวกับ jsonwebtoken: {"alg":"HS256","typ":"JWT"}
    private static readonly string EncodedHeader = Encode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"u8.ToArray());

    private readonly byte[] _key = Encoding.UTF8.GetBytes(config.JwtAccessSecret);

    /// <summary>
    /// ออก access token อายุสั้น เก็บไว้ใน memory ฝั่ง client เท่านั้น
    /// tv = tokenVersion ตอนออก — การยืนยันตัวตนเทียบกับค่าปัจจุบันในฐานข้อมูล เปลี่ยนรหัสผ่านแล้วใบเก่าใช้ไม่ได้ทันที
    /// </summary>
    public string Sign(User user)
    {
        var iat = time.GetUtcNow().ToUnixTimeSeconds();
        // jsonwebtoken: exp = floor(iat + ms(expiresIn) / 1000)
        var exp = (long)Math.Floor(iat + config.AccessTokenLifetimeMs / 1000);
        var payload = new JsonObject
        {
            ["sub"] = user.Id,
            ["role"] = user.Role.ToString(),
            ["tv"] = user.TokenVersion,
            ["iat"] = iat,
            ["exp"] = exp,
        };
        var encodedPayload = Encode(Encoding.UTF8.GetBytes(payload.ToJsonString()));
        var signingInput = $"{EncodedHeader}.{encodedPayload}";
        return $"{signingInput}.{Encode(HMACSHA256.HashData(_key, Encoding.ASCII.GetBytes(signingInput)))}";
    }

    /// <summary>ตรวจลายเซ็นและวันหมดอายุ — คืน payload หรือบอกว่าเสียเพราะอะไร (หมดอายุ / ไม่ถูกต้อง)</summary>
    public (AccessTokenPayload? Payload, AccessTokenError? Error) Verify(string token)
    {
        var parts = token.Split('.');
        if (parts.Length != 3) return (null, AccessTokenError.Invalid);

        try
        {
            var header = JsonNode.Parse(Decode(parts[0])) as JsonObject;
            if (header?["alg"]?.GetValue<string>() != "HS256") return (null, AccessTokenError.Invalid);

            var expected = HMACSHA256.HashData(_key, Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"));
            var presented = Decode(parts[2]);
            if (!CryptographicOperations.FixedTimeEquals(expected, presented)) return (null, AccessTokenError.Invalid);

            if (JsonNode.Parse(Decode(parts[1])) is not JsonObject payload) return (null, AccessTokenError.Invalid);
            var now = time.GetUtcNow().ToUnixTimeSeconds();
            var exp = payload["exp"]?.GetValue<double>();
            if (exp is not null && now >= exp) return (null, AccessTokenError.Expired);
            var nbf = payload["nbf"]?.GetValue<double>();
            if (nbf is not null && now < nbf) return (null, AccessTokenError.Invalid);

            var sub = payload["sub"]?.GetValue<string>();
            if (sub is null) return (null, AccessTokenError.Invalid);
            return (new AccessTokenPayload(
                sub,
                payload["role"]?.GetValue<string>() ?? "",
                // token รุ่นก่อนมี tokenVersion ไม่มี tv เลย — ถือเป็น -1 ให้ได้ 401 ครั้งเดียวแล้วหน้าเว็บขอใบใหม่ให้เอง
                payload["tv"] is JsonValue tv && tv.TryGetValue<int>(out var version) ? version : -1,
                (long)(payload["iat"]?.GetValue<double>() ?? 0),
                (long)(exp ?? 0)), null);
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException or ArgumentException)
        {
            return (null, AccessTokenError.Invalid);
        }
    }

    private static string Encode(byte[] bytes) => System.Buffers.Text.Base64Url.EncodeToString(bytes);

    private static byte[] Decode(string value) => System.Buffers.Text.Base64Url.DecodeFromChars(value);
}
