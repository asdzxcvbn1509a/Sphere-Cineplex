using Microsoft.EntityFrameworkCore.Migrations;

namespace CineBook.Web.Data.Migrations;

/// <summary>
/// ส่วนของ schema ที่ EF Core สร้างเองไม่ได้ แต่ฐานเดิมที่ Prisma สร้างมี — ใส่ไว้ให้ฐานใหม่กับฐานเดิมเหมือนกันทุกจุด
/// (ตรวจด้วยการ diff pg_dump --schema-only ของสองฐาน ดู docs/testing.md)
/// </summary>
public static class PrismaParity
{
    private sealed record ForeignKey(string Table, string Column, string References, string OnDelete);

    private static readonly ForeignKey[] ForeignKeys =
    [
        new("Booking", "showtimeId", "Showtime", "CASCADE"),
        new("Booking", "userId", "User", "CASCADE"),
        new("BookingSeat", "bookingId", "Booking", "CASCADE"),
        new("BookingSeat", "seatChangeId", "SeatChange", "CASCADE"),
        new("BookingSeat", "seatId", "Seat", "CASCADE"),
        new("BookingSeat", "showtimeId", "Showtime", "CASCADE"),
        new("Notification", "userId", "User", "CASCADE"),
        new("PasswordResetToken", "userId", "User", "CASCADE"),
        new("Payment", "bookingId", "Booking", "CASCADE"),
        new("Payment", "mainBookingId", "Booking", "CASCADE"),
        new("Payment", "refundedById", "User", "SET NULL"),
        new("Payment", "seatChangeId", "SeatChange", "CASCADE"),
        new("Payment", "verifiedById", "User", "SET NULL"),
        new("RefreshToken", "userId", "User", "CASCADE"),
        new("SeatChange", "adminId", "User", "SET NULL"),
        new("SeatChange", "bookingId", "Booking", "CASCADE"),
        new("Seat", "theatreId", "Theatre", "CASCADE"),
        new("Showtime", "movieId", "Movie", "CASCADE"),
        new("Showtime", "theatreId", "Theatre", "CASCADE"),
        new("ZonePrice", "showtimeId", "Showtime", "CASCADE"),
    ];

    /// <summary>
    /// foreign key ของ Prisma มี ON UPDATE CASCADE ทุกตัว แต่ EF Core ระบุ ON UPDATE ไม่ได้ จึงสร้างใหม่ด้วย SQL ตรง
    /// (id ไม่เคยถูกแก้ ผลจริงจึงเหมือนกัน — ทำไว้ให้ schema ตรงกันเป๊ะ เทียบฐานใหม่กับฐานเดิมแล้วไม่มีส่วนต่างให้สงสัย)
    /// </summary>
    public static void ApplyForeignKeyOnUpdateCascade(MigrationBuilder migrationBuilder)
    {
        foreach (var fk in ForeignKeys)
        {
            var name = $"{fk.Table}_{fk.Column}_fkey";
            migrationBuilder.Sql(
                $"""
                ALTER TABLE "{fk.Table}" DROP CONSTRAINT "{name}",
                  ADD CONSTRAINT "{name}" FOREIGN KEY ("{fk.Column}") REFERENCES "{fk.References}"(id) ON UPDATE CASCADE ON DELETE {fk.OnDelete};
                """);
        }
    }
}
