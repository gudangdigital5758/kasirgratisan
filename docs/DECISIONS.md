# Profitku — Decisions

Keputusan teknis yang **stabil**. Ubah hanya dengan catatan baru (jangan hapus history).  
Runtime/session continuity agent → `PROJECT_STATE.md` lokal (gitignored), bukan file ini.

---

## 2026-07-23 — Produk bernama Profitku, domain profitku.my.id

**Status:** Accepted

Rebrand dari FreeKasir/kasirgratisan untuk distribusi gudangdigital.

- Display name: **Profitku**
- Web: `profitku.my.id` · API: `api.profitku.my.id`
- Android applicationId: `com.profitku.app`
- Konstanta terpusat: `src/lib/brand.ts`

**Implications:** Watermark struk, i18n, PWA manifest, dan link komunitas mengikuti brand ini.

---

## 2026-07-23 — IndexedDB name & session key legacy dipertahankan

**Status:** Accepted

Database browser tetap `kasirgratisan-db`. Key multi-user session legacy tidak di-rename massal.

**Why:** Mengganti nama DB menghapus data toko user yang sudah jalan.

**Implications:** Internal id boleh “kasirgratisan”; UI menampilkan Profitku. Migrasi rename DB hanya dengan path upgrade eksplisit + komunikasi user.

---

## 2026-07-23 — Satu paket Cloud Rp 25.000 / bulan

**Status:** Accepted

Mengganti multi-tier (storage/sync/addon terpisah) dengan:

| Field | Value |
|-------|--------|
| id | `cloud_monthly` |
| price | 25_000 IDR / month |
| storage | 2048 MB |
| max stores | 1 |

Seed: `supabase/seed.sql` · fallback Worker: `workers/api/src/data/seed-plans.ts` · brand: `BRAND.cloud*`.

**Implications:** UI langganan satu tombol; entitlements digabung (`isSubscribed` ≈ cloud aktif). Multi-tier baru butuh decision baru + migrasi harga.

---

## 2026-07-23 — Google Play listing ditunda

**Status:** Accepted

Distribusi utama: **PWA** di `profitku.my.id`.

- `BRAND.playStoreEnabled = false`
- Alert unduh Play & Google Play Billing di UI dimatikan
- Checkout langganan lewat web payment (mock → gateway)

**Implications:** Package Android tetap disiapkan; publish Play adalah keputusan terpisah (fee ~$25 sekali, plus compliance).

---

## 2026-07-23 — Offline POS gratis; cloud opsional

**Status:** Accepted

- Fitur kasir/stok/laporan/multi-user lokal **tidak** di balik paywall.
- Cloud: backup, sync (bertahap), notifikasi, hilangkan watermark (sesuai entitlements).

**Implications:** Regression test mental: “airplane mode masih bisa jualan?”

---

## 2026-07-23 — Cloud stack: CF Worker + Supabase + R2 + Resend + Fonnte

**Status:** Accepted

| Concern | Choice |
|---------|--------|
| API | Cloudflare Workers (`workers/api`, Hono) |
| Auth / DB | Supabase (Auth Google, Postgres, RLS) |
| Backup files | Cloudflare R2 |
| Email | Resend |
| WhatsApp | Fonnte |
| Payment | Mock dulu; Midtrans/Xendit kemudian |

**Implications:** Service role & provider tokens hanya di Worker secrets. Client hanya anon key + Google client id.

---

## 2026-07-23 — Supabase Auth menggantikan Google JWT long-lived sebagai sesi cloud

**Status:** Accepted

Login tetap via Google ID token, lalu:

1. `supabase.auth.signInWithIdToken` (utama)
2. Fallback `POST /api/auth/google` di Worker
3. Legacy Google JWT di localStorage hanya jika `VITE_SUPABASE_*` kosong (dev)

**Implications:** Production wajib set Supabase; Worker validasi Bearer lewat Auth API.

---

## 2026-07-30 — Cloud auth fail-closed tanpa fallback JWT legacy

**Status:** Accepted

Cloud API tidak lagi menerima Google ID JWT yang hanya di-decode dari client. Bila konfigurasi Supabase tidak lengkap, login dan endpoint cloud ditolak; POS offline tetap tersedia.

**Why:** Payload JWT tanpa verifikasi signature, issuer, audience, dan expiry dapat dipalsukan saat konfigurasi Worker tidak lengkap.

