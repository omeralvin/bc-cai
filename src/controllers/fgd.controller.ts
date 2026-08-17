import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

// ─── FGD Themes (sesi : tema) — admin yang menentukan ───

let themesEnsured = false;

/**
 * Buat otomatis tabel FgdTheme + isi sesi default (Sesi 1..5) bila belum ada.
 * Dipakai agar backend yang di-deploy tidak perlu menjalankan `prisma migrate`
 * secara manual dulu — tabel dibuat sendiri saat pertama kali dipakai.
 */
async function ensureFgdThemes(): Promise<void> {
  if (themesEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FgdTheme" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "theme" TEXT NOT NULL DEFAULT '',
        "order" INTEGER NOT NULL DEFAULT 0,
        "timerMinutes" INTEGER NOT NULL DEFAULT 10,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "FgdTheme_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FgdTheme_name_key" ON "FgdTheme"("name");`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "FgdTheme" ADD COLUMN IF NOT EXISTS "timerMinutes" INTEGER NOT NULL DEFAULT 10;`);
    themesEnsured = true;
  } catch (error: any) {
    // Mesin database mungkin belum punya FgdTheme; biarkan findMany menangani error nyata.
    console.warn('[FgdThemes] ensure schema warning:', error?.message);
  }
}

/** Public: daftar tema sesi FGD untuk form publik / dropdown. */
export const getFgdThemes = async (_req: any, res: Response) => {
  try {
    await ensureFgdThemes();
    const themes = await prisma.fgdTheme.findMany({ orderBy: { order: 'asc' } });
    return res.status(200).json(themes);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const createFgdTheme = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFgdThemes();
    const { name, theme = '', order, timerMinutes } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Nama sesi wajib diisi!' });
    }
    const trimmedName = String(name).trim();
    const exists = await prisma.fgdTheme.findUnique({ where: { name: trimmedName } });
    if (exists) {
      return res.status(400).json({ message: `Sesi "${trimmedName}" sudah ada!` });
    }
    const maxOrder = await prisma.fgdTheme.aggregate({ _max: { order: true } });
    const result = await prisma.fgdTheme.create({
      data: {
        name: trimmedName,
        theme: String(theme),
        order: Number(order) || (maxOrder._max.order ?? 0) + 1,
        timerMinutes: Math.max(1, Math.min(600, Number(timerMinutes) || 10)),
      },
    });
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateFgdTheme = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFgdThemes();
    const { id } = req.params;
    const { name, theme, order, timerMinutes } = req.body;
    const data: any = {};
    if (typeof name === 'string' && name.trim()) {
      const trimmedName = name.trim();
      const clash = await prisma.fgdTheme.findFirst({ where: { name: trimmedName, NOT: { id } } });
      if (clash) return res.status(400).json({ message: `Sesi "${trimmedName}" sudah ada!` });
      data.name = trimmedName;
    }
    if (typeof theme === 'string') data.theme = theme;
    if (typeof order === 'number') data.order = order;
    if (typeof timerMinutes === 'number') data.timerMinutes = Math.max(1, Math.min(600, timerMinutes));
    const result = await prisma.fgdTheme.update({ where: { id }, data });
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const deleteFgdTheme = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFgdThemes();
    const { id } = req.params;
    await prisma.fgdTheme.delete({ where: { id } });
    return res.status(200).json({ message: 'Tema sesi berhasil dihapus' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const upsertNotulis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupNumber, sessionName, ...data } = req.body;
    if (!groupNumber || groupNumber < 1 || groupNumber > 15) {
      return res.status(400).json({ message: 'Group number must be between 1 and 15' });
    }
    if (!sessionName) {
      return res.status(400).json({ message: 'Session name is required' });
    }

    const existing = await prisma.fgdMinute.findUnique({
      where: { groupNumber_sessionName: { groupNumber, sessionName } },
    });

    let result;
    if (existing) {
      result = await prisma.fgdMinute.update({
        where: { id: existing.id },
        data,
      });
    } else {
      result = await prisma.fgdMinute.create({
        data: { groupNumber, sessionName, ...data },
      });
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const getByGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupNumber = parseInt(req.params.groupNumber);
    if (isNaN(groupNumber) || groupNumber < 1 || groupNumber > 15) {
      return res.status(400).json({ message: 'Invalid group number' });
    }
    const sessionName = req.query.session as string | undefined;
    if (sessionName) {
      const data = await prisma.fgdMinute.findUnique({
        where: { groupNumber_sessionName: { groupNumber, sessionName } },
      });
      return res.status(200).json(data || null);
    }
    const allData = await prisma.fgdMinute.findMany({
      where: { groupNumber },
      orderBy: { sessionName: 'asc' },
    });
    return res.status(200).json(allData);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const getAll = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupFilter = req.query.group ? parseInt(req.query.group as string) : undefined;
    const sessionFilter = req.query.session as string | undefined;
    const where: any = {};
    if (groupFilter && groupFilter >= 1 && groupFilter <= 15) where.groupNumber = groupFilter;
    if (sessionFilter) where.sessionName = sessionFilter;
    const data = await prisma.fgdMinute.findMany({
      where,
      orderBy: [{ groupNumber: 'asc' }, { sessionName: 'asc' }],
    });
    return res.status(200).json(data);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const checkStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupNumber = parseInt(req.query.groupNumber as string);
    const sessionId = req.query.sessionId as string;
    if (isNaN(groupNumber) || !sessionId) {
      return res.status(400).json({ message: 'Invalid groupNumber or sessionId' });
    }
    const existing = await prisma.fgdMinute.findUnique({
      where: { groupNumber_sessionName: { groupNumber, sessionName: sessionId } },
    });
    return res.status(200).json({
      isFilled: !!existing,
      existingData: existing,
      updatedAt: existing?.updatedAt ?? null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateNotulis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const result = await prisma.fgdMinute.update({
      where: { id },
      data,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const deleteNotulis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.fgdMinute.delete({ where: { id } });
    return res.status(200).json({ message: 'Data berhasil dihapus' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

function addTextLine(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, maxWidth: number) {
  const displayValue = value || '-';
  doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { width: 120, align: 'left' });
  doc.font('Helvetica').fontSize(9).text(displayValue, x + 125, y, { width: maxWidth - 125, align: 'left' });
  return doc.y;
}

export const exportPdf = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupNumber } = req.params;
    const sessionFilter = req.query.session as string | undefined;

    const where: any = {};
    if (groupNumber) {
      const gn = parseInt(groupNumber);
      if (isNaN(gn)) return res.status(400).json({ message: 'Invalid group number' });
      where.groupNumber = gn;
    }
    if (sessionFilter) where.sessionName = sessionFilter;

    let records;
    if (groupNumber) {
      records = await prisma.fgdMinute.findMany({
        where,
        orderBy: { sessionName: 'asc' },
      });
    } else {
      records = await prisma.fgdMinute.findMany({ where, orderBy: [{ groupNumber: 'asc' }, { sessionName: 'asc' }] });
    }

    if (records.length === 0) {
      return res.status(404).json({ message: 'No data found' });
    }

    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      const filename = groupNumber
        ? `notulis-grup-${groupNumber}${sessionFilter ? `-${sessionFilter.replace(/\s+/g, '-')}` : ''}.pdf`
        : sessionFilter
          ? `notulis-sesi-${sessionFilter.replace(/\s+/g, '-')}.pdf`
          : 'notulis-semua-grup.pdf';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).end(pdfBuffer);
    });

    const logoPath = path.join(__dirname, '../../assets/logo_warna.png');
    const hasLogo = fs.existsSync(logoPath);

    for (let i = 0; i < records.length; i++) {
      const r = records[i];

      if (i > 0) doc.addPage();

      if (hasLogo) {
        doc.image(logoPath, 40, 35, { width: 55 });
        doc.fontSize(18).font('Helvetica-Bold').text('NOTULIS FGD', 105, 40);
        doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Cinta Alam Indonesia', 105, 62);
      } else {
        doc.fontSize(20).font('Helvetica-Bold').text('NOTULIS FGD', { align: 'center' });
      }
      doc.moveDown(3);

      const lineY = doc.y;
      doc.fontSize(12).font('Helvetica-Bold').text(`Grup ${r.groupNumber} — ${r.sessionName || 'Sesi 1'}`, { align: 'center' });
      doc.moveDown(1.5);

      const leftX = 40;
      const maxW = 525;

      let y = doc.y;

      const sectionHeader = (title: string) => {
        doc.fillColor('#1d257a');
        doc.font('Helvetica-Bold').fontSize(11).text(title, leftX, y, { width: maxW });
        doc.fillColor('#000000');
        y = doc.y + 4;
        doc.moveTo(leftX, y).lineTo(leftX + maxW, y).strokeColor('#d1d5db').stroke();
        y += 8;
      };

      const fieldRow = (label: string, value: string) => {
        const lines = doc.font('Helvetica-Bold').fontSize(9).text(label, leftX, y, { width: 120, align: 'left' });
        const labelHeight = doc.y - y;
        const valY = y;
        doc.font('Helvetica').fontSize(9).text(value || '-', leftX + 125, valY, { width: maxW - 125, align: 'left', lineBreak: true });
        const valHeight = doc.y - valY;
        y = Math.max(y + labelHeight, valY + valHeight) + 4;
        if (y > 740) { doc.addPage(); y = 40; }
      };

      sectionHeader('PROBLEM - PENYEBAB - SOLUSI');
      fieldRow('Problem', r.problem);
      fieldRow('Penyebab', r.penyebab);
      fieldRow('Solusi', r.solusi);

      sectionHeader('ACTION PLAN');
      fieldRow('Bidang PPG', r.actionPlanBidangPpg);
      fieldRow('Deskripsi', r.actionPlanDeskripsi);
      fieldRow('Nama Kegiatan', r.actionPlanNamaKegiatan);
      fieldRow('Peserta', r.actionPlanPeserta);
      fieldRow('Waktu', r.actionPlanWaktu);
      fieldRow('Dana', r.actionPlanDana);

      sectionHeader('PERAN 5 UNSUR');
      fieldRow('Peran Keimaman', r.peranKeimaman);
      fieldRow('Peran Pengurus', r.peranPengurus);
      fieldRow('Peran Orang Tua', r.peranOrangTua);
      fieldRow('Peran Mubaligh', r.peranMubaligh);
      fieldRow('Peran Ahli Pendidik', r.peranAhliPendidik);

      doc.moveDown(1);
      doc.fontSize(8).font('Helvetica').fillColor('#9ca3af').text(
        `Dicetak: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        { align: 'right' }
      );
      doc.fillColor('#000000');
    }

    doc.end();
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
