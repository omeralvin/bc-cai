import { Router } from 'express';
import { getDashboard, exportPdf } from '../controllers/analytics.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/dashboard', getDashboard);
router.get('/export-pdf', exportPdf);

export default router;