**Implications:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, dan `SUPABASE_ANON_KEY` wajib untuk fitur cloud. Token legacy di localStorage dibersihkan dan tidak direstore.

---

## 2026-07-23 — Agent workflow: AGENTS.md + approval-aware

**Status:** Accepted

- Repo punya `AGENTS.md` (bootstrap, boundary, validation, commit messages).
- Diinspirasi proses MSC Studio; **bukan** copy path MSC.
- `PROJECT_STATE.md` boleh ada lokal untuk continuity Codex; **gitignore**.

**Implications:** Agent baru harus baca docs map sebelum ubah arsitektur.

---

## 2026-07-23 — Kode approve agent: 1526 dan 5647

**Status:** Accepted

Untuk mengunci eksekusi (edit/implementasi), user dapat mengirim salah satu:

- **`1526`**
- **`5647`**

Keduanya setara `APPROVE` / `EKSEKUSI` / `EXECUTE` / `APPLY PATCH`.  
Permintaan implementasi yang eksplisit tetap dihitung approve.  
Detail: `AGENTS.md` → **Approval codes**.

**Implications:** Agent tidak mengedit file hanya karena diskusi; butuh kode atau perintah kerja yang jelas.

---

## 2026-07-23 — Checkout / open bill atomik + stok dari DB

**Status:** Accepted

Operasi kasir sensitif (save open bill, cancel, checkout) lewat `src/lib/cashier-ops.ts`:

- Multi-table Dexie `transaction('rw', …)`
- Penyesuaian stok membaca **stok terkini di IndexedDB**, bukan nilai di memori cart
- Tolak oversell (`CashierOpsError`)

**Implications:** UI `Cashier.tsx` memanggil helper; jangan tulis stok ad-hoc di page tanpa path yang sama.

---

## 2026-07-24 — Voucher promo langganan Cloud

**Status:** Accepted

Kode voucher **hanya** untuk langganan Profitku Cloud (`cloud_monthly`), bukan diskon kasir POS.

| Field | Keputusan |
|-------|-----------|
| Tipe v1 | `percent` (1–100), `free_days` (hari gratis), `lifetime` (seumur hidup) |
| Harga | Dihitung di Worker; client tidak dipercaya untuk amount |
| Amount 0 | Skip Midtrans; fulfill langsung (`provider=voucher`) |
| User aktif | Boleh klaim → perpanjang dari `max(now, period_end)` |
| Lifetime | `subscriptions.is_lifetime` + `period_end` far-future; cek akses: lifetime OR period_end > now |
| Buat kode | Admin dashboard (`/vouchers`) + API `/admin/api/vouchers` |
| Klaim user | Cloud Hub input kode → preview → checkout dengan `voucherCode` |

**Implications:** Migrasi `20260724180000_vouchers.sql`. Jangan stack multi-kode di satu checkout. Admin boleh disable kode; klaim lifetime yang sudah jalan tetap sampai dicabut manual (v1.1).

---

## 2026-07-27 — Backup cloud retention 30 hari

**Status:** Accepted

File backup di R2 disimpan maksimal **30 hari**. Setelah itu dihapus otomatis via cron job daily.

**Why:** 
- Cost efficiency: Hindari storage cost terus naik (terutama untuk user lifetime free)
- Recovery window cukup: 30 hari reasonable untuk restore data
- Predictable cost: ~$0.03/user/month maksimal

**Implementation:**
- Cron job daily 01:00 UTC (`scheduled` handler Worker)
- Function `cleanupExpiredBackups()` query backup `created_at < (now - 30 days)`
- Delete dari R2 + Supabase metadata
- Manual endpoint: `POST /api/cron/cleanup-backups` (admin/debug)

---

## 2026-08-05 — Langganan Cloud per TOKO (unlimited device) + storage 1024 MB

**Status:** Accepted

Harga tetap **Rp 25.000/bulan**, tetapi unit lisensi adalah **per toko**, bukan per
device. Pemilik bebas menghubungkan perangkat sebanyak apa pun ke satu toko.

- `cloudStorageMb` diubah **2048 → 1024 MB** (`src/lib/brand.ts`, `seed-plans.ts`,
  `supabase/seed.sql`).
- `cloudMaxStores` tetap **1** (satu toko per langganan).
- Device hanyalah *client* dari store yang sama; **tidak ada batas jumlah device**
  di v1 sync (`docs/SYNC-DESIGN.md` §7).

