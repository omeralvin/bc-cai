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