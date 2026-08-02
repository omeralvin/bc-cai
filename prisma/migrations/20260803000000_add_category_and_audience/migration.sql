-- Add category classification for participants and logs, and session audience.
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'PESERTA';
ALTER TABLE "CheckInLog" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'PESERTA';
ALTER TABLE "AttendanceSession" ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'ALL';

-- Backfill existing participants based on their keterangan (origin).
UPDATE "Participant"
SET "category" = 'PANITIA'
WHERE LOWER(TRIM("origin")) IN ('panitia', 'pemateri', '4s daerah');

-- Backfill existing check-in logs from their participant's category.
UPDATE "CheckInLog" l
SET "category" = COALESCE(
  (SELECT p."category" FROM "Participant" p WHERE p."id" = l."participantId"),
  'PESERTA'
);