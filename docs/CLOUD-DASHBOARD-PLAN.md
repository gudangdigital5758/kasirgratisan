# Profitku Cloud Dashboard — rencana & progres (`cloud.profitku.my.id`)

> Keputusan: `docs/DECISIONS.md` (2026-08-13). Implementasi di repo **profitku-cloud**
> (`apps/cloud`), kecuali disebut lain. Dokumen ini = tracking progres fase.

## Masalah

Settings POS (`profitku.my.id`) mencampur fitur offline (profil toko, receipt, user PIN)
dengan fitur cloud (langganan, backup, sync, toko online). User awam pusing. Contoh
terparah: halaman "Toko Online & Market" (`CloudOnlineStoreSettings.tsx`, 1.352 baris)
— 5 blok, 6 tombol simpan, validasi toast berantai, i18n bocor, self-XSS S3, tapi
semua API-nya sudah siap di server.

## Solusi

**`cloud.profitku.my.id`** = dashboard terpusat owner toko. Semua pengelolaan cloud
pindah ke sini; Settings POS menyisakan satu kartu "Profitku Cloud" + deep-link.

| Aspek | Keputusan |
|---|---|
| Repo | `profitku-cloud` — app baru `apps/cloud` (Vite + React + react-router + CSS polos, konvensi repo) |
| Auth | Supabase Google (pola `apps/affiliate`) |
| API | `api.profitku.my.id` (Worker POS) — endpoint dipakai ulang, nol backend baru |
| Deploy | Cloudflare Pages `profitku-cloud-dashboard` + custom domain |
| UI desktop | sidebar kiri (scrollbar sendiri) + konten kanan (scrollbar sendiri) — `height:100vh`, CSS murni |
| UI mobile | header + hamburger **kanan atas** + drawer slide-over (dari kanan) |
| Batas | POS offline-first tidak tersentuh; restore via unduh + impor di kasir (IndexedDB per-origin) |
| i18n | Bahasa Indonesia (konvensi profitku-cloud). `ponytail:` i18n id/en/ms menyusul saat user non-Indonesia |

## Workflow per fase

```
implementasi → review → test → perbaiki error → review+test ulang → (migrasi jika ada)
→ commit+push → deploy → lapor → TUNGGU persetujuan user → fase berikutnya
```

## Fase A — Portal Cloud (✅ kode+test+deploy; sisa langkah manual di bawah)

- [x] A0.1 Pages project `profitku-cloud-dashboard` dibuat + deploy pertama (custom domain `cloud.profitku.my.id` = **manual** di dashboard Cloudflare)
- [ ] A0.2 Google OAuth origin `https://cloud.profitku.my.id` — **manual** Google Console (authorized JS origins)
- [ ] A0.3 Supabase redirect `cloud.profitku.my.id/**` — **manual** (Auth → URL Configuration)
- [x] A0.4 CORS Worker POS: `CLOUD_ORIGIN` + localhost:5181 (deployed)
- [x] A0.5 `DECISIONS.md` amend 2026-08-12 + keputusan 2026-08-13 (kode)
- [x] A1 Scaffold `apps/cloud` + `AppShell` (sidebar/drawer) + menu 10 item
- [x] A2 Ringkasan: profile, KPI storage/langganan, kartu toko, buat toko, deep-link `?store=`
- [x] A3 Toko & Langganan: list toko, keranjang subscribe/renew (1/6/12 bln), voucher, checkout batch, polling verify, riwayat
- [x] A4 Backup & Restore: pilih toko, list backup, unduh file, hapus, panduan restore 4 langkah
- [x] A5 Toko Online: pindah penuh (URL+check avail, detail+GPS, jam operasional, logo, checklist live visibilitas, satu tombol Simpan; print via stylesheet — fix S3)
- [x] A6 POS: kartu "Profitku Cloud" di Settings + i18n id/en/ms + `BRAND.cloudOrigin`
- [x] A7 Review + test loop — lint 0 error, worker tsc clean, `npm run build` POS + cloud hijau, vitest 121/121 (3 error pool-timeout infra, bukan kegagalan test), smoke preview 200
- [x] A8 Commit + push (profitku-cloud `8b09fe5`, kasirgratisan `10d2cda`) + deploy Worker POS (`profitku-api`) + Pages (`profitku-cloud-dashboard`, root 200)
- [ ] A8.4 Lapor + tunggu persetujuan → Fase B

**Deviasi sengaja (dictatat):**
- QR code cetak tidak ikut di v1 dashboard (link kanonik cukup; `ponytail:` tambah QR saat butuh cetak fisik).
- Peta Leaflet tidak ikut; GPS locate tetap ada (bundle lebih ringan; `ponytail:` tambah peta saat diperlukan).
- i18n app cloud = Bahasa Indonesia (konvensi repo profitku-cloud).

## Fase B — Laporan & Grafik (✅ kode+test+deploy; verifikasi data riil menyusul)