**Implications:** UI kuota mengikuti `BRAND.cloudStorageMb` (1024). Plan `storage_limit_mb`
di Supabase perlu di-update (seed.sql / SQL Editor) agar entitlements existing konsisten.

---

## 2026-08-05 — Jenis Toko & kolom khusus produk

**Status:** Accepted (desain: `docs/PRODUCT-TYPES.md`)

Saat onboarding pertama, user memilih jenis toko → form produk menampilkan kolom
pelengkap yang relevan:

| Jenis | Kolom khusus |
|---|---|
| Toko Sepatu | size, insole, brand, kategori (Basket/Boots/Formal/Running/Sneakers/dll), made in, baru/bekas → kondisi (Seperti baru/Sangat baik/Baik/Cukup) |
| Toko Kosmetik | Nomor BPOM (wajib), Nomor Halal (wajib), tanggal kadaluarsa (wajib), dll |
| Jenis lain | Custom fields (kolom kustom user-defined) |
| Toko Umum | Tanpa kolom khusus |

**Teknis:** `storeSettings.storeType` + `Product.attributes` (JSON) + skema terpusat
`src/lib/product-fields.ts`. Kolom khusus ikut sync & backup.

---

## 2026-08-05 — Role Administrator & kustomisasi menu per role

**Status:** Accepted (desain: `docs/ROLES-PERMISSIONS.md`)

- Role **Administrator** (setara pemilik) dapat mengatur **menu on/off** untuk role
  **Admin**, **Sales**, dan role pegawai lain (termasuk **role kustom**).
- Dasar: `PermissionKey` yang sudah ada + pemetaan menu terpusat
  (`menu-permissions.ts`); role disimpan di tabel Dexie `roles`.
- Gate UI via `can()`/`hasPermission` (device-local, bukan security server-grade —
  konsisten dengan keputusan multi-user sebelumnya).

---

## 2026-08-05 — Roadmap fitur cloud (toko online → affiliate → SEO)

**Status:** Direction

Urutan fase cloud setelah sync lintas perangkat (Phase A):

1. **Sync lintas perangkat** (fondasi).
2. **Toko Online** (catalog publik + pesanan pelanggan) — `marketOrigin` & UI awal sudah ada.
3. **Affiliate** (link/QR affiliate + komisi/bagi hasil).
4. **Optimasi search: SEO & AI SEO** (judul/deskripsi otomatis, meta, sitemap).

**Implications:** Desain schema & sync harus siap mendukung data toko online
(produk publik, `stores`, atribut produk dari `docs/PRODUCT-TYPES.md`).

**Implications:** 
- User harus rutin backup (jangan andalkan backup lama > 30 hari)
- UI bisa tampilkan warning "Backup expired otomatis setelah 30 hari"
- Cost predictable: max 2 GB × user count × $0.015/GB = manageable

---

## 2026-08-05 — Fitur Tambah Toko (offline & online)

**Status:** Accepted (desain: `docs/MULTI-STORE.md`)

User bisa memiliki **lebih dari satu toko** dalam satu aplikasi:

- **Toko offline:** data lokal terpisah per toko (DB Dexie sendiri); POS, stok,
  laporan, multi-user berjalan penuh tanpa cloud.
- **Toko online:** terhubung cloud (backup + sync); **1 langganan `cloud_monthly`
  (Rp 25rb/bulan) per toko** — `cloudMaxStores` = 1 = jumlah toko per langganan;
  tidak ada batas jumlah toko total.
- **Isolasi total:** registry `kasirgratisan-stores` + `getDb(storeKey)` factory +
  store context. Toko pertama/default tetap di `kasirgratisan-db` (data existing
  aman, tidak diganti namanya).
- Produk/laporan/pegawai per toko tidak tercampur. `storeType` (PRODUCT-TYPES) &
  roles (ROLES-PERMISSIONS) bersifat per toko. Sync & backup cloud per `storeId`
  (API `/api/stores` + `uploadBackup(..., storeId)` sudah mendukung).

**Implications:** refactor `db.ts` instance tunggal → factory dilakukan bertahap
per halaman; v1 tidak menyediakan agregasi data antar toko.

---

## 2026-08-06 — Cloud Console: middleware + credit AI (Opsi C, MSC cost-only)

**Status:** Accepted (desain: `docs/CLOUD-CONSOLE.md`)

