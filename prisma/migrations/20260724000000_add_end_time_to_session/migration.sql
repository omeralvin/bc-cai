-- AlterTable: Add endTime column to AttendanceSession
ALTER TABLE "AttendanceSession" ADD COLUMN "endTime" TEXT NOT NULL DEFAULT '09:00';
