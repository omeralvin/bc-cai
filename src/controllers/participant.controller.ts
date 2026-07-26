import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export const getParticipants = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const participants = await prisma.participant.findMany({
      orderBy: { id: 'asc' },
    });
    return res.status(200).json(participants);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const createParticipant = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, name, age, gender, group, origin, rfidCardId } = req.body;

    if (!id || !name || !gender || !group || !origin) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const trimmedId = id.trim().toUpperCase();

    // Check duplicate ID
    const existingById = await prisma.participant.findUnique({
      where: { id: trimmedId },
    });
    if (existingById) {
      return res.status(400).json({ message: `ID Peserta "${trimmedId}" sudah digunakan!` });
    }

    // Check duplicate RFID
    if (rfidCardId && rfidCardId.trim()) {
      const trimmedRfid = rfidCardId.trim().toUpperCase();
      const existingByRfid = await prisma.participant.findUnique({
        where: { rfidCardId: trimmedRfid },
      });
      if (existingByRfid) {
        return res.status(400).json({ message: `Kartu RFID "${trimmedRfid}" sudah digunakan oleh peserta lain!` });
      }
    }

    const participant = await prisma.participant.create({
      data: {
        id: trimmedId,
        name: name.trim(),
        age: age ?? null,
        gender,
        group: group.trim(),
        origin: origin.trim(),
        rfidCardId: rfidCardId && rfidCardId.trim() ? rfidCardId.trim().toUpperCase() : null,
        isCheckedIn: false,
        checkInTime: null,
        scannedBy: null,
      },
    });

    return res.status(201).json(participant);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateParticipant = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, age, gender, group, origin, isCheckedIn, checkInTime, scannedBy, rfidCardId } = req.body;

    const participant = await prisma.participant.findUnique({
      where: { id },
    });

    if (!participant) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    // Check duplicate RFID if it's changing
    const trimmedRfid = rfidCardId && rfidCardId.trim() ? rfidCardId.trim().toUpperCase() : null;
    if (trimmedRfid && trimmedRfid !== participant.rfidCardId) {
      const existingByRfid = await prisma.participant.findUnique({
        where: { rfidCardId: trimmedRfid },
      });
      if (existingByRfid) {
        return res.status(400).json({ message: `Kartu RFID "${trimmedRfid}" sudah digunakan oleh peserta lain!` });
      }
    }

    const updated = await prisma.participant.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : participant.name,
        age: age !== undefined ? age : participant.age,
        gender: gender !== undefined ? gender : participant.gender,
        group: group !== undefined ? group.trim() : participant.group,
        origin: origin !== undefined ? origin.trim() : participant.origin,
        isCheckedIn: isCheckedIn !== undefined ? isCheckedIn : participant.isCheckedIn,
        checkInTime: checkInTime !== undefined ? (checkInTime ? new Date(checkInTime) : null) : participant.checkInTime,
        scannedBy: scannedBy !== undefined ? scannedBy : participant.scannedBy,
        rfidCardId: rfidCardId !== undefined ? trimmedRfid : participant.rfidCardId,
      },
    });

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const deleteParticipant = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const participant = await prisma.participant.findUnique({
      where: { id },
    });

    if (!participant) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    await prisma.participant.delete({
      where: { id },
    });

    return res.status(200).json({ message: 'Participant deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const importParticipants = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { participants } = req.body;

    if (!Array.isArray(participants)) {
      return res.status(400).json({ message: 'Payload must contain a "participants" array' });
    }

    let count = 0;
    for (const item of participants) {
      if (!item.id || !item.name) continue;

      const trimmedId = item.id.trim().toUpperCase();

      // Check duplicate ID
      const existing = await prisma.participant.findUnique({
        where: { id: trimmedId },
      });

      if (!existing) {
        // Check rfidCardId unique
        let rfid = null;
        if (item.rfidCardId && item.rfidCardId.trim()) {
          const trimmedRfid = item.rfidCardId.trim().toUpperCase();
          const rfidExists = await prisma.participant.findUnique({
            where: { rfidCardId: trimmedRfid }
          });
          if (!rfidExists) {
            rfid = trimmedRfid;
          }
        }

        await prisma.participant.create({
          data: {
            id: trimmedId,
            name: item.name.trim(),
            age: item.age ?? null,
            gender: item.gender || 'L',
            group: item.group ? item.group.trim() : 'Umum',
            origin: item.origin ? item.origin.trim() : '-',
            rfidCardId: rfid,
            isCheckedIn: false,
            checkInTime: null,
            scannedBy: null,
          },
        });
        count++;
      }
    }

    return res.status(200).json({ count, message: `${count} participants imported successfully` });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const resetAllAttendance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Reset participants
    await prisma.participant.updateMany({
      data: {
        isCheckedIn: false,
        checkInTime: null,
        scannedBy: null,
      },
    });

    // Delete all check-in logs
    await prisma.checkInLog.deleteMany({});

    return res.status(200).json({ message: 'Reset all attendance and logs successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const registerRfid = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const identifier = req.params.id;
    const { rfidCardId, rfidTag, rfid } = req.body;

    const tagToRegister = (rfidCardId || rfidTag || rfid || '').trim().toUpperCase();

    if (!tagToRegister) {
      return res.status(400).json({ message: 'Tag RFID wajib diisi' });
    }

    const participant = await prisma.participant.findFirst({
      where: {
        OR: [
          { id: identifier },
        ],
      },
    });

    if (!participant) {
      return res.status(404).json({ message: 'Peserta tidak ditemukan' });
    }

    if (tagToRegister !== participant.rfidCardId) {
      const existingByRfid = await prisma.participant.findUnique({
        where: { rfidCardId: tagToRegister },
      });
      if (existingByRfid) {
        return res.status(400).json({ message: `Kartu RFID "${tagToRegister}" sudah digunakan oleh peserta lain!` });
      }
    }

    const updated = await prisma.participant.update({
      where: { id: participant.id },
      data: { rfidCardId: tagToRegister },
    });

    return res.status(200).json({ message: `RFID "${tagToRegister}" berhasil didaftarkan ke ${updated.name}`, participant: updated });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
