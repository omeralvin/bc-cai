import { Router } from 'express';
import { checkIn, getLogs } from '../controllers/checkin.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

// Protect check-in routes
router.use(authenticateJWT);

router.post('/', checkIn);
router.get('/logs', getLogs);

export default router;
