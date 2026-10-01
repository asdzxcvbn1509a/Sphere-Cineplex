-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LATE_PAYMENT_REFUND';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "expiredAt" TIMESTAMP(3);
