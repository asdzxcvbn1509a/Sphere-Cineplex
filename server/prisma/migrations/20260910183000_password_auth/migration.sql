-- เปลี่ยนการยืนยันตัวตนจาก OTP ทางเบอร์โทร มาเป็นอีเมล/เบอร์ + รหัสผ่าน

-- 1) อีเมลกลายเป็นชื่อผู้ใช้หลัก จึงต้องมีค่าเสมอและห้ามซ้ำ
UPDATE "User" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL;

--    บัญชีเดิมที่ยังไม่เคยกรอกอีเมล ใส่ค่าชั่วคราวที่ส่งเมลไม่ถึงไว้ก่อน (.invalid สงวนไว้ใช้แบบนี้)
UPDATE "User"
SET "email" = 'user-' || "id" || '@example.invalid'
WHERE "email" IS NULL OR "email" = '';

--    ถ้ามีอีเมลซ้ำกันอยู่ ให้บัญชีที่สมัครทีหลังเป็นฝ่ายเปลี่ยน เจ้าของเดิมจะได้ใช้อีเมลตัวเองต่อ
UPDATE "User"
SET "email" = 'user-' || "id" || '@example.invalid'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "email" ORDER BY "createdAt", "id") AS rn
    FROM "User"
  ) ranked
  WHERE ranked.rn > 1
);

ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- 2) บัญชีเดิมไม่มีรหัสผ่าน เพราะเคยล็อกอินด้วย OTP อย่างเดียว
--    ใส่ค่าที่ไม่ใช่ bcrypt hash ไว้ ทำให้เทียบกับรหัสผ่านใดก็ไม่มีวันผ่าน
--    (ล็อกบัญชีไว้จนกว่าจะตั้งรหัสใหม่ ปลอดภัยกว่าการแจกรหัสตั้งต้นให้ทุกคนเหมือนกัน)
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
UPDATE "User" SET "passwordHash" = '!' WHERE "passwordHash" IS NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- 3) ไม่ใช้ OTP อีกแล้ว
DROP TABLE "OtpCode";
