import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const getSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessions = await prisma.attendanceSession.findMany({
      orderBy: [{ date: 'asc' }, { sessionNumber: 'asc' }],
    });
    return res.status(200).json(sessions);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const upsertSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { dayName, date, sessionNumber, startTime, endTime, name } = req.body;

    if (!date || !startTime || !endTime || !name) {
      return res.status(400).json({ message: 'Missing required fields: date, startTime, endTime, name' });
    }

    const sessionDate = new Date(date);

    const resolvedDayName = dayName || DAY_NAMES[sessionDate.getDay()];

    let resolvedSessionNumber = sessionNumber;
    if (!resolvedSessionNumber) {
      const dayStart = new Date(sessionDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(sessionDate);
      dayEnd.setHours(23, 59, 59, 999);

      const lastSession = await prisma.attendanceSession.findFirst({
        where: {
          date: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { sessionNumber: 'desc' },
      });
      resolvedSessionNumber = lastSession ? lastSession.sessionNumber + 1 : 1;
    }

    const session = await prisma.attendanceSession.upsert({
      where: {
        dayName_date_sessionNumber: {
          dayName: resolvedDayName,
          date: sessionDate,
          sessionNumber: Number(resolvedSessionNumber),
        },
      },
      update: {
        startTime,
        endTime,
        name: name.trim(),
      },
      create: {
        dayName: resolvedDayName,
        date: sessionDate,
        sessionNumber: Number(resolvedSessionNumber),
        startTime,
        endTime,
        name: name.trim(),
      },
    });

    return res.status(200).json(session);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { dayName, date, sessionNumber, startTime, endTime, name } = req.body;

    const existing = await prisma.attendanceSession.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Sesi tidak ditemukan!' });
    }

    const sessionDate = date ? new Date(date) : existing.date;
    const resolvedDayName = dayName || DAY_NAMES[sessionDate.getDay()];

    const updated = await prisma.attendanceSession.update({
      where: { id },
      data: {
        dayName: resolvedDayName,
        date: sessionDate,
        sessionNumber: sessionNumber ? Number(sessionNumber) : existing.sessionNumber,
        startTime: startTime || existing.startTime,
        endTime: endTime || existing.endTime,
        name: name ? name.trim() : existing.name,
      },
    });

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const deleteSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.attendanceSession.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Sesi tidak ditemukan!' });
    }

    // Delete associated check-in logs first
    await prisma.checkInLog.deleteMany({ where: { sessionId: id } });

    await prisma.attendanceSession.delete({ where: { id } });

    return res.status(200).json({ message: `Sesi "${existing.name}" berhasil dihapus.` });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
