/**
 * Penentuan status keterlambatan absen.
 *
 * Logika ini dipakai saat tap check-in (checkin.controller) DAN dihitung ulang
 * saat admin mengubah Jam Masuk / Batas Toleransi sebuah sesi (session.controller).
 */

/**
 * Bandingkan waktu check-in dengan jam mulai sesi (waktu WIB).
 * Mengembalikan { isLate, lateDuration } di mana lateDuration = menit keterlambatan
 * (dibulatkan ke atas) bila check-in terjadi setelah jam mulai sesi.
 */
export function computeLateStatus(checkInTime: Date, sessionStartTime: string): { isLate: boolean; lateDuration: number | null } {
  const wib = new Date(checkInTime.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const [hours, minutes] = sessionStartTime.split(':').map(Number);
  const sessionStart = new Date(wib);
  sessionStart.setHours(hours, minutes, 0, 0);

  if (wib <= sessionStart) {
    return { isLate: false, lateDuration: null };
  }

  const diffMs = wib.getTime() - sessionStart.getTime();
  const lateDuration = Math.ceil(diffMs / (1000 * 60));

  return { isLate: true, lateDuration };
}

/**
 * Format durasi keterlambatan (menit) menjadi teks yang mudah dibaca.
 * Sinkron dengan FrontEnd/src/utils/format.ts (formatLateDuration).
 * - <= 60 menit -> "12 menit" / "60 menit"
 * - > 60 menit  -> "2 jam 15 menit", "5 jam 0 menit"
 */
export function formatLateDuration(minutes?: number | null): string {
  const total = Math.max(0, Math.floor(minutes ?? 0));
  if (total <= 60) {
    return `${total} menit`;
  }
  const jam = Math.floor(total / 60);
  const sisa = total % 60;
  return `${jam} jam ${sisa} menit`;
}