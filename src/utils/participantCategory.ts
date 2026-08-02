/**
 * Kategori Peserta vs Panitia.
 *
 * Nilai field `keterangan` (disimpan di kolom `origin` tabel Participant)
 * menentukan kategori tipe peserta. Sebagian nilai adalah jabatan panitia
 * (mis. Pemateri, 4S Daerah, Panitia); sisanya adalah peserta biasa.
 *
 * Sistem tetap mencatat jabatan spesifik pada kolom `origin`, namun kategori
 * dipakai untuk aturan absensi (sesi khusus & pengecualian statistik).
 */
export type ParticipantCategory = 'PESERTA' | 'PANITIA';

/** Jenis audience sebuah sesi absensi. */
export type SessionAudience = 'ALL' | 'PESERTA' | 'PANITIA';

/** Daftar jabatan yang termasuk kategori PANITIA (pencocokan sebagian, case-insensitive). */
export const PANITIA_ROLES: string[] = [
  'Panitia',
  'Pemateri',
  '4S Daerah',
];

/**
 * Tentukan kategori peserta berdasarkan nilai `keterangan` (origin).
 * Mengembalikan 'PANITIA' bila keterangan mengandung salah satu jabatan panitia,
 * selain itu 'PESERTA'. Nilai kosong dianggap PESERTA.
 */
export function getParticipantCategory(keterangan?: string | null): ParticipantCategory {
  if (!keterangan) return 'PESERTA';
  const normalized = keterangan.trim().toLowerCase();
  if (!normalized) return 'PESERTA';
  const isPanitia = PANITIA_ROLES.some((role) =>
    normalized.includes(role.toLowerCase())
  );
  return isPanitia ? 'PANITIA' : 'PESERTA';
}