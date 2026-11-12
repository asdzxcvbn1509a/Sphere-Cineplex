using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Web.Infrastructure;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace CineBook.Web.Data;

/// <summary>
/// ฐานข้อมูลของระบบ — schema ตรงกับที่ Prisma สร้างไว้ทุกชื่อ (ตาราง PascalCase, คอลัมน์ camelCase, ชื่อ index/constraint เดิม)
/// ฐานที่ใช้งานอยู่แล้วจึงรับมาใช้ได้เลยโดยไม่ต้องย้ายข้อมูล และโค้ดที่จับ error ตามชื่อ constraint (เช่นที่นั่งชนกัน) ยังใช้ชื่อเดิมได้
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<Movie> Movies => Set<Movie>();
    public DbSet<Theatre> Theatres => Set<Theatre>();
    public DbSet<Seat> Seats => Set<Seat>();
    public DbSet<Showtime> Showtimes => Set<Showtime>();
    public DbSet<ZonePrice> ZonePrices => Set<ZonePrice>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<BookingSeat> BookingSeats => Set<BookingSeat>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<SeatChange> SeatChanges => Set<SeatChange>();
    public DbSet<ReceiptCounter> ReceiptCounters => Set<ReceiptCounter>();
    public DbSet<Notification> Notifications => Set<Notification>();

    /// <summary>ชื่อ constraint กันจองซ้ำ — error ที่ชนชื่อนี้คือ "มีคนจองที่นั่งนั้นตัดหน้าไปแล้ว"</summary>
    public const string SeatUniqueConstraint = "BookingSeat_showtimeId_seatId_key";

    private const string Timestamp = "timestamp(3) without time zone";

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Prisma ไม่สร้าง index ให้ foreign key เอง — ปิด convention ของ EF ไว้ ไม่งั้นได้ index เกินจาก schema เดิม
        configurationBuilder.Conventions.Remove<ForeignKeyIndexConvention>();

        // เวลาเก็บเป็น timestamp(3) without time zone แต่ค่าข้างในคือ UTC (แบบที่ Prisma เขียนไว้)
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>().HaveColumnType(Timestamp);
        configurationBuilder.Properties<DateTime?>().HaveConversion<UtcNullableDateTimeConverter>().HaveColumnType(Timestamp);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // ลำดับ label ต้องตรงกับฐานเดิม (ลำดับที่ migration ของ Prisma สร้าง/เพิ่มไว้) — enum ของ PostgreSQL เรียงตามลำดับนี้
        // ไม่ระบุเอง EF จะเรียงตามตัวอักษร ฐานใหม่กับฐานเดิมจะเรียงสถานะไม่เหมือนกัน
        PostgresEnum<Role>(modelBuilder);
        PostgresEnum<MovieStatus>(modelBuilder);
        PostgresEnum<SeatZone>(modelBuilder);
        PostgresEnum<ShowtimeStatus>(modelBuilder);
        PostgresEnum<BookingStatus>(modelBuilder);
        PostgresEnum<PaymentStatus>(modelBuilder);
        PostgresEnum<PaymentKind>(modelBuilder);
        PostgresEnum<SeatChangeStatus>(modelBuilder);
        PostgresEnum<NotificationType>(modelBuilder);

        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("User");
            Key(e, "User");
            e.Property(x => x.Role).HasDefaultValue(Role.USER).ValueGeneratedNever();
            e.Property(x => x.TokenVersion).HasDefaultValue(0).ValueGeneratedNever();
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.Email).IsUnique().HasDatabaseName("User_email_key");
            e.HasIndex(x => x.Phone).IsUnique().HasDatabaseName("User_phone_key");
        });

        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.ToTable("RefreshToken");
            Key(e, "RefreshToken");
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.TokenHash).IsUnique().HasDatabaseName("RefreshToken_tokenHash_key");
            e.HasIndex(x => x.UserId).HasDatabaseName("RefreshToken_userId_idx");
            e.HasOne(x => x.User).WithMany(u => u.RefreshTokens).HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("RefreshToken_userId_fkey");
        });

        modelBuilder.Entity<PasswordResetToken>(e =>
        {
            e.ToTable("PasswordResetToken");
            Key(e, "PasswordResetToken");
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.TokenHash).IsUnique().HasDatabaseName("PasswordResetToken_tokenHash_key");
            e.HasIndex(x => x.UserId).HasDatabaseName("PasswordResetToken_userId_idx");
            e.HasOne(x => x.User).WithMany(u => u.PasswordResets).HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("PasswordResetToken_userId_fkey");
        });

        modelBuilder.Entity<Movie>(e =>
        {
            e.ToTable("Movie");
            Key(e, "Movie");
            e.Property(x => x.Rating).HasDefaultValue("G").ValueGeneratedNever();
            // Prisma สร้าง text[] แบบรับ NULL ได้ แต่ทุกแถวที่เขียนผ่านระบบมีค่าเสมอ (อย่างน้อยเป็นรายการว่าง)
            e.Property(x => x.Genres).HasColumnType("text[]").IsRequired(false);
            e.Property(x => x.Status).HasDefaultValue(MovieStatus.NOW_SHOWING).ValueGeneratedNever();
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.Status).HasDatabaseName("Movie_status_idx");
        });

        modelBuilder.Entity<Theatre>(e =>
        {
            e.ToTable("Theatre");
            Key(e, "Theatre");
            e.Property(x => x.ScreenType).HasDefaultValue("2D").ValueGeneratedNever();
            e.Property(x => x.IsActive).HasDefaultValue(true).ValueGeneratedNever();
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.Name).IsUnique().HasDatabaseName("Theatre_name_key");
        });

        modelBuilder.Entity<Seat>(e =>
        {
            e.ToTable("Seat");
            Key(e, "Seat");
            e.Property(x => x.Zone).HasDefaultValue(SeatZone.NORMAL).ValueGeneratedNever();
            e.Property(x => x.IsActive).HasDefaultValue(true).ValueGeneratedNever();
            e.HasIndex(x => new { x.TheatreId, x.RowLabel, x.SeatNumber }).IsUnique()
                .HasDatabaseName("Seat_theatreId_rowLabel_seatNumber_key");
            e.HasIndex(x => x.TheatreId).HasDatabaseName("Seat_theatreId_idx");
            e.HasOne(x => x.Theatre).WithMany(t => t.Seats).HasForeignKey(x => x.TheatreId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Seat_theatreId_fkey");
        });

        modelBuilder.Entity<Showtime>(e =>
        {
            e.ToTable("Showtime");
            Key(e, "Showtime");
            e.Property(x => x.Status).HasDefaultValue(ShowtimeStatus.SCHEDULED).ValueGeneratedNever();
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => new { x.TheatreId, x.StartsAt }).IsUnique().HasDatabaseName("Showtime_theatreId_startsAt_key");
            e.HasIndex(x => new { x.MovieId, x.StartsAt }).HasDatabaseName("Showtime_movieId_startsAt_idx");
            e.HasIndex(x => x.StartsAt).HasDatabaseName("Showtime_startsAt_idx");
            e.HasOne(x => x.Movie).WithMany(m => m.Showtimes).HasForeignKey(x => x.MovieId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Showtime_movieId_fkey");
            e.HasOne(x => x.Theatre).WithMany(t => t.Showtimes).HasForeignKey(x => x.TheatreId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Showtime_theatreId_fkey");
        });

        modelBuilder.Entity<ZonePrice>(e =>
        {
            e.ToTable("ZonePrice");
            Key(e, "ZonePrice");
            e.HasIndex(x => new { x.ShowtimeId, x.Zone }).IsUnique().HasDatabaseName("ZonePrice_showtimeId_zone_key");
            e.HasOne(x => x.Showtime).WithMany(s => s.ZonePrices).HasForeignKey(x => x.ShowtimeId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("ZonePrice_showtimeId_fkey");
        });

        modelBuilder.Entity<Booking>(e =>
        {
            e.ToTable("Booking");
            Key(e, "Booking");
            e.Property(x => x.Status).HasDefaultValue(BookingStatus.PENDING_PAYMENT).ValueGeneratedNever();
            Json(e.Property(x => x.SeatSnapshot));
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("Booking_code_key");
            e.HasIndex(x => new { x.UserId, x.Status }).HasDatabaseName("Booking_userId_status_idx");
            e.HasIndex(x => new { x.Status, x.HoldExpiresAt }).HasDatabaseName("Booking_status_holdExpiresAt_idx");
            e.HasIndex(x => x.ShowtimeId).HasDatabaseName("Booking_showtimeId_idx");
            e.HasOne(x => x.User).WithMany(u => u.Bookings).HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Booking_userId_fkey");
            e.HasOne(x => x.Showtime).WithMany(s => s.Bookings).HasForeignKey(x => x.ShowtimeId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Booking_showtimeId_fkey");
        });

        modelBuilder.Entity<BookingSeat>(e =>
        {
            e.ToTable("BookingSeat");
            Key(e, "BookingSeat");
            e.HasIndex(x => new { x.ShowtimeId, x.SeatId }).IsUnique().HasDatabaseName(SeatUniqueConstraint);
            e.HasIndex(x => x.BookingId).HasDatabaseName("BookingSeat_bookingId_idx");
            e.HasIndex(x => x.SeatChangeId).HasDatabaseName("BookingSeat_seatChangeId_idx");
            e.HasOne(x => x.Booking).WithMany(b => b.Seats).HasForeignKey(x => x.BookingId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("BookingSeat_bookingId_fkey");
            e.HasOne(x => x.Showtime).WithMany(s => s.BookingSeats).HasForeignKey(x => x.ShowtimeId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("BookingSeat_showtimeId_fkey");
            e.HasOne(x => x.Seat).WithMany(s => s.BookingSeats).HasForeignKey(x => x.SeatId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("BookingSeat_seatId_fkey");
            e.HasOne(x => x.SeatChange).WithMany(c => c.HeldSeats).HasForeignKey(x => x.SeatChangeId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("BookingSeat_seatChangeId_fkey");
        });

        modelBuilder.Entity<Payment>(e =>
        {
            e.ToTable("Payment", t =>
            {
                // ใบหลักต้องผูก mainBookingId และไม่มี seatChangeId · รายการส่วนต่างกลับกัน
                // ด่านสุดท้ายระดับฐานข้อมูล ถ้าโค้ดสร้างรายการผิดชนิด insert จะล้มทันทีแทนที่จะได้ใบหลักซ้อนกันสองใบ
                t.HasCheckConstraint(
                    "Payment_kind_main_check",
                    "((kind = 'BOOKING'::\"PaymentKind\") = (\"mainBookingId\" IS NOT NULL))");
                t.HasCheckConstraint(
                    "Payment_kind_seat_change_check",
                    "((kind = 'BOOKING'::\"PaymentKind\") = (\"seatChangeId\" IS NULL))");
            });
            Key(e, "Payment");
            e.Property(x => x.Kind).HasDefaultValue(PaymentKind.BOOKING).ValueGeneratedNever();
            e.Property(x => x.Method).HasDefaultValue("PROMPTPAY").ValueGeneratedNever();
            e.Property(x => x.Status).HasDefaultValue(PaymentStatus.AWAITING_SLIP).ValueGeneratedNever();
            NullableJson(e.Property(x => x.ReceiptSeats));
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.MainBookingId).IsUnique().HasDatabaseName("Payment_mainBookingId_key");
            e.HasIndex(x => x.SeatChangeId).IsUnique().HasDatabaseName("Payment_seatChangeId_key");
            e.HasIndex(x => x.ReceiptNo).IsUnique().HasDatabaseName("Payment_receiptNo_key");
            e.HasIndex(x => x.Status).HasDatabaseName("Payment_status_idx");
            e.HasIndex(x => x.BookingId).HasDatabaseName("Payment_bookingId_idx");
            e.HasOne(x => x.Booking).WithMany(b => b.Payments).HasForeignKey(x => x.BookingId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Payment_bookingId_fkey");
            e.HasOne(x => x.MainOf).WithOne(b => b.Payment).HasForeignKey<Payment>(x => x.MainBookingId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Payment_mainBookingId_fkey");
            e.HasOne(x => x.SeatChange).WithOne(c => c.Payment).HasForeignKey<Payment>(x => x.SeatChangeId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Payment_seatChangeId_fkey");
            e.HasOne(x => x.VerifiedBy).WithMany(u => u.VerifiedPayments).HasForeignKey(x => x.VerifiedById)
                .OnDelete(DeleteBehavior.SetNull).HasConstraintName("Payment_verifiedById_fkey");
            e.HasOne(x => x.RefundedBy).WithMany(u => u.RefundedPayments).HasForeignKey(x => x.RefundedById)
                .OnDelete(DeleteBehavior.SetNull).HasConstraintName("Payment_refundedById_fkey");
        });

        modelBuilder.Entity<SeatChange>(e =>
        {
            e.ToTable("SeatChange");
            Key(e, "SeatChange");
            Json(e.Property(x => x.FromSeats));
            Json(e.Property(x => x.ToSeats));
            e.Property(x => x.ByAdmin).HasDefaultValue(false).ValueGeneratedNever();
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => new { x.BookingId, x.Status }).HasDatabaseName("SeatChange_bookingId_status_idx");
            e.HasIndex(x => new { x.Status, x.HoldExpiresAt }).HasDatabaseName("SeatChange_status_holdExpiresAt_idx");
            e.HasOne(x => x.Booking).WithMany(b => b.SeatChanges).HasForeignKey(x => x.BookingId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("SeatChange_bookingId_fkey");
            e.HasOne(x => x.Admin).WithMany(u => u.SeatChangesMade).HasForeignKey(x => x.AdminId)
                .OnDelete(DeleteBehavior.SetNull).HasConstraintName("SeatChange_adminId_fkey");
        });

        modelBuilder.Entity<ReceiptCounter>(e =>
        {
            e.ToTable("ReceiptCounter");
            e.HasKey(x => x.Year).HasName("ReceiptCounter_pkey");
            e.Property(x => x.Year).ValueGeneratedNever();
        });

        modelBuilder.Entity<Notification>(e =>
        {
            e.ToTable("Notification");
            Key(e, "Notification");
            e.Property(x => x.Data).HasColumnType("jsonb").HasConversion(
                new ValueConverter<JsonObject?, string?>(
                    v => v == null ? null : v.ToJsonString(JsonDefaults.Storage),
                    v => v == null ? null : JsonNode.Parse(v, null, default) as JsonObject),
                new ValueComparer<JsonObject?>(
                    (a, b) => JsonNode.DeepEquals(a, b),
                    v => v == null ? 0 : v.ToJsonString(JsonDefaults.Storage).GetHashCode(),
                    v => v == null ? null : (JsonObject?)v.DeepClone()));
            CreatedAt(e.Property(x => x.CreatedAt));
            e.HasIndex(x => new { x.UserId, x.ReadAt }).HasDatabaseName("Notification_userId_readAt_idx");
            e.HasIndex(x => new { x.UserId, x.CreatedAt }).HasDatabaseName("Notification_userId_createdAt_idx");
            e.HasOne(x => x.User).WithMany(u => u.Notifications).HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade).HasConstraintName("Notification_userId_fkey");
        });

        // คอลัมน์ทุกตัวเป็น camelCase ตามชื่อฟิลด์ใน schema.prisma (Id → id, TitleTh → titleTh)
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(JsonNamingPolicy.CamelCase.ConvertName(property.Name));
            }
        }
    }

    private static void PostgresEnum<TEnum>(ModelBuilder modelBuilder) where TEnum : struct, Enum =>
        modelBuilder.HasPostgresEnum(typeof(TEnum).Name, Enum.GetNames<TEnum>());

    private static void Key<T>(EntityTypeBuilder<T> entity, string table) where T : class
    {
        entity.HasKey("Id").HasName($"{table}_pkey");
        entity.Property<string>("Id").ValueGeneratedNever();
    }

    private static void CreatedAt(PropertyBuilder<DateTime> property) =>
        property.HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedNever();

    private static void Json(PropertyBuilder<List<SeatSnapshot>> property) =>
        property.HasColumnType("jsonb").HasConversion(SeatListConverter, SeatListComparer);

    private static void NullableJson(PropertyBuilder<List<SeatSnapshot>?> property) =>
        property.HasColumnType("jsonb").HasConversion(NullableSeatListConverter, NullableSeatListComparer);

    private static readonly ValueConverter<List<SeatSnapshot>, string> SeatListConverter = new(
        v => JsonSerializer.Serialize(v, JsonDefaults.Storage),
        v => JsonSerializer.Deserialize<List<SeatSnapshot>>(v, JsonDefaults.Storage) ?? new List<SeatSnapshot>());

    private static readonly ValueComparer<List<SeatSnapshot>> SeatListComparer = new(
        (a, b) => a!.SequenceEqual(b!),
        v => v.Aggregate(0, (hash, seat) => HashCode.Combine(hash, seat.GetHashCode())),
        v => v.ToList());

    private static readonly ValueConverter<List<SeatSnapshot>?, string?> NullableSeatListConverter = new(
        v => v == null ? null : JsonSerializer.Serialize(v, JsonDefaults.Storage),
        v => v == null ? null : JsonSerializer.Deserialize<List<SeatSnapshot>>(v, JsonDefaults.Storage));

    private static readonly ValueComparer<List<SeatSnapshot>?> NullableSeatListComparer = new(
        (a, b) => a == null ? b == null : b != null && a.SequenceEqual(b),
        v => v == null ? 0 : v.Aggregate(0, (hash, seat) => HashCode.Combine(hash, seat.GetHashCode())),
        v => v == null ? null : v.ToList());
}

/// <summary>เขียนเป็นเวลา UTC แบบไม่มีเขตเวลา (ตัดเหลือมิลลิวินาที) · อ่านกลับเป็น Kind = Utc</summary>
public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    v => DateTime.SpecifyKind(Clock.TruncateToMs(v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v), DateTimeKind.Unspecified),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public sealed class UtcNullableDateTimeConverter() : ValueConverter<DateTime?, DateTime?>(
    v => v.HasValue
        ? DateTime.SpecifyKind(Clock.TruncateToMs(v.Value.Kind == DateTimeKind.Local ? v.Value.ToUniversalTime() : v.Value), DateTimeKind.Unspecified)
        : v,
    v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
