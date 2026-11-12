using System.Text.Json.Nodes;
using CineBook.Web.Utils;

namespace CineBook.Web.Models.Entities;

public class Notification : ICreatedAt
{
    public string Id { get; set; } = Cuid.New();
    public string UserId { get; set; } = "";
    public NotificationType Type { get; set; }
    public string TitleTh { get; set; } = "";
    public string TitleEn { get; set; } = "";
    public string BodyTh { get; set; } = "";
    public string BodyEn { get; set; } = "";
    /// <summary>ส่วนใหญ่เป็น { bookingId } (และ seatChangeId / showtimeId) — หน้าเว็บใช้พาไปหน้าที่เกี่ยวข้อง</summary>
    public JsonObject? Data { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public User User { get; set; } = null!;
}
