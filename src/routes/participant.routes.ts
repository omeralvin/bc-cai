import { Router } from 'express';
import {
  getParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  importParticipants,
  resetAllAttendance,
  registerRfid,
} from '../controllers/participant.controller';
import { authenticateJWT, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Protect all participant routes
router.use(authenticateJWT);

router.get('/', getParticipants);
router.post('/', createParticipant);
router.patch('/:id/register-rfid', registerRfid);
router.put('/:id', updateParticipant);
router.delete('/:id', deleteParticipant);
router.post('/import', importParticipants);
router.post('/reset', requireRole(['admin']), resetAllAttendance);

export default router;
