using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace CineBook.Web.Data;

/// <summary>
/// SQL ตรงสำหรับงานที่ LINQ เขียนไม่ได้หรือไม่ควรปล่อยให้ EF เรียงลำดับเอง
/// (ล็อกแถว FOR SHARE / FOR UPDATE, ตัวนับใบเสร็จแบบ ON CONFLICT … RETURNING, insert ที่นั่งตามลำดับ seatId)
/// ใช้ connection และ transaction เดียวกับ DbContext เสมอ — ล็อกที่ได้มาจึงอยู่จนจบ transaction ของรายการนั้น
/// </summary>
public static class Sql
{
    private static async Task<DbCommand> CommandAsync(AppDbContext db, string sql, IEnumerable<NpgsqlParameter> parameters)
    {
        await db.Database.OpenConnectionAsync();
        var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var parameter in parameters) command.Parameters.Add(parameter);
        return command;
    }

    public static async Task<object?> ScalarAsync(AppDbContext db, string sql, params NpgsqlParameter[] parameters)
    {
        await using var command = await CommandAsync(db, sql, parameters);
        var value = await command.ExecuteScalarAsync();
        return value is DBNull ? null : value;
    }

    /// <summary>อ่านแถวแรก (ไม่มี = default) ด้วยตัวแปลงที่ส่งมา</summary>
    public static async Task<T?> FirstOrDefaultAsync<T>(
        AppDbContext db, string sql, Func<DbDataReader, T> map, params NpgsqlParameter[] parameters)
    {
        await using var command = await CommandAsync(db, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? map(reader) : default;
    }

    public static Task<int> ExecuteAsync(AppDbContext db, string sql, params NpgsqlParameter[] parameters) =>
        db.Database.ExecuteSqlRawAsync(sql, parameters.Cast<object>());

    public static NpgsqlParameter P(string name, object? value) => new(name, value ?? DBNull.Value);

    /// <summary>
    /// เพิ่มแถว BookingSeat ใน INSERT เดียวตามลำดับที่ส่งมา (เรียง seatId ไว้แล้ว)
    /// ไม่ใช้ SaveChanges เพราะ EF เรียงคำสั่ง insert ตามคีย์ของแถว (id สุ่ม) ไม่ใช่ตามที่นั่ง
    /// สองรายการที่แย่งที่นั่งชุดเดียวกันต้องชน unique index ที่ที่นั่งแรกเหมือนกัน ไม่งั้นรอกันเองจน deadlock
    /// </summary>
    public static Task<int> InsertBookingSeatsAsync(
        AppDbContext db,
        string bookingId,
        string showtimeId,
        IReadOnlyList<(string SeatId, int Price)> seats,
        string? seatChangeId = null)
    {
        if (seats.Count == 0) return Task.FromResult(0);
        var values = new List<string>();
        var parameters = new List<NpgsqlParameter>
        {
            P("booking", bookingId),
            P("showtime", showtimeId),
            P("change", seatChangeId),
        };
        for (var i = 0; i < seats.Count; i += 1)
        {
            values.Add($"(@id{i}, @booking, @showtime, @seat{i}, @price{i}, @change)");
            parameters.Add(P($"id{i}", Utils.Cuid.New()));
            parameters.Add(P($"seat{i}", seats[i].SeatId));
            parameters.Add(P($"price{i}", seats[i].Price));
        }
        var sql = "INSERT INTO \"BookingSeat\" (\"id\", \"bookingId\", \"showtimeId\", \"seatId\", \"price\", \"seatChangeId\") VALUES " +
            string.Join(", ", values);
        return ExecuteAsync(db, sql, [.. parameters]);
    }
}
