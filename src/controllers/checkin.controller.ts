import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export interface RfidCheckInResult {
  success: boolean;
  message: string;
  participant?: any;
  log?: any;
}

const GRACE_PERIOD_MINUTES = 30;
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function getWibTimeStr(): string {
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`;
}

function getWibDayName(): string {
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return DAY_NAMES[wib.getDay()];
}

function getWibDate(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

async function findActiveSession(explicitSessionId?: string | null): Promise<string | null> {
  // ── Path 1: Operator explicitly selected a session (trust their choice) ──
  if (explicitSessionId) {
    const session = await prisma.attendanceSession.findUnique({ where: { id: explicitSessionId } });
    if (!session) return null;
    return session.id;
  }

  // ── Path 2: No session selected — auto-detect from today's sessions ──
  const wibDate = getWibDate();
  const currentTimeStr = getWibTimeStr();
  const currentDayName = getWibDayName();

  const todayStart = new Date(wibDate);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(wibDate);
  todayEnd.setHours(23, 59, 59, 999);

  const todaySessions = await prisma.attendanceSession.findMany({
    where: {
      OR: [
        { date: { gte: todayStart, lte: todayEnd } },
        { dayName: currentDayName },
      ],
    },
    orderBy: [{ date: 'asc' }, { sessionNumber: 'asc' }],
  });

  const candidateSessions: { session: typeof todaySessions[number]; startDiff: number }[] = [];

  for (const session of todaySessions) {
    const [sh, sm] = session.startTime.split(':').map(Number);
    const [eh, em] = session.endTime.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    const graceStart = Math.max(0, startMinutes - GRACE_PERIOD_MINUTES);
    const [ch, cm] = currentTimeStr.split(':').map(Number);
    const currentMinutes = ch * 60 + cm;

    if (currentMinutes >= graceStart && currentMinutes <= endMinutes) {
      const startDiff = Math.abs(startMinutes - currentMinutes);
      candidateSessions.push({ session, startDiff });
    }
  }

  if (candidateSessions.length === 0) return null;
  if (candidateSessions.length === 1) return candidateSessions[0].session.id;

  candidateSessions.sort((a, b) => a.startDiff - b.startDiff);
  return candidateSessions[0].session.id;
}

function computeLateStatus(checkInTime: Date, sessionStartTime: string): { isLate: boolean; lateDuration: number | null } {
  const wib = new Date(checkInTime.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const [hours, minutes] = sessionStartTime.split(':').map(Number);
  const sessionStart = new Date(wib);
  sessionStart.setHours(hours, minutes, 0, 0);

  if (wib <= sessionStart) {
    return { isLate: false, lateDuration: null };
  }

  const diffMs = wib.getTime() - sessionStart.getTime();
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

  // Fallback ID Peserta: QR Code yang berisi ID Peserta (saat RFID belum dipasang)
  // tetap bisa absen lewat jalur yang sama — QR menjadi alternatif kartu RFID.
  if (!participant) {
    participant = await prisma.participant.findUnique({
      where: { id: trimmedRfid.toUpperCase() },
    });
  }

  if (!participant) {
    return {
      success: false,
      message: `Kartu/QR "${trimmedRfid}" tidak terdaftar!`,
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
