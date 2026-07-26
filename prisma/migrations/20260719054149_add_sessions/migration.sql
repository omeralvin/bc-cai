-- AlterTable
ALTER TABLE "CheckInLog" ADD COLUMN     "isLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateDuration" INTEGER,
ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "dayName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_dayName_date_sessionNumber_key" ON "AttendanceSession"("dayName", "date", "sessionNumber");

-- AddForeignKey
ALTER TABLE "CheckInLog" ADD CONSTRAINT "CheckInLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
