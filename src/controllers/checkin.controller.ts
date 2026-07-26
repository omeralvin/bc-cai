import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export interface RfidCheckInResult {
  success: boolean;
  message: string;
  participant?: any;
  log?: any;
}

const EARLY_BUFFER_MINUTES = 20;

function subtractMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m - minutes;
  const clamped = Math.max(0, totalMinutes);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function getCurrentTimeStr(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function findActiveSession(explicitSessionId?: string | null): Promise<string | null> {
  const now = new Date();
  const currentTimeStr = getCurrentTimeStr(now);

  if (explicitSessionId) {
    const session = await prisma.attendanceSession.findUnique({ where: { id: explicitSessionId } });
    if (!session) return null;

    const openTime = subtractMinutes(session.startTime, EARLY_BUFFER_MINUTES);
    if (openTime <= currentTimeStr && currentTimeStr <= session.endTime) {
      return session.id;
    }
    return null;
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const todaySessions = await prisma.attendanceSession.findMany({
    where: { date: { gte: todayStart, lte: todayEnd } },
    orderBy: { startTime: 'asc' },
  });

  const candidateSessions: { session: typeof todaySessions[number]; startDiff: number }[] = [];

  for (const session of todaySessions) {
    const openTime = subtractMinutes(session.startTime, EARLY_BUFFER_MINUTES);
    if (openTime <= currentTimeStr && currentTimeStr <= session.endTime) {
      const [sh, sm] = session.startTime.split(':').map(Number);
      const [ch, cm] = currentTimeStr.split(':').map(Number);
      const startDiff = Math.abs((sh * 60 + sm) - (ch * 60 + cm));
      candidateSessions.push({ session, startDiff });
    }
  }

  if (candidateSessions.length === 0) return null;
  if (candidateSessions.length === 1) return candidateSessions[0].session.id;

  candidateSessions.sort((a, b) => a.startDiff - b.startDiff);
  return candidateSessions[0].session.id;
}

function computeLateStatus(checkInTime: Date, sessionStartTime: string): { isLate: boolean; lateDuration: number | null } {
  const [hours, minutes] = sessionStartTime.split(':').map(Number);
  const sessionStart = new Date(checkInTime);
  sessionStart.setHours(hours, minutes, 0, 0);

  if (checkInTime <= sessionStart) {
    return { isLate: false, lateDuration: null };
  }

  const diffMs = checkInTime.getTime() - sessionStart.getTime();
  const lateDuration = Math.ceil(diffMs / (1000 * 60));

  return { isLate: true, lateDuration };
}

interface CheckInResult {
  participant: any;
  log: any;
  duplicate?: boolean;
}

async function checkInForSession(
  participantId: string,
  participantName: string,
  participantGroup: string,
  resolvedSessionId: string,
  operatorName: string,
  timestamp: Date
): Promise<CheckInResult> {
  const existingLog = await prisma.checkInLog.findFirst({
    where: { participantId, sessionId: resolvedSessionId, status: { in: ['PRESENT', 'LATE'] } },
  });

  if (existingLog) {
    return {
      participant: { id: participantId },
      log: existingLog,
      duplicate: true,
    };
  }

  const session = await prisma.attendanceSession.findUnique({ where: { id: resolvedSessionId } });
  const { isLate, lateDuration } = session
    ? computeLateStatus(timestamp, session.startTime)
    : { isLate: false, lateDuration: null };

  const txResult = await prisma.$transaction(async (tx) => {
    const updatedParticipant = await tx.participant.update({
      where: { id: participantId },
      data: {
        isCheckedIn: true,
        checkInTime: timestamp,
        scannedBy: operatorName,
      },
    });

    const successLog = await tx.checkInLog.create({
      data: {
        participantId,
        participantName,
        group: participantGroup,
        timestamp,
        operatorName,
        status: isLate ? 'LATE' : 'PRESENT',
        sessionId: resolvedSessionId,
        isLate,
        lateDuration,
      },
    });

    return { updatedParticipant, successLog };
  });

  return { participant: txResult.updatedParticipant, log: txResult.successLog };
}

export const handleRfidCheckIn = async (
  rfidCardId: string,
  operatorName: string = 'System',
  sessionId?: string | null
): Promise<RfidCheckInResult> => {
  const trimmedRfid = rfidCardId.trim();

  if (!trimmedRfid) {
    return { success: false, message: 'Serial kartu RFID kosong!' };
  }

  let participant = await prisma.participant.findUnique({
    where: { rfidCardId: trimmedRfid },
  });

  if (!participant && trimmedRfid !== trimmedRfid.toUpperCase()) {
    participant = await prisma.participant.findUnique({
      where: { rfidCardId: trimmedRfid.toUpperCase() },
    });
  }

  if (!participant) {
    return {
      success: false,
      message: `Kartu RFID "${trimmedRfid}" tidak terdaftar!`,
    };
  }

  const timestamp = new Date();
  const resolvedSessionId = await findActiveSession(sessionId);

  if (!resolvedSessionId) {
    return {
      success: false,
      message: 'Tidak ada sesi absensi yang aktif saat ini! Silakan pilih sesi yang sesuai dengan waktu.',
    };
  }

  try {
    const result = await checkInForSession(
      participant.id, participant.name, participant.group,
      resolvedSessionId, operatorName, timestamp
    );

    if (result.duplicate) {
      const existingTime = new Date(result.log.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      return {
        success: true,
        message: `${participant.name} sudah melakukan absensi pada sesi ini jam ${existingTime}.`,
        participant: result.participant,
        log: result.log,
      };
    }

    return {
      success: true,
      message: `Absensi Berhasil! Selamat datang ${participant.name}.`,
      participant: result.participant,
      log: result.log,
    };
  } catch (err: any) {
    throw err;
  }
};

export const handleParticipantCheckIn = async (
  participantId: string,
  operatorName: string = 'System',
  sessionId?: string | null
): Promise<RfidCheckInResult> => {
  const trimmedId = participantId.trim().toUpperCase();

  if (!trimmedId) {
    return { success: false, message: 'ID Peserta kosong!' };
  }

  const participant = await prisma.participant.findUnique({
    where: { id: trimmedId },
  });

  if (!participant) {
    return {
      success: false,
      message: `ID Peserta "${trimmedId}" tidak ditemukan!`,
    };
  }

  const timestamp = new Date();
  const resolvedSessionId = await findActiveSession(sessionId);

  if (!resolvedSessionId) {
    return {
      success: false,
      message: 'Tidak ada sesi absensi yang aktif saat ini! Silakan pilih sesi yang sesuai dengan waktu.',
    };
  }

  try {
    const result = await checkInForSession(
      participant.id, participant.name, participant.group,
      resolvedSessionId, operatorName, timestamp
    );

    if (result.duplicate) {
      const existingTime = new Date(result.log.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      return {
        success: true,
        message: `${participant.name} sudah melakukan absensi pada sesi ini jam ${existingTime}.`,
        participant: result.participant,
        log: result.log,
      };
    }

    return {
      success: true,
      message: `Absensi Berhasil! Selamat datang ${participant.name}.`,
      participant: result.participant,
      log: result.log,
    };
  } catch (err: any) {
    throw err;
  }
};

export const checkIn = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { participantId, rfidCardId, sessionId } = req.body;
    const operatorName = req.user?.name || 'System';

    if (!participantId && !rfidCardId) {
      return res.status(400).json({ success: false, message: 'Harap masukkan ID Peserta atau Scan Kartu RFID!' });
    }

    const result = rfidCardId
      ? await handleRfidCheckIn(rfidCardId, operatorName, sessionId)
      : await handleParticipantCheckIn(participantId!, operatorName, sessionId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

export const registerRfid = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { participantId, rfidCardId } = req.body;

    if (!participantId || !rfidCardId) {
      return res.status(400).json({
        success: false,
        message: 'ID Peserta dan Serial RFID wajib diisi!'
      });
    }

    const trimmedRfid = rfidCardId.trim();

    const rfidExists = await prisma.participant.findUnique({
      where: { rfidCardId: trimmedRfid }
    });

    if (rfidExists) {
      return res.status(400).json({
        success: false,
        message: `Kartu RFID ini sudah terdaftar atas nama ${rfidExists.name}!`
      });
    }

    const updatedParticipant = await prisma.participant.update({
      where: { id: participantId.trim().toUpperCase() },
      data: { rfidCardId: trimmedRfid }
    });

    return res.status(200).json({
      success: true,
      message: `Berhasil mendaftarkan kartu RFID untuk ${updatedParticipant.name}!`,
      participant: updatedParticipant
    });

  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'ID Peserta tidak ditemukan!' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

export const getLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.query;

    const where = sessionId ? { sessionId: sessionId as string } : {};

    const logs = await prisma.checkInLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
    });
    return res.status(200).json(logs);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