Membangun console cloud terpisah di repo baru (`profitku-cloud`) dengan model
ekonomi AI berbasis credit yang **terpisah** dari langganan cloud Rp 25rb/bulan.

**Decision:**

1. **Domain (final):**
   - `dashboard.profitku.my.id` = **Admin ops SPA (staff only)** — pindah ke repo
     middleware; halaman baru: kelola top-up/riwayat/refund credit merchant.
   - `ai.profitku.my.id` = generate foto/video AI untuk merchant (langganan cloud).
   - `report.profitku.my.id` = laporan merchant (berlangganan cloud) — sumber data
     `sync_records` (RPC agregasi + RLS merchant-scoped).
   - `sales.profitku.my.id` = aplikasi role sales (katalog share WA + sales order
     via Fonnte ke WA admin kantor — **WA-only dulu**, pending-order di POS = fase
     berikutnya).
   - `market.profitku.my.id` = fase berikut (katalog toko publik).
   - `profitku.my.id` (POS) + `api.profitku.my.id` (Worker POS) **tetap di repo
     kasirgratisan**.
2. **Rantai nilai AI — Opsi C (MSC di cost):**
   - MSC Studio = **mesin generate cost-only** (konfigurasi provider SnapGen, submit
     job, polling status, webhook ber-signature, refund on fail). **Tanpa margin,
     tanpa ledger merchant.**
   - **Semua margin di Profitku**: price book ×1.5 dihitung di **middleware
     Profitku**, bukan di MSC.
   - `merchant_charge_credits = roundUp(snapgen_cost × SNAPGEN_CREDIT_RP / 100 × 1.5)`
     (asumsi awal `SNAPGEN_CREDIT_RP = 100`; konfirmasi dari billing riil sebelum
     lock). Contoh `low/2K = 7` → `7 × 1.5 = 10.5 → 11 credit = Rp 1.100`.
   - Sumber harga: **matrix terukur MSC** (`docs/SNAPGEN_GPT_IMAGE_2_PRICING.md`),
     bukan docs SnapGen (docs tidak akurat: `medium+4K` diklaim 6, live 29).
3. **Unit & top-up:**
   - **1 credit = Rp 100** (satuan internal Profitku); tampilan merchant dalam **Rp**.
   - Top-up paket Rupiah: Rp 25.000 = 250 credit · Rp 50.000 = 500 (+10) ·
     Rp 100.000 = 1.000 (+50). Pembayaran via **Midtrans** (webhook idempotent).
4. **Ledger credit (Supabase, migrasi di repo middleware):**
   - `credit_accounts`, `credit_transactions` (topup|usage|refund|adjust),
     `credit_packages`, `ai_jobs`. Debit **hanya saat sukses**; refund saat gagal;
     saldo tidak negatif; audit trail.
5. **Arsitektur:** monorepo middleware (4 SPA + 1 Worker Hono) + **dua worker
   terpisah** (`api.profitku.my.id` POS vs worker middleware). Secret AI/Midtrans
   hanya di worker middleware. Satu Supabase project; migrasi middleware memakai
   namespace terpisah (jangan campur folder `supabase/migrations` repo ini).
6. **Integrasi AI:** lewat **Platform API MSC Studio** (cost-only) — JANGAN
   scaffold SnapGen di repo mana pun (AGENTS.md: out of scope repo ini).

**Implications:**
- MSC Studio: ubah pricing ke cost-only; hilangkan `MARGIN_CREDITS=5`/ledger user;
  ekspos `GET /api/v1/pricing` (cost saja). Tanpa user eksternal → aman diubah global.
- Copy UI POS yang mengklaim "pantau laporan di dashboard.profitku.my.id" **salah**
  (dashboard = admin ops) → dihapus sampai `report.profitku.my.id` live.
- Konflik domain selesai: `dashboard.*` = admin ops permanen; merchant web reports
  memakai `report.profitku.my.id`.

---

## 2026-08-06 — Penyesuaian: AI pending + sales WA manual

**Status:** Accepted

1. **AI Profitku → MSC Studio = PENDING** sampai **review Midtrans** selesai
   (top-up belum live → merchant belum bisa isi credit). Kode P2 tetap, dormant.
   Uji internal: top-up manual admin + sandbox Midtrans.
