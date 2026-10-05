-- เปลี่ยนที่นั่ง: การจองหนึ่งใบมีรายการเงินได้หลายรายการ (ค่าตั๋วตอนจอง + ส่วนต่างที่โอนเพิ่ม/คืน)
-- + ประวัติคำขอเปลี่ยนที่นั่ง + ที่นั่งที่กันไว้ระหว่างรอโอนส่วนต่าง

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('BOOKING', 'SEAT_CHANGE_TOPUP', 'SEAT_CHANGE_REFUND');

-- CreateEnum
CREATE TYPE "SeatChangeStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SEATS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SEAT_CHANGE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SEAT_CHANGE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'SEAT_CHANGE_LATE_REFUND';

-- DropIndex
DROP INDEX "Payment_bookingId_key";

-- AlterTable
ALTER TABLE "BookingSeat" ADD COLUMN     "seatChangeId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'BOOKING',
ADD COLUMN     "mainBookingId" TEXT,
ADD COLUMN     "receiptSeats" JSONB,
ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "seatChangeId" TEXT,
ALTER COLUMN "qrPayload" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SeatChange" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "SeatChangeStatus" NOT NULL,
    "fromSeats" JSONB NOT NULL,
    "toSeats" JSONB NOT NULL,
    "fromAmount" INTEGER NOT NULL,
    "toAmount" INTEGER NOT NULL,
    "diffAmount" INTEGER NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reason" TEXT,
    "closeReason" TEXT,
    "byAdmin" BOOLEAN NOT NULL DEFAULT false,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeatChange_bookingId_status_idx" ON "SeatChange"("bookingId", "status");

-- CreateIndex
CREATE INDEX "SeatChange_status_holdExpiresAt_idx" ON "SeatChange"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "BookingSeat_seatChangeId_idx" ON "BookingSeat"("seatChangeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mainBookingId_key" ON "Payment"("mainBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_seatChangeId_key" ON "Payment"("seatChangeId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingSeat" ADD CONSTRAINT "BookingSeat_seatChangeId_fkey" FOREIGN KEY ("seatChangeId") REFERENCES "SeatChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_mainBookingId_fkey" FOREIGN KEY ("mainBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_seatChangeId_fkey" FOREIGN KEY ("seatChangeId") REFERENCES "SeatChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatChange" ADD CONSTRAINT "SeatChange_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatChange" ADD CONSTRAINT "SeatChange_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- ข้อมูลเดิม ----------

-- ทุกรายการที่มีอยู่แล้วคือค่าตั๋วตอนจอง (ใบหลัก) — booking.payment จึงยังชี้ใบเดิมเหมือนก่อน migration
UPDATE "Payment" SET "mainBookingId" = "bookingId";

-- ยอดที่ต้องโอนคืนของรายการที่เข้าคิวคืนเงินไปแล้ว = เต็มจำนวน เพราะก่อนมีการเปลี่ยนที่นั่งยอดการจองไม่เคยเปลี่ยน
UPDATE "Payment" SET "refundAmount" = "amount" WHERE "status" IN ('REFUND_PENDING', 'REFUNDED');

-- ตรึงที่นั่งบนใบเสร็จที่ออกไปแล้ว — เปลี่ยนที่นั่งทีหลังแล้วใบเสร็จเดิมต้องยังเป็นที่นั่งตอนจ่ายเงิน
UPDATE "Payment" p
SET "receiptSeats" = b."seatSnapshot"
FROM "Booking" b
WHERE b."id" = p."bookingId" AND p."receiptNo" IS NOT NULL;

-- ใบหลักต้องผูก mainBookingId และไม่มี seatChangeId · รายการส่วนต่างกลับกัน
-- ด่านสุดท้ายระดับฐานข้อมูล ถ้าโค้ดสร้างรายการผิดชนิด insert จะล้มทันทีแทนที่จะได้ใบหลักซ้อนกันสองใบ
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_kind_main_check"
  CHECK (("kind" = 'BOOKING') = ("mainBookingId" IS NOT NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_kind_seat_change_check"
  CHECK (("kind" = 'BOOKING') = ("seatChangeId" IS NULL));
