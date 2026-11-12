-- รับฐานข้อมูลที่ Prisma (Express รุ่นเดิม) สร้างไว้มาใช้กับ EF Core โดยไม่ต้อง seed ใหม่
--
-- schema ของ InitialCreate ตรงกับ migration สุดท้ายของ Prisma (20261104100000_refund_account_name) ทุกชื่อ
-- จึงแค่บันทึกว่า InitialCreate "รันแล้ว" — ข้อมูลเดิมอยู่ครบ และ migration ถัดไปของ EF ต่อจากตรงนี้ได้
-- ตาราง _prisma_migrations เดิมไม่มีใครใช้แล้ว ปล่อยไว้หรือลบก็ได้
--
-- ใช้: psql "<DATABASE_URL>" -f tools/adopt-prisma-database.sql
-- (รันซ้ำได้ ไม่มีผลอะไรเพิ่ม · ฐานใหม่ไม่ต้องใช้ไฟล์นี้ — dotnet ef database update สร้างให้ครบเอง)
-- ตรวจก่อนว่า schema ตรงกันจริงด้วย tools/schema-fingerprint.sql เทียบกับฐานที่ EF สร้าง

DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NULL THEN
    RAISE EXCEPTION 'ไม่ใช่ฐานที่ Prisma สร้าง (ไม่มีตาราง _prisma_migrations) — ฐานใหม่ให้ใช้ dotnet ef database update';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20261104100000_refund_account_name' AND finished_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ฐานนี้ยังไม่ได้รัน migration สุดท้ายของ Prisma (20261104100000_refund_account_name) — schema ยังไม่ตรงกับ InitialCreate';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20261111152433_InitialCreate', '10.0.15')
ON CONFLICT ("MigrationId") DO NOTHING;
