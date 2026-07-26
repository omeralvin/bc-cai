import { Router } from 'express';
import { getSessions, upsertSession, updateSession, deleteSession } from '../controllers/session.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/', getSessions);
router.post('/', upsertSession);
router.put('/:id', updateSession);
router.delete('/:id', deleteSession);

export default router;
