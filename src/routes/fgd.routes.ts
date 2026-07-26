import { Router } from 'express';
import {
  upsertNotulis,
  getByGroup,
  getAll,
  checkStatus,
  updateNotulis,
  deleteNotulis,
  exportPdf,
} from '../controllers/fgd.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.post('/', upsertNotulis);
router.get('/group/:groupNumber', getByGroup);
router.get('/export-pdf', authenticateJWT, exportPdf);
router.get('/export-pdf/:groupNumber', authenticateJWT, exportPdf);
router.get('/check-status', authenticateJWT, checkStatus);
router.get('/', authenticateJWT, getAll);
router.put('/:id', authenticateJWT, updateNotulis);
router.delete('/:id', authenticateJWT, deleteNotulis);

export default router;