2. **Sales (P4) = share `wa.me` manual** (tanpa Fonnte — menunggu nomor WA
   Profitku). Katalog → teks wa.me; sales order → pesan terformat ke nomor WA
   admin kantor, dikirim manual. Abstraksi `buildOrderMessage` agar siap ganti
   ke API Fonnte nanti.

**Implications:** prioritas lanjutan = P4 sales (jalan), lalu menunggu review
Midtrans untuk "menyalakan" AI; Fonnte menunggu nomor Profitku.

---

## Template decision baru

```markdown
## YYYY-MM-DD — Judul singkat

**Status:** Proposed | Accepted | Superseded by …

Konteks dan opsi.

**Decision:** …

**Implications:** …
```

---

## 2026-08-08 — Langganan Cloud per TOKO (unlimited) + durasi diskon + storage per toko + auto-sync

**Status:** Accepted (menggantikan keputusan 2026-08-05 "cloudMaxStores = 1")

Monetisasi cloud multi-toko, unit lisensi **per toko**, bukan per akun.

**Decision:**

1. **Unlimited toko cloud; Rp 25.000/bulan PER TOKO.** User bebas membuat banyak
   toko; setiap toko cloud membutuhkan langganan sendiri (`subscriptions.store_id`).
   Toko tanpa langganan aktif = toko offline (lokal) — gratis.
2. **Durasi langganan per toko:** 1 bulan (Rp 25.000), **6 bulan = bayar 5 bulan
   (Rp 125.000, berlaku 6 bulan)**, **12 bulan = bayar 10 bulan (Rp 250.000,
   berlaku 12 bulan)**. Harga dihitung **server-side** di Worker; client tidak
   dipercaya untuk amount. Voucher tetap berlaku terhadap amount.
3. **Perpanjangan per toko:** user memilih toko yang diperpanjang; perpanjangan
   menambah periode dari `max(now, current_period_end)` (stack). Toko yang tidak
   diperpanjang → saat `current_period_end` lewat, toko **turun jadi offline**;
   **backup cloud terakhir diunduh ke perangkat user** (restore ke DB lokal).
4. **Kuota penyimpanan per toko:** kolom "Penyimpanan Cloud" menampilkan sisa
   kuota **masing-masing toko** (1024 MB per langganan toko; dihitung dari
   `backups.store_id`), bukan agregat akun.
5. **Sinkronisasi Antar-Perangkat otomatis:** tanpa tombol "Sync Sekarang" manual —
   sinkronisasi dipicu otomatis saat ada perubahan data & perangkat online
   (debounce), plus saat aplikasi dibuka/fokus & interval berkala.
6. **Komisi affiliate:** tetap dihitung dari nominal pembayaran (per toko);
   `affiliateCode` diteruskan di payment.raw.

**Implications:**
- Migrasi baru: `subscriptions.store_id`, `payments.store_id`, index; view
  `store_entitlements` (per toko); `create_store_with_limit` diubah → tanpa batas
  (null = unlimited) atau fungsi baru; `user_entitlements` disesuaikan.
- Worker: checkout menerima `storeId` + `durationMonths` (1|6|12) dengan kalkulasi
  harga & periode server-side; fulfillment membuat/memperpanjang sub per toko;
  `requireSyncStore` memvalidasi entitlement per toko; cron dunning per toko;
  endpoint storage usage per toko.
- Frontend: CloudHub & Kelola Toko menampilkan kartu per toko (status langganan,
  durasi 1/6/12, sisa storage), alur renew per toko, prompt "simpan backup terakhir
  ke perangkat" saat toko turun offline, dan auto-sync (hapus ketergantungan tombol
  manual).
- Backup retention 30 hari tetap berlaku.

---

## 2026-08-08 — Hapus Toko (permanen, lokal + cloud)

**Status:** Accepted

User boleh menghapus toko yang sudah tutup/tidak beroperasi dari daftar toko.

**Decision:**

1. **Hapus dari device (lokal):** entry registry `kasirgratisan-stores` + database
   IndexedDB toko (`kasirgratisan-db-<storeKey>`, atau `kasirgratisan-db` untuk
   toko default) dihapus permanen. Toko yang sedang dipakai (aktif) **tidak bisa**
   dihapus — user harus pindah ke toko lain dulu.
2. **Hapus dari cloud (jika toko online):** `DELETE /api/stores/:id` menghapus
   backup R2 + metadata, baris `stores` (cascade `sync_records`, `sync_devices`,
   `sync_pull_watermarks`, `subscriptions.store_id`). `payments.store_id` di-set
   `null` — riwayat keuangan & komisi affiliate TETAP tersimpan.
