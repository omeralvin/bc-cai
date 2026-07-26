import { Request, Response } from 'express';
import { handleRfidCheckIn } from './checkin.controller';

/**
 * Public RFID check-in endpoint.
 * Accepts { cardId: string } from a USB RFID Keyboard Emulator
 * (frontend captures keystrokes and POSTs here on Enter).
 */
export const attendanceCheckIn = async (req: Request, res: Response) => {
  try {
    const { cardId, sessionId } = req.body;

    if (!cardId || typeof cardId !== 'string' || !cardId.trim()) {
      return res.status(400).json({ success: false, message: 'cardId wajib diisi!' });
    }

    const result = await handleRfidCheckIn(cardId.trim(), 'RFID Reader', sessionId || undefined);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
