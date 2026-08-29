# DEPLOY ONLINE — E-VOTING OSIS

## Rekomendasi arsitektur
Web: Render
Database: PostgreSQL (Supabase/Neon/Render Postgres)

## 1. Buat database PostgreSQL
Buat project PostgreSQL pada provider pilihan.
Salin connection string PostgreSQL sebagai `DATABASE_URL`.

## 2. Upload project ke GitHub
Ekstrak ZIP, lalu buat repository GitHub dan upload seluruh isi folder.

## 3. Deploy web
Di Render pilih New > Web Service, hubungkan repository GitHub.
Build Command:
`npm install`
Start Command:
`npm start`

Environment variables:
- `NODE_ENV=production`
- `DATABASE_URL=<connection string PostgreSQL>`
- `DATABASE_SSL=true`
- `SESSION_SECRET=<random string minimal 32 karakter>`
- `DEFAULT_ADMIN_USERNAME=<username admin>`
- `DEFAULT_ADMIN_PASSWORD=<password admin kuat>`

## 4. Setelah deploy
Buka URL Render. Endpoint `/health` harus menampilkan:
`{"ok":true}`

## 5. Login
Gunakan username/password admin yang kamu masukkan sebagai environment variable.
Jangan membagikan password admin kepada pemilih.

## Keamanan penting
- Jangan commit file `.env` ke GitHub.
- Gunakan HTTPS dari hosting.
- Ganti password admin default.
- Backup PostgreSQL sebelum pemilihan.
- Untuk pemilihan resmi, tambahkan audit log, penguncian periode voting, export hasil, dan kontrol akses admin tambahan.
- Jangan memakai data siswa asli pada demo sebelum konfigurasi keamanan dan kebijakan privasi sekolah selesai.
