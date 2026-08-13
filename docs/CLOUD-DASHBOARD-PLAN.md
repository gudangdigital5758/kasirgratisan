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

## Fase B — Laporan & Grafik (dari `sync_records`)

- [ ] B1 Migrasi RPC agregasi (penjualan harian/per produk/per kategori/per kasir, hutang, stok, shift) — profitku-cloud/supabase
- [ ] B2 Halaman Laporan: grafik + tabel, filter rentang + per toko
- [ ] B3 Banner jujur "Data per [last sync]"
- [ ] B4 Keputusan merge `report.profitku.my.id` → redirect ke cloud.profitku.my.id/laporan
- [ ] B5 Test loop + migrasi + commit + push + deploy
- [ ] B6 Lapor + tunggu persetujuan → Fase C

## Fase C — Tim & Roles Cloud

- [ ] C1 Migrasi `cloud_team_members` (user_id, store_id, role: admin/kasir/salesman/kepala_gudang, invite state) + RLS
- [ ] C2 RPC/endpoint undang/list/ganti-role/hapus
- [ ] C3 UI Tim & Peran di dashboard
- [ ] C4 POS: sync role cloud → `can()` (hanya toko cloud; PIN lokal tetap untuk toko offline)
- [ ] C5 Test multi-device + permission matrix
- [ ] C6 Migrasi + commit + push + deploy
- [ ] C7 Lapor + tunggu persetujuan → Fase D

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