- [x] B1 Migrasi RPC agregasi — `fn_report_summary` (sudah ada 2026-08-06) + `fn_report_detail` baru (20260813120000): per kasir (via shift), stok terkini (snapshot LWW), hutang, info sync terakhir
- [x] B2 Halaman `/reports`: KPI transaksi/omzet/laba/hutang, grafik batang harian (CSS murni, tanpa library), top produk, per kasir, stok, hutang; filter rentang (hari ini/7/30/bulan) + per toko
- [x] B3 Banner jujur "Data per [last sync]" (dari `sync_meta.last_push_at` + device count)
- [x] B4 Keputusan merge: **laporan kanonik = `/reports` di cloud.profitku.my.id**; `report.profitku.my.id` TIDAK di-retire (tetap jalan, data source sama) — hindari bookmark rusak; retire = keputusan terpisah
- [x] B5 Test loop — build app cloud hijau, typecheck middleware bersih, route `/api/v1/reports/detail` live (401 tanpa token), migrasi terverifikasi ada di DB (PostgREST resolve, bukan 404)
- [x] B6 Commit (`e409665`) + push + deploy middleware + Pages
- [x] B7 Verifikasi data riil — **live test penuh (26 PASS · 0 FAIL)**: backup upload/list/download/delete, sync push 11 record sintetis, laporan summary (2 tx · Rp 55.000 omzet · Rp 24.500 profit — angka cocok persis), detail (kasir/stok 3 produk/hutang), checkout renew → payment link. Akun `profitkutest@gmail.com` berlangganan; store demo dipertahankan (`d0cf24f2…`). Skrip: `profitku-cloud/scripts/live-test.mjs`
- [ ] B8 Lapor + tunggu persetujuan → Fase C

**Catatan keterbatasan (tercatat):**
- Per **kategori** tidak bisa dari sync data saat ini — `products.categoryId` lokal tanpa `categorySyncId`, dan `id` lokal tidak ikut di-sync. `ponytail:` tambah `categorySyncId` di products (allowlist worker + backfill Dexie) saat perlu laporan per kategori.
- Per kasir diambil dari **shift yang ditutup** (`cashierShifts.userName`), bukan dari `transactions.createdBy` (users lokal id tidak di-sync).
- `supabase db push` sempat menggantung di mesin ini setelah apply; migrasi diverifikasi via PostgREST. 18 migrasi shared disalin dari repo kasirgratisan agar history CLI sejalan.

## Fase C — Tim & Roles Cloud (✅ C1–C3; C4 integrasi POS = keputusan terpisah)

- [x] C1 Migrasi `cloud_team_members` (store_id, user_id, role: admin/kasir/salesman/kepala_gudang/karyawan, invite_email + invite_state pending/active/revoked) + RLS (baca owner/member, tulis owner) — `20260813160000`
- [x] C2 Endpoint worker POS: `GET /stores/:id/team` (owner/member) · `POST .../team/invite` (email terdaftar → active, belum → pending) · `PATCH .../team/:memberId` (role) · `DELETE .../team/:memberId` — ownership diverifikasi server
- [x] C3 Halaman `/team` di dashboard: daftar anggota + pemilik, undang via email, ubah role (select), hapus (confirm) — menu "Tim & Peran" aktif
- [ ] C4 POS enforcement — **ditunda, butuh keputusan model auth**: role cloud belum otomatis mengubah `can()` di aplikasi kasir. Opsi: (a) PIN di-set owner via dashboard lalu sync ke POS, (b) login email OTP. `ponytail:` implementasi setelah keputusan ini
- [ ] C5 Live test endpoint tim (butuh token baru) + matrix permission
- [ ] C6 Migrasi + commit + push + deploy — ✅ migrasi/commit/deploy sudah (kasirgratisan `73403e8`, profitku-cloud `6293449`)
- [ ] C7 Lapor + tunggu persetujuan → Fase D

**Catatan:** undangan belum mengirim email notifikasi (v1 tersimpan sebagai pending) — `ponytail:` notif Resend/Fonnte saat user menerima undangan.

## Fase D — Diskon Bertingkat + Affiliate Toko + Integrasi Leaf

- [ ] D1 Migrasi `price_rules` (store_id, product_id, tier qty → %) + RPC
- [ ] D2 UI Diskon Bertingkat per produk
- [ ] D3 Scope: market-only dulu (kasir offline = keputusan terpisah)
- [ ] D4 Affiliate toko: kolom link Shopee/TikTok per toko + tampil di storefront market
- [ ] D5 Aktifkan menu Sales/AI/Market di sidebar
- [ ] D6 Test + migrasi + commit + push + deploy
- [ ] D7 Lapor hasil final

## Referensi API (dipakai ulang, tidak berubah)

| Endpoint | Fungsi |
|---|---|
| `GET /api/user/profile` | profil + entitlements + storage + backups |
| `GET/POST /api/stores`, `PUT/DELETE /api/stores/:id` | kelola toko |
| `PATCH /api/stores/:id/identifier` · `GET /api/stores/identifier/check` | URL toko |
| `PATCH /api/stores/:id/visibility` | tampil di market |
| `PUT /api/stores/:id` · `POST/DELETE /api/stores/:id/logo` | detail + logo |
| `GET /api/destinations/{provinces,cities/:id,districts/:id}` | cascading wilayah |
| `GET /api/backups` · `GET /api/backups/:id/download` · `DELETE /api/backups/:id` | backup |
| `POST /api/payments/checkout-batch` · `POST /api/payments/verify/:id` · `GET /api/payments/history` | langganan |
| `POST /api/vouchers/preview` | voucher |
