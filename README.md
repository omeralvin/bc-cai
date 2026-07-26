# CAI Presensi - Backend API

API Backend untuk prototype aplikasi absensi CAI. Dibuat menggunakan **Express.js**, **TypeScript**, dan **Prisma ORM v6** dengan database **SQLite**.

## Prasyarat
- Node.js v18 atau v20+
- npm (Node Package Manager)

## Struktur Folder
- `prisma/`: Menyimpan skema Prisma (`schema.prisma`) dan skrip seed (`seed.ts`).
- `src/`: Folder source code TypeScript utama.
  - `controllers/`: Berisi logika request-response handler.
  - `middlewares/`: Middleware untuk autentikasi JWT dan pengecekan otorisasi role.
  - `routes/`: Pengaturan routing endpoint API.
  - `utils/`: Modul utilitas penunjang seperti JWT.
  - `index.ts`: Entrypoint server Express.
  - `prisma.ts`: Instansiasi tunggal PrismaClient.

## Langkah Setup & Menjalankan Aplikasi

1. **Instalasi Dependensi**
   Jalankan perintah berikut di folder `BackEnd`:
   ```bash
   npm install
   ```

2. **Konfigurasi Environment**
   Salin file `.env.example` menjadi `.env` lalu sesuaikan isinya jika diperlukan:
   ```bash
   cp .env.example .env
   ```

3. **Migrasi Database & Seeding Data**
   Jalankan perintah di bawah ini untuk membuat tabel database SQLite (`dev.db`), generate Prisma client, dan mengisi data awal (mock data):
   ```bash
   # Melakukan migrasi database (membuat skema tabel)
   npx prisma migrate dev --name init

   # Mengisi database dengan data awal
   npm run prisma:seed
   ```

4. **Menjalankan Server (Mode Development)**
   Jalankan server lokal dengan reload otomatis saat ada perubahan kode:
   ```bash
   npm run dev
   ```
   Server akan berjalan secara default di `http://localhost:5000`.

## Detail Autentikasi Pengguna Seeded
- **Admin**:
  - Username: `admin`
  - Password: `admin123`
- **Operator**:
  - Username: `budi`
  - Password: `operator123`
- **Operator Umum**:
  - Username: `operator`
  - Password: `operator123`

## Endpoint API

### 1. Autentikasi (`/api/auth`)
- `POST /login`: Login pengguna dan mendapatkan JWT token.
- `GET /me` (Protected): Mengambil profil pengguna yang sedang login berdasarkan token.

### 2. Peserta (`/api/participants`)
- `GET /` (Protected): Mengambil daftar semua peserta.
- `POST /` (Protected): Menambahkan peserta baru.
- `PUT /:id` (Protected): Mengubah detail peserta.
- `DELETE /:id` (Protected): Menghapus peserta.
- `POST /import` (Protected): Melakukan import data banyak peserta sekaligus.
- `POST /reset` (Protected, Admin Only): Mereset status kehadiran semua peserta menjadi belum hadir dan mengosongkan log absensi.

### 3. Absensi / Check-In (`/api/checkin`)
- `POST /` (Protected): Melakukan check-in peserta menggunakan `participantId` atau scan `rfidCardId`.
- `GET /logs` (Protected): Mengambil daftar riwayat check-in logs terbaru.
