using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

/// <summary>refresh token แบบ rotate — เก็บ sha256 hash เท่านั้น</summary>
public class RefreshToken : ICreatedAt
{
    public string Id { get; set; } = Cuid.New();
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedById { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }

    public User User { get; set; } = null!;
}