3. **Idempotent & aman:** endpoint mengembalikan `ok` bila toko sudah tidak ada.
   UI selalu minta konfirmasi eksplisit yang menyebutkan data dihapus permanen.

**Implications:**
- Worker: route baru `DELETE /api/stores/:id` (ownership check, hapus backup R2 +
  meta, hapus store).
- Frontend: tombol hapus di halaman Toko (`StoresManager`) + di Kelola Toko cloud
  (yang sudah ada, kini berfungsi); hapus cloud juga membersihkan toko lokal yang
  terhubung (`cloudStoreId`) + reload bila toko lokal aktif ikut terhapus.
- Data tidak bisa dipulihkan setelah penghapusan — konfirmasi harus jelas.

---

## 2026-08-10 — Jendela atribusi affiliate 3650 hari (10 tahun)

**Status:** Accepted

Jalur referral di perangkat (localStorage `profitku_affiliate_ref`) berlaku
**3650 hari** sejak klik link — praktis permanen. User yang berlangganan cloud
jauh setelah klik link (bulan/tahun kemudian, di perangkat yang sama) tetap
memberikan komisi ke affiliator pengundang.

**Decision:**

1. `platform_settings` key `affiliate` → `attribution_days: 3650` (migrasi
   `20260810120000_affiliate_attribution_3650.sql`; dibaca Worker per-request,
   aktif tanpa redeploy).
2. Default/fallback disamakan: Worker `DEFAULT_AFFILIATE_SETTINGS`, admin UI
   (default form, fallback simpan, placeholder), konstanta info client.
3. Admin tetap bisa mengubah 1–3650 via Profitku Admin (input sudah `max=3650`).
4. Link share affiliator → `https://profitku.my.id/join?ref=CODE` (halaman aktivasi
   akun gratis `/join`; `?ref` tetap ditangkap `captureAffiliateRef` di semua route).

**Implications:**
- Atribusi tetap terikat perangkat (localStorage); ganti device / clear browser
  → jalur hilang. Binding server-side lintas device (claim) belum dibangun —
  bisa ditambahkan belakangan tanpa konflik (prioritas: kode eksplisit dulu).
- `capturedAt` lama (klik > 90 hari lalu) kembali valid selama < 10 tahun.

---

## 2026-08-10 — Affiliate invite-only: registrasi manual ditutup

**Status:** Accepted

User TIDAK bisa mendaftar sebagai affiliator secara mandiri. Satu-satunya jalur
user menjadi affiliator adalah membuka link undangan `join?ref=KODE` dari
affiliator terdaftar lalu login Google.

**Decision:**
1. `POST /api/affiliate/register` dihapus (404). `registerAffiliate()` server
   kini mewajibkan `refCode`; parent harus valid + aktif; self-referral ditolak.
2. `POST /api/affiliate/claim` = satu-satunya entry point user (invite-only,
   idempotent, first valid referral wins).
3. `/join` tanpa `?ref` valid menampilkan kartu "akun affiliate hanya lewat
   undangan" (tanpa CTA login/daftar affiliate); kode tidak valid → pesan
   khusus.
4. `affiliate.profitku.my.id` = landing program saja; `affiliate.profitku.my.id/
   dashboard` = beranda affiliator (tanpa form daftar; user belum diundang
   melihat status kartu).
5. Admin/root tetap bisa membuat affiliator via Profitku Admin (jalur
   operasional, bukan endpoint user).

**Implications:** Tidak ada migrasi DB. Struktur `referred_by` + unique index
`affiliates_user_uidx` sudah sesuai. `captureAffiliateRef` di POS tetap
menyimpan kode format-valid saat offline (claim tetap divalidasi server).

---

## 2026-08-10 — Dashboard affiliate canonical di affiliate.profitku.my.id/dashboard

**Status:** Accepted

Dashboard affiliator pindah penuh ke portal subdomain `affiliate.profitku.my.id`
(repo `profitku-cloud`, project Pages `profitku-affiliate`), bukan route embedded
di PWA POS.

**Decision:**
1. `affiliate.profitku.my.id/` = landing program (SEO, publik).
2. `affiliate.profitku.my.id/dashboard` = area pribadi affiliator (login Google,
   REF, link, QR, komisi, downline, payout) — `noindex`.
