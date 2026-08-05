import { Router } from 'express';
import {
  upsertNotulis,
  getByGroup,
  getAll,
  checkStatus,
  updateNotulis,
  deleteNotulis,
  exportPdf,
  getFgdThemes,
  createFgdTheme,
  updateFgdTheme,
  deleteFgdTheme,
} from '../controllers/fgd.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

// FGD Themes — public read (form publik), admin manage
router.get('/themes', getFgdThemes);
router.post('/themes', authenticateJWT, createFgdTheme);
router.put('/themes/:id', authenticateJWT, updateFgdTheme);
router.delete('/themes/:id', authenticateJWT, deleteFgdTheme);

router.post('/', upsertNotulis);
router.get('/group/:groupNumber', getByGroup);
router.get('/export-pdf', authenticateJWT, exportPdf);
router.get('/export-pdf/:groupNumber', authenticateJWT, exportPdf);
router.get('/check-status', authenticateJWT, checkStatus);
router.get('/', authenticateJWT, getAll);
router.put('/:id', authenticateJWT, updateNotulis);
router.delete('/:id', authenticateJWT, deleteNotulis);

export default router;
