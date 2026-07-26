import { Router } from 'express';
import { attendanceCheckIn } from '../controllers/attendance.controller';

const router = Router();

// Public endpoint — no JWT required (RFID hardware tap)
router.post('/', attendanceCheckIn);

export default router;
