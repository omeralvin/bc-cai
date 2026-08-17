import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import PDFDocument from 'pdfkit';
import { formatLateDuration } from '../utils/lateStatus';

// Panitia dikecualikan dari perhitungan statistik kehadiran.
const PESERTA_ONLY = { category: 'PESERTA' };

export const getDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.query;

    let session;
    if (sessionId) {
      session = await prisma.attendanceSession.findUnique({
        where: { id: sessionId as string },
      });
      // Fallback: if sessionId was provided but not found, use latest session
      if (!session) {
        session = await prisma.attendanceSession.findFirst({
          orderBy: [{ date: 'desc' }, { sessionNumber: 'desc' }],
        });
      }
    } else {
      session = await prisma.attendanceSession.findFirst({
        orderBy: [{ date: 'desc' }, { sessionNumber: 'desc' }],
      });
    }

    // Only return 404 if the database has zero sessions
    if (!session) {
      return res.status(404).json({ message: 'Belum ada sesi absensi yang dibuat.' });
    }

    const totalParticipants = await prisma.participant.count({ where: PESERTA_ONLY });

    const presentLogs = await prisma.checkInLog.findMany({
      where: { sessionId: session.id, status: { in: ['PRESENT', 'LATE'] }, ...PESERTA_ONLY },
    });
    const present = presentLogs.length;
    const absent = totalParticipants - present;

    const lateLogs = await prisma.checkInLog.findMany({
      where: { sessionId: session.id, isLate: true, ...PESERTA_ONLY },
      orderBy: { lateDuration: 'desc' },
      include: { participant: true },
    });

    const lateList = lateLogs
      .filter((log) => log.participant !== null)
      .map((log) => ({
        participantName: log.participant?.name ?? 'Tanpa Nama',
        participantId: log.participant?.id ?? log.participantId ?? 'N/A',
        group: log.participant?.group ?? 'Tanpa Kelompok',
        lateDuration: log.lateDuration,
        timestamp: log.timestamp,
      }));

    const participants = await prisma.participant.findMany({ where: PESERTA_ONLY });
    const groupMap = new Map<string, { total: number; presentCount: number; lateCount: number }>();

    for (const p of participants) {
      const g = p.group;
      if (!groupMap.has(g)) {
        groupMap.set(g, { total: 0, presentCount: 0, lateCount: 0 });
      }
      const entry = groupMap.get(g)!;
      entry.total++;
    }

    for (const log of presentLogs) {
      const p = participants.find((x) => x.id === log.participantId);
      if (p) {
        const entry = groupMap.get(p.group);
        if (entry) entry.presentCount++;
      }
    }

    for (const log of lateLogs) {
      if (!log.participant) continue;
      const entry = groupMap.get(log.participant.group);
      if (entry) entry.lateCount++;
    }

    const groupStats = Array.from(groupMap.entries()).map(([group, data]) => ({
      group,
      total: data.total,
      present: data.presentCount,
      absent: data.total - data.presentCount,
      late: data.lateCount,
      percent: data.total > 0 ? Math.round((data.presentCount / data.total) * 100) : 0,
    }));

    return res.status(200).json({
      session,
      summary: { total: totalParticipants, present, absent, lateCount: lateLogs.length },
      lateList,
      groupStats,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const exportPdf = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.query;

    // Determine which sessions to export
    let sessionsToExport;
    if (sessionId) {
      const s = await prisma.attendanceSession.findUnique({ where: { id: sessionId as string } });
      if (s) {
        sessionsToExport = [s];
      } else {
        // Fallback: if sessionId was provided but not found, export all sessions
        sessionsToExport = await prisma.attendanceSession.findMany({
          orderBy: [{ date: 'asc' }, { sessionNumber: 'asc' }],
        });
      }
    } else {
      sessionsToExport = await prisma.attendanceSession.findMany({
        orderBy: [{ date: 'asc' }, { sessionNumber: 'asc' }],
      });
    }

    if (sessionsToExport.length === 0) {
      return res.status(404).json({ message: 'No sessions found' });
    }

    const totalParticipants = await prisma.participant.count({ where: PESERTA_ONLY });
    const allParticipants = await prisma.participant.findMany({ where: PESERTA_ONLY });

    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      const filename = sessionId ? `laporan-sesi.pdf` : `laporan-absensi-lengkap.pdf`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).end(pdfBuffer);
    });

    const logoPath = path.join(__dirname, '../../assets/logo_warna.png');
    const hasLogo = fs.existsSync(logoPath);

    // Batas bawah area konten (hindari tulisan menabrak margin halaman).
    const BOTTOM_LIMIT = 740;
    const ensureSpace = (needed: number) => {
      if (doc.y + needed > BOTTOM_LIMIT) {
        doc.addPage();
        doc.y = 40;
      }
    };

    const dateLong = (d: Date | string) =>
      new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateShort = (d: Date | string) =>
      new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

    // Warna konsisten seperti export FGD.
    const HEADER_BG = '#1d257a';
    const ZEBRA_BG = '#eef2f7';
    const TEXT_COLOR = '#1e293b';
    const PAGE_W = doc.page.width;
    const CONTENT_W = 515;
    const TABLE_X = 40;

    // Judul seksi: bar berwarna dengan teks putih (raptah seperti FGD).
    const sectionTitle = (title: string) => {
      ensureSpace(30);
      const y = doc.y;
      doc.rect(TABLE_X, y, CONTENT_W, 24).fill(HEADER_BG);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(title, TABLE_X + 8, y + 7);
      doc.fillColor('#000000');
      doc.y = y + 30;
    };

    // Tabel dengan header berwarna, baris zebra, teks kolom rata tengah.
    const drawTable = (
      headers: string[],
      colWidths: number[],
      rows: (string | number)[][],
      firstColLeft = false,
    ) => {
      const totalW = colWidths.reduce((a, b) => a + b, 0);
      const headerH = 20;
      const rowH = 17;
      let y = doc.y;

      const drawHeader = () => {
        doc.rect(TABLE_X, y, totalW, headerH).fill(HEADER_BG);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
        let cx = TABLE_X;
        for (let i = 0; i < headers.length; i++) {
          doc.text(headers[i], cx, y + (headerH - 10) / 2, { width: colWidths[i], align: 'center' });
          cx += colWidths[i];
        }
        doc.fillColor('#000000');
        y += headerH;
      };

      drawHeader();

      for (let r = 0; r < rows.length; r++) {
        if (y + rowH > BOTTOM_LIMIT) {
          doc.addPage();
          y = TABLE_X;
          drawHeader();
        }
        if (r % 2 === 1) {
          doc.rect(TABLE_X, y, totalW, rowH).fill(ZEBRA_BG);
        }
        doc.font('Helvetica').fontSize(8.5);
        let cx = TABLE_X;
        for (let i = 0; i < rows[r].length; i++) {
          doc.fillColor(TEXT_COLOR);
          doc.text(String(rows[r][i]), cx, y + (rowH - 9) / 2, {
            width: colWidths[i],
            align: firstColLeft && i === 0 ? 'left' : 'center',
          });
          cx += colWidths[i];
        }
        y += rowH;
      }
      doc.fillColor('#000000');
      doc.y = y + 8;
    };

    // ── Cover Page ──
    if (hasLogo) {
      doc.image(logoPath, (PAGE_W - 60) / 2, 40, { width: 60 });
      doc.fontSize(22).font('Helvetica-Bold').text('Laporan Absensi CAI', TABLE_X, 90, { align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Cinta Alam Indonesia', TABLE_X, 122, { align: 'center' });
      doc.fillColor('#000000');
    } else {
      doc.fontSize(22).font('Helvetica-Bold').text('Laporan Absensi CAI', { align: 'center' });
    }
    doc.moveDown(3);

    doc.fontSize(12).font('Helvetica').text(`Laporan Lengkap Kehadiran — ${sessionsToExport.length} Sesi`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text(`Total Peserta Terdaftar: ${totalParticipants}`, { align: 'center' });
    doc.moveDown(0.5);
    const now = new Date();
    doc.text(`Dicetak: ${dateLong(now)} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, { align: 'center' });
    doc.moveDown(2);

    // Daftar sesi di halaman sampul — tabel berwarna.
    sectionTitle('DAFTAR SESI');
    drawTable(
      ['No', 'Nama Sesi', 'Hari / Tanggal', 'Jam'],
      [30, 185, 170, 130],
      sessionsToExport.map((s, i) => [
        String(i + 1),
        s.name || `Sesi ${s.sessionNumber}`,
        `${s.dayName}, ${dateShort(s.date)}`,
        `${s.startTime} — ${s.endTime}`,
      ]),
    );
    doc.moveDown(1);

    // ── Per-Session Pages ──
    for (let si = 0; si < sessionsToExport.length; si++) {
      const session = sessionsToExport[si];
      const dateStr = dateLong(session.date);
      const sessionLabel = `Sesi ${si + 1}: ${session.name}`;

      // Start each session on a new page
      doc.addPage();

      // Header dengan logo (judul di tengah)
      if (hasLogo) {
        doc.image(logoPath, (PAGE_W - 55) / 2, 28, { width: 55 });
        doc.fontSize(16).font('Helvetica-Bold').text(sessionLabel, TABLE_X, 66, { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text(
          `Cinta Alam Indonesia — ${session.dayName}, ${dateStr}`,
          TABLE_X,
          90,
          { align: 'center' },
        );
        doc.fillColor('#000000');
      } else {
        doc.fontSize(16).font('Helvetica-Bold').text(sessionLabel, { align: 'center' });
      }
      doc.moveDown(3);

      doc.fontSize(10).font('Helvetica').fillColor('#334155').text(`Jam: ${session.startTime} — ${session.endTime}`, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(1.5);

      // ── Data Sesi ──
      const presentLogs = await prisma.checkInLog.findMany({
        where: { sessionId: session.id, status: { in: ['PRESENT', 'LATE'] }, ...PESERTA_ONLY },
      });
      const present = presentLogs.length;
      const absent = totalParticipants - present;

      const lateLogs = await prisma.checkInLog.findMany({
        where: { sessionId: session.id, isLate: true, ...PESERTA_ONLY },
        orderBy: { lateDuration: 'desc' },
        include: { participant: true },
      });
      const lateList = lateLogs.filter((l) => l.participant !== null);

      // ── Ringkasan ──
      sectionTitle('RINGKASAN KEHADIRAN');
      drawTable(
        ['Keterangan', 'Jumlah'],
        [320, 195],
        [
          ['Total Peserta', totalParticipants],
          ['Hadir', present],
          ['Absen', absent],
          ['Terlambat', lateList.length],
        ],
        true,
      );
      doc.moveDown(0.5);

      // ── Performa Kelompok ──
      const groupMap = new Map<string, { total: number; presentCount: number; lateCount: number; lateList: typeof lateList }>();
      for (const p of allParticipants) {
        const g = p.group;
        if (!groupMap.has(g)) groupMap.set(g, { total: 0, presentCount: 0, lateCount: 0, lateList: [] });
        groupMap.get(g)!.total++;
      }
      for (const log of presentLogs) {
        const p = allParticipants.find((x) => x.id === log.participantId);
        if (p) {
          const entry = groupMap.get(p.group);
          if (entry) entry.presentCount++;
        }
      }
      for (const log of lateList) {
        const entry = groupMap.get(log.participant!.group);
        if (entry) {
          entry.lateCount++;
          entry.lateList.push(log);
        }
      }

      const groupStats = Array.from(groupMap.entries()).map(([group, data]) => ({
        group,
        total: data.total,
        present: data.presentCount,
        late: data.lateCount,
        percent: data.total > 0 ? Math.round((data.presentCount / data.total) * 100) : 0,
      }));

      sectionTitle('PERFORMA KELOMPOK');
      if (groupStats.length > 0) {
        drawTable(
          ['Kelompok', 'Total', 'Hadir', 'Absen', '% Kehadiran', 'Terlambat'],
          [165, 70, 70, 70, 70, 70],
          groupStats.map((gs) => [gs.group, gs.total, gs.present, gs.total - gs.present, `${gs.percent}%`, gs.late]),
          true,
        );
      } else {
        doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('Belum ada data kelompok.', { align: 'center' });
        doc.fillColor('#000000');
      }
      doc.moveDown(0.5);

      // ── Daftar Terlambat ──
      sectionTitle('DAFTAR TERLAMBAT');
      if (lateList.length > 0) {
        drawTable(
          ['No', 'Nama', 'ID', 'Kelompok', 'Durasi'],
          [35, 180, 120, 100, 80],
          lateList.map((log, i) => [
            String(i + 1),
            log.participant?.name ?? 'Tanpa Nama',
            log.participant?.id ?? log.participantId ?? 'N/A',
            log.participant?.group ?? 'Tanpa Kelompok',
            formatLateDuration(log.lateDuration),
          ]),
          true,
        );
      } else {
        doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('Tidak ada peserta terlambat pada sesi ini.', { align: 'center' });
        doc.fillColor('#000000');
      }
      doc.moveDown(1);
    }

    doc.end();
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
