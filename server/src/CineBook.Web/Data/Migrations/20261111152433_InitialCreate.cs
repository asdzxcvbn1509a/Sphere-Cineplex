using System;
using System.Collections.Generic;
using CineBook.Web.Models.Entities;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CineBook.Web.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:Enum:BookingStatus", "PENDING_PAYMENT,PENDING_VERIFICATION,PAID,CANCELLED,EXPIRED")
                .Annotation("Npgsql:Enum:MovieStatus", "NOW_SHOWING,COMING_SOON,ARCHIVED")
                .Annotation("Npgsql:Enum:NotificationType", "PAYMENT_APPROVED,PAYMENT_REJECTED,BOOKING_CANCELLED,BOOKING_EXPIRED,SHOWTIME_REMINDER,REFUND_COMPLETED,SHOWTIME_CANCELLED,LATE_PAYMENT_REFUND,SEATS_CHANGED,SEAT_CHANGE_REJECTED,SEAT_CHANGE_EXPIRED,SEAT_CHANGE_LATE_REFUND")
                .Annotation("Npgsql:Enum:PaymentKind", "BOOKING,SEAT_CHANGE_TOPUP,SEAT_CHANGE_REFUND")
                .Annotation("Npgsql:Enum:PaymentStatus", "AWAITING_SLIP,PENDING_VERIFICATION,APPROVED,REJECTED,REFUND_PENDING,REFUNDED")
                .Annotation("Npgsql:Enum:Role", "USER,ADMIN")
                .Annotation("Npgsql:Enum:SeatChangeStatus", "PENDING_PAYMENT,PENDING_VERIFICATION,COMPLETED,CANCELLED,EXPIRED")
                .Annotation("Npgsql:Enum:SeatZone", "NORMAL,PREMIUM,SOFA")
                .Annotation("Npgsql:Enum:ShowtimeStatus", "SCHEDULED,CANCELLED");

            migrationBuilder.CreateTable(
                name: "Movie",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    titleTh = table.Column<string>(type: "text", nullable: false),
                    titleEn = table.Column<string>(type: "text", nullable: false),
                    synopsisTh = table.Column<string>(type: "text", nullable: false),
                    synopsisEn = table.Column<string>(type: "text", nullable: false),
                    posterUrl = table.Column<string>(type: "text", nullable: false),
                    backdropUrl = table.Column<string>(type: "text", nullable: true),
                    durationMin = table.Column<int>(type: "integer", nullable: false),
                    rating = table.Column<string>(type: "text", nullable: false, defaultValue: "G"),
                    genres = table.Column<List<string>>(type: "text[]", nullable: true),
                    releaseDate = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    status = table.Column<MovieStatus>(type: "\"MovieStatus\"", nullable: false, defaultValue: MovieStatus.NOW_SHOWING),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Movie_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "ReceiptCounter",
                columns: table => new
                {
                    year = table.Column<int>(type: "integer", nullable: false),
                    lastNo = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("ReceiptCounter_pkey", x => x.year);
                });

            migrationBuilder.CreateTable(
                name: "Theatre",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    screenType = table.Column<string>(type: "text", nullable: false, defaultValue: "2D"),
                    rowsCount = table.Column<int>(type: "integer", nullable: false),
                    colsCount = table.Column<int>(type: "integer", nullable: false),
                    isActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Theatre_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "User",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    email = table.Column<string>(type: "text", nullable: false),
                    phone = table.Column<string>(type: "text", nullable: false),
                    passwordHash = table.Column<string>(type: "text", nullable: false),
                    tokenVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    name = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<Role>(type: "\"Role\"", nullable: false, defaultValue: Role.USER),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("User_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "Seat",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    theatreId = table.Column<string>(type: "text", nullable: false),
                    rowLabel = table.Column<string>(type: "text", nullable: false),
                    seatNumber = table.Column<int>(type: "integer", nullable: false),
                    zone = table.Column<SeatZone>(type: "\"SeatZone\"", nullable: false, defaultValue: SeatZone.NORMAL),
                    isActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Seat_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Seat_theatreId_fkey",
                        column: x => x.theatreId,
                        principalTable: "Theatre",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Showtime",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    movieId = table.Column<string>(type: "text", nullable: false),
                    theatreId = table.Column<string>(type: "text", nullable: false),
                    startsAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    endsAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    basePrice = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<ShowtimeStatus>(type: "\"ShowtimeStatus\"", nullable: false, defaultValue: ShowtimeStatus.SCHEDULED),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Showtime_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Showtime_movieId_fkey",
                        column: x => x.movieId,
                        principalTable: "Movie",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Showtime_theatreId_fkey",
                        column: x => x.theatreId,
                        principalTable: "Theatre",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Notification",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    type = table.Column<NotificationType>(type: "\"NotificationType\"", nullable: false),
                    titleTh = table.Column<string>(type: "text", nullable: false),
                    titleEn = table.Column<string>(type: "text", nullable: false),
                    bodyTh = table.Column<string>(type: "text", nullable: false),
                    bodyEn = table.Column<string>(type: "text", nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: true),
                    readAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("Notification_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Notification_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PasswordResetToken",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    tokenHash = table.Column<string>(type: "text", nullable: false),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    usedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    requestIp = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PasswordResetToken_pkey", x => x.id);
                    table.ForeignKey(
                        name: "PasswordResetToken_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RefreshToken",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    tokenHash = table.Column<string>(type: "text", nullable: false),
                    expiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    revokedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    replacedById = table.Column<string>(type: "text", nullable: true),
                    userAgent = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("RefreshToken_pkey", x => x.id);
                    table.ForeignKey(
                        name: "RefreshToken_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Booking",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    code = table.Column<string>(type: "text", nullable: false),
                    userId = table.Column<string>(type: "text", nullable: false),
                    showtimeId = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<BookingStatus>(type: "\"BookingStatus\"", nullable: false, defaultValue: BookingStatus.PENDING_PAYMENT),
                    totalAmount = table.Column<int>(type: "integer", nullable: false),
                    holdExpiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    seatSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    cancelReason = table.Column<string>(type: "text", nullable: true),
                    reminderSentAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false),
                    paidAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    cancelledAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    expiredAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Booking_pkey", x => x.id);
                    table.ForeignKey(
                        name: "Booking_showtimeId_fkey",
                        column: x => x.showtimeId,
                        principalTable: "Showtime",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Booking_userId_fkey",
                        column: x => x.userId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ZonePrice",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    showtimeId = table.Column<string>(type: "text", nullable: false),
                    zone = table.Column<SeatZone>(type: "\"SeatZone\"", nullable: false),
                    price = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("ZonePrice_pkey", x => x.id);
                    table.ForeignKey(
                        name: "ZonePrice_showtimeId_fkey",
                        column: x => x.showtimeId,
                        principalTable: "Showtime",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SeatChange",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    bookingId = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<SeatChangeStatus>(type: "\"SeatChangeStatus\"", nullable: false),
                    fromSeats = table.Column<string>(type: "jsonb", nullable: false),
                    toSeats = table.Column<string>(type: "jsonb", nullable: false),
                    fromAmount = table.Column<int>(type: "integer", nullable: false),
                    toAmount = table.Column<int>(type: "integer", nullable: false),
                    diffAmount = table.Column<int>(type: "integer", nullable: false),
                    holdExpiresAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    expiredAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    completedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    reason = table.Column<string>(type: "text", nullable: true),
                    closeReason = table.Column<string>(type: "text", nullable: true),
                    byAdmin = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    adminId = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("SeatChange_pkey", x => x.id);
                    table.ForeignKey(
                        name: "SeatChange_adminId_fkey",
                        column: x => x.adminId,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "SeatChange_bookingId_fkey",
                        column: x => x.bookingId,
                        principalTable: "Booking",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookingSeat",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    bookingId = table.Column<string>(type: "text", nullable: false),
                    showtimeId = table.Column<string>(type: "text", nullable: false),
                    seatId = table.Column<string>(type: "text", nullable: false),
                    price = table.Column<int>(type: "integer", nullable: false),
                    seatChangeId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("BookingSeat_pkey", x => x.id);
                    table.ForeignKey(
                        name: "BookingSeat_bookingId_fkey",
                        column: x => x.bookingId,
                        principalTable: "Booking",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "BookingSeat_seatChangeId_fkey",
                        column: x => x.seatChangeId,
                        principalTable: "SeatChange",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "BookingSeat_seatId_fkey",
                        column: x => x.seatId,
                        principalTable: "Seat",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "BookingSeat_showtimeId_fkey",
                        column: x => x.showtimeId,
                        principalTable: "Showtime",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Payment",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    bookingId = table.Column<string>(type: "text", nullable: false),
                    mainBookingId = table.Column<string>(type: "text", nullable: true),
                    kind = table.Column<PaymentKind>(type: "\"PaymentKind\"", nullable: false, defaultValue: PaymentKind.BOOKING),
                    seatChangeId = table.Column<string>(type: "text", nullable: true),
                    method = table.Column<string>(type: "text", nullable: false, defaultValue: "PROMPTPAY"),
                    amount = table.Column<int>(type: "integer", nullable: false),
                    qrPayload = table.Column<string>(type: "text", nullable: true),
                    reference = table.Column<string>(type: "text", nullable: false),
                    slipPath = table.Column<string>(type: "text", nullable: true),
                    slipUploadedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    status = table.Column<PaymentStatus>(type: "\"PaymentStatus\"", nullable: false, defaultValue: PaymentStatus.AWAITING_SLIP),
                    verifiedById = table.Column<string>(type: "text", nullable: true),
                    verifiedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    rejectReason = table.Column<string>(type: "text", nullable: true),
                    receiptNo = table.Column<string>(type: "text", nullable: true),
                    receiptName = table.Column<string>(type: "text", nullable: true),
                    receiptSeats = table.Column<string>(type: "jsonb", nullable: true),
                    refundDueAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    refundAmount = table.Column<int>(type: "integer", nullable: true),
                    refundBankName = table.Column<string>(type: "text", nullable: true),
                    refundAccountNo = table.Column<string>(type: "text", nullable: true),
                    refundAccountName = table.Column<string>(type: "text", nullable: true),
                    refundedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: true),
                    refundedById = table.Column<string>(type: "text", nullable: true),
                    refundSlipPath = table.Column<string>(type: "text", nullable: true),
                    refundNote = table.Column<string>(type: "text", nullable: true),
                    createdAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updatedAt = table.Column<DateTime>(type: "timestamp(3) without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("Payment_pkey", x => x.id);
                    table.CheckConstraint("Payment_kind_main_check", "((kind = 'BOOKING'::\"PaymentKind\") = (\"mainBookingId\" IS NOT NULL))");
                    table.CheckConstraint("Payment_kind_seat_change_check", "((kind = 'BOOKING'::\"PaymentKind\") = (\"seatChangeId\" IS NULL))");
                    table.ForeignKey(
                        name: "Payment_bookingId_fkey",
                        column: x => x.bookingId,
                        principalTable: "Booking",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Payment_mainBookingId_fkey",
                        column: x => x.mainBookingId,
                        principalTable: "Booking",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Payment_refundedById_fkey",
                        column: x => x.refundedById,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "Payment_seatChangeId_fkey",
                        column: x => x.seatChangeId,
                        principalTable: "SeatChange",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "Payment_verifiedById_fkey",
                        column: x => x.verifiedById,
                        principalTable: "User",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "Booking_code_key",
                table: "Booking",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Booking_showtimeId_idx",
                table: "Booking",
                column: "showtimeId");

            migrationBuilder.CreateIndex(
                name: "Booking_status_holdExpiresAt_idx",
                table: "Booking",
                columns: new[] { "status", "holdExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "Booking_userId_status_idx",
                table: "Booking",
                columns: new[] { "userId", "status" });

            migrationBuilder.CreateIndex(
                name: "BookingSeat_bookingId_idx",
                table: "BookingSeat",
                column: "bookingId");

            migrationBuilder.CreateIndex(
                name: "BookingSeat_seatChangeId_idx",
                table: "BookingSeat",
                column: "seatChangeId");

            migrationBuilder.CreateIndex(
                name: "BookingSeat_showtimeId_seatId_key",
                table: "BookingSeat",
                columns: new[] { "showtimeId", "seatId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Movie_status_idx",
                table: "Movie",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "Notification_userId_createdAt_idx",
                table: "Notification",
                columns: new[] { "userId", "createdAt" });

            migrationBuilder.CreateIndex(
                name: "Notification_userId_readAt_idx",
                table: "Notification",
                columns: new[] { "userId", "readAt" });

            migrationBuilder.CreateIndex(
                name: "PasswordResetToken_tokenHash_key",
                table: "PasswordResetToken",
                column: "tokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "PasswordResetToken_userId_idx",
                table: "PasswordResetToken",
                column: "userId");

            migrationBuilder.CreateIndex(
                name: "Payment_bookingId_idx",
                table: "Payment",
                column: "bookingId");

            migrationBuilder.CreateIndex(
                name: "Payment_mainBookingId_key",
                table: "Payment",
                column: "mainBookingId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Payment_receiptNo_key",
                table: "Payment",
                column: "receiptNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Payment_seatChangeId_key",
                table: "Payment",
                column: "seatChangeId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Payment_status_idx",
                table: "Payment",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "RefreshToken_tokenHash_key",
                table: "RefreshToken",
                column: "tokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "RefreshToken_userId_idx",
                table: "RefreshToken",
                column: "userId");

            migrationBuilder.CreateIndex(
                name: "Seat_theatreId_idx",
                table: "Seat",
                column: "theatreId");

            migrationBuilder.CreateIndex(
                name: "Seat_theatreId_rowLabel_seatNumber_key",
                table: "Seat",
                columns: new[] { "theatreId", "rowLabel", "seatNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "SeatChange_bookingId_status_idx",
                table: "SeatChange",
                columns: new[] { "bookingId", "status" });

            migrationBuilder.CreateIndex(
                name: "SeatChange_status_holdExpiresAt_idx",
                table: "SeatChange",
                columns: new[] { "status", "holdExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "Showtime_movieId_startsAt_idx",
                table: "Showtime",
                columns: new[] { "movieId", "startsAt" });

            migrationBuilder.CreateIndex(
                name: "Showtime_startsAt_idx",
                table: "Showtime",
                column: "startsAt");

            migrationBuilder.CreateIndex(
                name: "Showtime_theatreId_startsAt_key",
                table: "Showtime",
                columns: new[] { "theatreId", "startsAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "Theatre_name_key",
                table: "Theatre",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "User_email_key",
                table: "User",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "User_phone_key",
                table: "User",
                column: "phone",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ZonePrice_showtimeId_zone_key",
                table: "ZonePrice",
                columns: new[] { "showtimeId", "zone" },
                unique: true);

            PrismaParity.ApplyForeignKeyOnUpdateCascade(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingSeat");

            migrationBuilder.DropTable(
                name: "Notification");

            migrationBuilder.DropTable(
                name: "PasswordResetToken");

            migrationBuilder.DropTable(
                name: "Payment");

            migrationBuilder.DropTable(
                name: "ReceiptCounter");

            migrationBuilder.DropTable(
                name: "RefreshToken");

            migrationBuilder.DropTable(
                name: "ZonePrice");

            migrationBuilder.DropTable(
                name: "Seat");

            migrationBuilder.DropTable(
                name: "SeatChange");

            migrationBuilder.DropTable(
                name: "Booking");

            migrationBuilder.DropTable(
                name: "Showtime");

            migrationBuilder.DropTable(
                name: "User");

            migrationBuilder.DropTable(
                name: "Movie");

            migrationBuilder.DropTable(
                name: "Theatre");
        }
    }
}
