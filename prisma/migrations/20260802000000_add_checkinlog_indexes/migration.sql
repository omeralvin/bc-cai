-- Indexes untuk mempercepat query absensi RFID:
-- 1. duplicate-check pada checkInForSession (findFirst by participantId + sessionId)
-- 2. getLogs / analytics per session yang diurutkan berdasarkan waktu
-- 3. log aktivitas terbaru (order by timestamp desc)

-- CreateIndex
CREATE INDEX "CheckInLog_participantId_sessionId_idx" ON "CheckInLog"("participantId", "sessionId");

-- CreateIndex
CREATE INDEX "CheckInLog_sessionId_timestamp_idx" ON "CheckInLog"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "CheckInLog_timestamp_idx" ON "CheckInLog"("timestamp");
