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

    // ── Cover Page ──
    if (hasLogo) {
      doc.image(logoPath, 40, 40, { width: 60 });
      doc.fontSize(22).font('Helvetica-Bold').text('Laporan Absensi CAI', 110, 48);
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Cinta Alam Indonesia', 110, 76);
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

    // Session index list on cover
    doc.fontSize(12).font('Helvetica-Bold').text('Daftar Sesi:', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    sessionsToExport.forEach((s, i) => {
      doc.text(`  ${i + 1}.  ${s.name}  —  ${s.dayName}, ${dateShort(s.date)}  (${s.startTime} — ${s.endTime})`);
    });
    doc.moveDown(1);

    // ── Per-Session Pages ──
    for (let si = 0; si < sessionsToExport.length; si++) {
      const session = sessionsToExport[si];
      const dateStr = dateLong(session.date);
      const sessionLabel = `Sesi ${si + 1}: ${session.name}  (${session.dayName}, ${dateStr})`;

      // Start each session on a new page
      doc.addPage();

      // Header with logo
      if (hasLogo) {
        doc.image(logoPath, 40, 35, { width: 55 });
        doc.fontSize(16).font('Helvetica-Bold').text(sessionLabel, 105, 40);
        doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Cinta Alam Indonesia', 105, 62);
        doc.fillColor('#000000');
      } else {
        doc.fontSize(16).font('Helvetica-Bold').text(sessionLabel, { align: 'center' });
      }
      doc.moveDown(3);

      doc.fontSize(10).font('Helvetica').text(`Jam: ${session.startTime} — ${session.endTime}`);
      doc.moveDown(0.8);

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
      doc.fontSize(12).font('Helvetica-Bold').text('Ringkasan');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Total Peserta   : ${totalParticipants}`);
      doc.text(`Hadir            : ${present}`);
      doc.text(`Absen            : ${absent}`);
      doc.text(`Terlambat        : ${lateList.length}`);
      doc.moveDown(1);

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

      if (groupStats.length > 0) {
        ensureSpace(50);
        doc.fontSize(12).font('Helvetica-Bold').text('Performa Kelompok');
        doc.moveDown(0.3);

        const gTableTop = doc.y;
        const gColWidths = [120, 60, 60, 80, 80];
        const gHeaders = ['Kelompok', 'Total', 'Hadir', '% Kehadiran', 'Terlambat'];

        doc.fontSize(9).font('Helvetica-Bold');
        let gx = 40;
        for (let i = 0; i < gHeaders.length; i++) {
          doc.text(gHeaders[i], gx, gTableTop, { width: gColWidths[i], align: 'center' });
          gx += gColWidths[i];
        }

        doc.font('Helvetica').fontSize(8);
        for (let i = 0; i < groupStats.length; i++) {
          const gs = groupStats[i];
          const rowY = gTableTop + 15 + i * 14;
          let rx = 40;
          const vals = [gs.group, String(gs.total), String(gs.present), `${gs.percent}%`, String(gs.late)];
          for (let j = 0; j < vals.length; j++) {
            doc.text(vals[j], rx, rowY, { width: gColWidths[j], align: 'center' });
            rx += gColWidths[j];
          }
        }
        doc.y = gTableTop + 15 + groupStats.length * 14 + 10;
        doc.moveDown(1);
      }

      // ── Daftar Terlambat per Kelompok ──
      const groupsWithLate = groupStats.filter((g) => g.late > 0);
      if (groupsWithLate.length > 0) {
        ensureSpace(40);
        doc.fontSize(12).font('Helvetica-Bold').text('Daftar Terlambat per Kelompok');
        doc.moveDown(0.3);

        const lColWidths = [30, 150, 90, 90];
        const lHeaders = ['No', 'Nama', 'ID', 'Durasi'];

        for (const gs of groupsWithLate) {
          const entry = groupMap.get(gs.group)!;
          ensureSpace(60);
          doc.fontSize(10).font('Helvetica-Bold').text(`Kelompok ${gs.group}`);
          doc.moveDown(0.2);

          let rowIndex = 0;
          let displayNo = 0;
          const drawLateHeader = () => {
            const top = doc.y;
            doc.fontSize(9).font('Helvetica-Bold');
            let x = 40;
            for (let k = 0; k < lHeaders.length; k++) {
              doc.text(lHeaders[k], x, top, { width: lColWidths[k], align: 'center' });
              x += lColWidths[k];
            }
            doc.font('Helvetica').fontSize(8);
            return top;
          };
          let tableTop = drawLateHeader();

          entry.lateList.forEach((log) => {
            displayNo++;
            const rowY = tableTop + 15 + rowIndex * 14;
            if (rowY + 14 > BOTTOM_LIMIT) {
              // Lanjut ke halaman baru + ulangi header kolom
              doc.addPage();
              tableTop = drawLateHeader();
              rowIndex = 0;
            }
            const currentRowY = tableTop + 15 + rowIndex * 14;
            let rx = 40;
            const vals = [
              String(displayNo),
              log.participant?.name ?? 'Tanpa Nama',
              log.participant?.id ?? log.participantId ?? 'N/A',
              formatLateDuration(log.lateDuration),
            ];
            for (let j = 0; j < vals.length; j++) {
              doc.text(vals[j], rx, currentRowY, { width: lColWidths[j], align: 'center' });
              rx += lColWidths[j];
            }
            rowIndex++;
          });
          doc.y = tableTop + 15 + rowIndex * 14 + 6;
          doc.moveDown(1);
        }
      }
    }

    doc.end();
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
