-- ใบเสร็จรับเงิน (E-Receipt): เลขที่ใบเสร็จแบบรันต่อเนื่องแยกตามปี + สำเนาชื่อผู้จ่าย

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptName" TEXT,
ADD COLUMN     "receiptNo" TEXT;

-- CreateTable
CREATE TABLE "ReceiptCounter" (
    "year" INTEGER NOT NULL,
    "lastNo" INTEGER NOT NULL,

    CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- ออกเลขย้อนหลังให้ทุกใบที่เคยจ่ายสำเร็จก่อนมีระบบใบเสร็จ (paidAt ไม่ว่าง — รวมใบที่ยกเลิก/คืนเงินไปแล้วภายหลัง)
-- เรียงตามเวลาที่จ่ายจริง · ปี = ปี ค.ศ. ตามเวลาไทย (คอลัมน์เป็น timestamp ไม่มีโซนที่เก็บ UTC จึงบวก 7 ชั่วโมง)
-- ROW_NUMBER() เป็น bigint ต้องแปลงเป็น text ก่อนส่งเข้า LPAD
WITH paid AS (
  SELECT p."id", u."name", b."paidAt",
         EXTRACT(YEAR FROM b."paidAt" + INTERVAL '7 hours')::int AS yr
  FROM "Payment" p
  JOIN "Booking" b ON b."id" = p."bookingId"
  JOIN "User" u ON u."id" = b."userId"
  WHERE b."paidAt" IS NOT NULL
    AND p."status" IN ('APPROVED', 'REFUND_PENDING', 'REFUNDED')
), numbered AS (
  SELECT "id", "name", yr, ROW_NUMBER() OVER (PARTITION BY yr ORDER BY "paidAt", "id") AS n
  FROM paid
)
UPDATE "Payment" p
SET "receiptNo"   = 'RC-' || numbered.yr::text || '-' || LPAD(numbered.n::text, 6, '0'),
    "receiptName" = numbered."name"
FROM numbered
WHERE p."id" = numbered."id";

-- ตั้งตัวนับให้ต่อจากเลขที่ออกย้อนหลังไป ใบใหม่จะได้ไม่ชนเลขเดิม
INSERT INTO "ReceiptCounter" ("year", "lastNo")
SELECT EXTRACT(YEAR FROM b."paidAt" + INTERVAL '7 hours')::int, COUNT(*)::int
FROM "Payment" p
JOIN "Booking" b ON b."id" = p."bookingId"
WHERE p."receiptNo" IS NOT NULL
GROUP BY 1;