3. `profitku.my.id/affiliate` (POS) = **redirect legacy** ke
   `https://affiliate.profitku.my.id/dashboard` — halaman kosong lama tidak lagi
   dipakai; komponen `AffiliateDashboard` embedded dihapus dari bundle PWA.
4. Tombol "Buka dashboard affiliate" di `/join` dan kartu Affiliate di Settings
   menuju URL canonical tersebut (tab yang sama).
5. `BRAND.affiliateOrigin` sebagai satu sumber URL portal.

**Implications:** Login Google di subdomain terpisah dari sesi POS (origin
berbeda, localStorage per-origin) — user menekan login sekali lagi; Google
mengenali akun sehingga prosesnya singkat. CORS Worker sudah mengizinkan origin
ini (`AFFILIATE_ORIGIN`).

---

## 2026-08-10 — OAuth dari link referral: auto-register affiliator + kunci parent permanen

**Status:** Accepted

User baru yang membuka link referral lalu login Google otomatis didaftarkan
sebagai affiliator (kode REF sendiri) dan dikunci ke affiliator pengundang.
First valid referral wins — parent tidak bisa diganti.

**Decision:**

1. Link share: `https://profitku.my.id/join?ref=KODE` — halaman aktivasi akun
   gratis (`/join`, tanpa layout kasir/Cloud) terpisah dari Cloud Hub; fokus akun
   + kode referral pribadi, tanpa sinyal paywall sebelum OAuth.
2. `POST /api/affiliate/claim` (auth, idempotent): validasi kode, auto-register
   via `registerAffiliate` (kode REF otomatis + `referred_by`); user yang sudah
   punya affiliate row tidak diganti parent-nya (race double-claim aman via
   unique index `affiliates_user_uidx`).
3. Client: `claimAffiliateRef()` dipanggil best-effort setelah OAuth sukses di
   `use-cloud-auth.login()`; gagal claim tidak menggagalkan login.
4. Checkout: kunci server-side (`affiliates.referred_by`) diutamakan atas
   `affiliateCode` dari client; `capturedAt: null` → tanpa jendela kedaluwarsa.
   Client code hanya fallback untuk akun yang belum pernah claim.
5. Tanpa migrasi DB baru — kolom `referred_by` + unique index sudah ada.

**Implications:**
- Atribusi permanen lintas perangkat: ganti HP / clear browser tidak menghapus
  penguncian (berbeda dari jalur localStorage 3650 hari).
- Dashboard affiliate user baru langsung aktif (kode REF sendiri); form manual
  hanya untuk akun lama tanpa referral. Bank/payout tetap opsional.
- Self-referral ditutup di engine komisi: pembayar yang memakai kode REF-nya
  sendiri tidak mendapat komisi (rantai dimulai dari parent-nya).

---

## 2026-08-12 — Auto-backup cloud cadence tetap 12 jam (setting jadwal dihapus)

**Status:** Accepted

Pengaturan "Jadwal Sinkronisasi Otomatis" dihapus dari UI — user awam tidak
perlu mengatur apa pun. Backup cloud berjalan otomatis dengan interval tetap
12 jam.

**Decision:**

1. Halaman `/settings/cloud/auto` (`CloudAutoBackupSettings`) + MenuCard di
   CloudHub + route dihapus; redirect legacy `/settings/cloud-backup/auto`
   diarahkan ke hub.
2. Hook auto-backup memakai konstanta `AUTO_BACKUP_INTERVAL_MS = 12 jam`:
   saat app dibuka, jika sudah ≥ 12 jam sejak `lastCloudBackupAt`, snapshot
   diunggah. Backup pertama toko baru tetap dijalankan.
3. Field Dexie `cloudAutoBackupInterval` / `cloudAutoBackupHours` dibiarkan
   (data user lama tidak diganggu; tidak lagi dibaca).
4. Sinkronisasi antar perangkat tidak berubah (realtime debounce 4 s + pull
   60 s + saat app dibuka) — keputusan 2026-08-08 poin 5 tetap berlaku.

**Implications:**
- Retensi 30 hari + kuota 1024 MB/toko tetap; 12 jam → maks ±60 file,
  ±6% kuota (@1 MB), aman di list limit 50 (25 hari terlihat).
- Perilaku user lama yang pernah set "Nonaktif" berubah menjadi backup
  otomatis 12 jam — aman, dicatat sebagai perubahan perilaku.
