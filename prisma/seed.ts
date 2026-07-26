import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
// Provide minimal declaration for `process` to satisfy TypeScript in this environment
declare const process: { exit(code?: number): never };

const prisma = new PrismaClient();

// const INITIAL_PARTICIPANTS = [
//   { id: "CAI-2026-001", name: "Achmad Fauzi", gender: "L", group: "Kelompok Semeru", origin: "Surabaya", isCheckedIn: true, checkInTime: "2026-07-15T08:15:30Z", scannedBy: "Budi (Operator)", rfidCardId: "47B2E91A" },
//   { id: "CAI-2026-002", name: "Anisa Rahmawati", gender: "P", group: "Kelompok Semeru", origin: "Sidoarjo", isCheckedIn: true, checkInTime: "2026-07-15T08:17:45Z", scannedBy: "Budi (Operator)", rfidCardId: "33A1F82B" },
//   { id: "CAI-2026-003", name: "Bagus Setiawan", gender: "L", group: "Kelompok Rinjani", origin: "Malang", isCheckedIn: false, rfidCardId: "58C3FA2C" },
//   { id: "CAI-2026-004", name: "Citra Lestari", gender: "P", group: "Kelompok Rinjani", origin: "Kediri", isCheckedIn: true, checkInTime: "2026-07-15T08:32:10Z", scannedBy: "Budi (Operator)", rfidCardId: "12D9E83F" },
//   { id: "CAI-2026-005", name: "Dedi Prasetyo", gender: "L", group: "Kelompok Merbabu", origin: "Gresik", isCheckedIn: false, rfidCardId: "69D40B3D" },
//   { id: "CAI-2026-006", name: "Eka Wahyuni", gender: "P", group: "Kelompok Merbabu", origin: "Banyuwangi", isCheckedIn: false, rfidCardId: "7AE51C4E" },
//   { id: "CAI-2026-007", name: "Fajar Nugraha", gender: "L", group: "Kelompok Bromo", origin: "Jember", isCheckedIn: true, checkInTime: "2026-07-15T08:45:00Z", scannedBy: "Budi (Operator)", rfidCardId: "91E2F38C" },
//   { id: "CAI-2026-008", name: "Gita Safitri", gender: "P", group: "Kelompok Bromo", origin: "Mojokerto", isCheckedIn: false, rfidCardId: "8BF62D5F" },
//   { id: "CAI-2026-009", name: "Hendra Wijaya", gender: "L", group: "Panitia", origin: "Surabaya", isCheckedIn: true, checkInTime: "2026-07-15T07:30:15Z", scannedBy: "System", rfidCardId: "55C2A3B4" },
//   { id: "CAI-2026-010", name: "Indah Permatasari", gender: "P", group: "Panitia", origin: "Malang", isCheckedIn: true, checkInTime: "2026-07-15T07:35:00Z", scannedBy: "System", rfidCardId: "66D3B4C5" },
//   { id: "CAI-2026-011", name: "Joko Susilo", gender: "L", group: "Tamu Undangan", origin: "Madiun", isCheckedIn: false, rfidCardId: null },
//   { id: "CAI-2026-012", name: "Kartika Sari", gender: "P", group: "Tamu Undangan", origin: "Pasuruan", isCheckedIn: false, rfidCardId: null },
//   { id: "CAI-2026-013", name: "Lukman Hakim", gender: "L", group: "Kelompok Semeru", origin: "Lamongan", isCheckedIn: false, rfidCardId: null },
//   { id: "CAI-2026-014", name: "Megawati Putri", gender: "P", group: "Kelompok Rinjani", origin: "Tuban", isCheckedIn: false, rfidCardId: null },
//   { id: "CAI-2026-015", name: "Noval Ardiansyah", gender: "L", group: "Kelompok Merbabu", origin: "Bojonegoro", isCheckedIn: false, rfidCardId: null },
// ];

// const INITIAL_LOGS = [
//   { id: "LOG-1", participantId: "CAI-2026-009", participantName: "Hendra Wijaya", group: "Panitia", timestamp: "2026-07-15T07:30:15Z", operatorName: "System", status: "success" },
//   { id: "LOG-2", participantId: "CAI-2026-010", participantName: "Indah Permatasari", group: "Panitia", timestamp: "2026-07-15T07:35:00Z", operatorName: "System", status: "success" },
//   { id: "LOG-3", participantId: "CAI-2026-001", participantName: "Achmad Fauzi", group: "Kelompok Semeru", timestamp: "2026-07-15T08:15:30Z", operatorName: "Budi (Operator)", status: "success" },
//   { id: "LOG-4", participantId: "CAI-2026-002", participantName: "Anisa Rahmawati", group: "Kelompok Semeru", timestamp: "2026-07-15T08:17:45Z", operatorName: "Budi (Operator)", status: "success" },
//   { id: "LOG-5", participantId: "CAI-2026-004", participantName: "Citra Lestari", group: "Kelompok Rinjani", timestamp: "2026-07-15T08:32:10Z", operatorName: "Budi (Operator)", status: "success" },
//   { id: "LOG-6", participantId: "CAI-2026-007", participantName: "Fajar Nugraha", group: "Kelompok Bromo", timestamp: "2026-07-15T08:45:00Z", operatorName: "Budi (Operator)", status: "success" },
// ];

async function main() {
  console.log('Clearing database...');
  await prisma.checkInLog.deleteMany({});
  await prisma.participant.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Creating users...');
  const saltRounds = 10;
  const adminPasswordHash = bcrypt.hashSync('admin123', saltRounds);
  const operatorPasswordHash = bcrypt.hashSync('operator123', saltRounds);

  // Admin user
  await prisma.user.create({
    data: {
      username: 'admin',
      password: adminPasswordHash,
      name: 'Administrator CAI',
      role: 'admin',
    },
  });

  // Operator user Budi
  await prisma.user.create({
    data: {
      username: 'budi',
      password: operatorPasswordHash,
      name: 'Budi (Operator)',
      role: 'operator',
    },
  });

  // Generic operator user
  await prisma.user.create({
    data: {
      username: 'operator',
      password: operatorPasswordHash,
      name: 'Operator Umum',
      role: 'operator',
    },
  });

  // console.log('Creating participants...');
  // for (const p of INITIAL_PARTICIPANTS) {
  //   await prisma.participant.create({
  //     data: {
  //       id: p.id,
  //       name: p.name,
  //       gender: p.gender,
  //       group: p.group,
  //       origin: p.origin,
  //       isCheckedIn: p.isCheckedIn,
  //       checkInTime: p.checkInTime ? new Date(p.checkInTime) : null,
  //       scannedBy: p.scannedBy || null,
  //       rfidCardId: p.rfidCardId || null,
  //     },
  //   });
  // }

  // console.log('Creating check-in logs...');
  // for (const log of INITIAL_LOGS) {
  //   await prisma.checkInLog.create({
  //     data: {
  //       id: log.id,
  //       participantId: log.participantId,
  //       participantName: log.participantName,
  //       group: log.group,
  //       timestamp: new Date(log.timestamp),
  //       operatorName: log.operatorName,
  //       status: log.status,
  //     },
  //   });
  // }

  console.log('Database seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

