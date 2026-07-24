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

## Template decision baru

```markdown
## YYYY-MM-DD — Judul singkat

**Status:** Proposed | Accepted | Superseded by …

Konteks dan opsi.

**Decision:** …

**Implications:** …
```
