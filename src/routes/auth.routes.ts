import { Router } from 'express';
import { login, getMe } from '../controllers/auth.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.post('/login', login);
router.get('/me', authenticateJWT, getMe);

export default router;
