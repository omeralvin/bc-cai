import { Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import PDFDocument from 'pdfkit';

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

    // ── Cover Page ──
    doc.fontSize(22).font('Helvetica-Bold').text('Laporan Absensi CAI', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(`Laporan Lengkap Kehadiran — ${sessionsToExport.length} Sesi`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text(`Total Peserta Terdaftar: ${totalParticipants}`, { align: 'center' });
    doc.moveDown(0.5);
    const now = new Date();
    doc.text(`Dicetak: ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, { align: 'center' });
    doc.moveDown(2);

    // Session index list on cover
    doc.fontSize(12).font('Helvetica-Bold').text('Daftar Sesi:', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    sessionsToExport.forEach((s, i) => {
      const dateStr = new Date(s.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      doc.text(`  ${i + 1}.  ${s.name}  —  ${s.dayName}, ${dateStr}  (${s.startTime} — ${s.endTime})`);
    });
    doc.moveDown(1);

    // ── Per-Session Pages ──
    for (let si = 0; si < sessionsToExport.length; si++) {
      const session = sessionsToExport[si];
      const dateStr = new Date(session.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      // Start each session on a new page
      doc.addPage();

      // Session Header
      doc.fontSize(16).font('Helvetica-Bold').text(
        `Sesi ${si + 1}: ${session.name}  (${session.dayName}, ${dateStr})`,
        { align: 'left' }
      );
      doc.fontSize(10).font('Helvetica').text(`Jam: ${session.startTime} — ${session.endTime}`);
      doc.moveDown(0.5);

      // ── Summary ──
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

      doc.fontSize(12).font('Helvetica-Bold').text('Ringkasan');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Total Peserta   : ${totalParticipants}`);
      doc.text(`Hadir            : ${present}`);
      doc.text(`Absen            : ${absent}`);
      doc.text(`Terlambat        : ${lateLogs.length}`);
      doc.moveDown(1);

      // ── Late List Table ──
      const lateListFiltered = lateLogs.filter((l) => l.participant !== null);
      if (lateListFiltered.length > 0) {
        doc.fontSize(12).font('Helvetica-Bold').text('Daftar Terlambat');
        doc.moveDown(0.3);

        const tableTop = doc.y;
        const colWidths = [30, 140, 70, 80, 100];
        const headers = ['No', 'Nama', 'ID', 'Kelompok', 'Durasi (mnt)'];

        doc.fontSize(9).font('Helvetica-Bold');
        let x = 40;
        for (let i = 0; i < headers.length; i++) {
          doc.text(headers[i], x, tableTop, { width: colWidths[i], align: 'center' });
          x += colWidths[i];
        }

        doc.font('Helvetica').fontSize(8);
        for (let i = 0; i < lateListFiltered.length; i++) {
          const log = lateListFiltered[i];
          const rowY = tableTop + 15 + i * 14;
          let rx = 40;
          const vals = [
            String(i + 1),
            log.participant?.name ?? 'Tanpa Nama',
            log.participant?.id ?? log.participantId ?? 'N/A',
            log.participant?.group ?? 'Tanpa Kelompok',
            String(log.lateDuration ?? '-'),
          ];
          for (let j = 0; j < vals.length; j++) {
            doc.text(vals[j], rx, rowY, { width: colWidths[j], align: 'center' });
            rx += colWidths[j];
          }
        }
        doc.moveDown(1.5);
      }

      // ── Group Performance Table ──
      const groupMap = new Map<string, { total: number; presentCount: number; lateCount: number }>();
      for (const p of allParticipants) {
        const g = p.group;
        if (!groupMap.has(g)) groupMap.set(g, { total: 0, presentCount: 0, lateCount: 0 });
        groupMap.get(g)!.total++;
      }
      for (const log of presentLogs) {
        const p = allParticipants.find((x) => x.id === log.participantId);
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
        percent: data.total > 0 ? Math.round((data.presentCount / data.total) * 100) : 0,
      }));

      if (groupStats.length > 0) {
        doc.fontSize(12).font('Helvetica-Bold').text('Performa Kelompok');
        doc.moveDown(0.3);

        const gTableTop = doc.y;
        const gColWidths = [120, 60, 60, 80];
        const gHeaders = ['Kelompok', 'Total', 'Hadir', '% Kehadiran'];

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
          const vals = [gs.group, String(gs.total), String(gs.present), `${gs.percent}%`];
          for (let j = 0; j < vals.length; j++) {
            doc.text(vals[j], rx, rowY, { width: gColWidths[j], align: 'center' });
            rx += gColWidths[j];
          }
        }
      }
    }

    doc.end();
  } catch (error: any) {
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
