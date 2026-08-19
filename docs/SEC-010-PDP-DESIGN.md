# SEC-010 — Desain Export & Delete Data User (UU PDP)

Status: **DRAFT untuk review** (2026-08-19). Belum ada implementasi.

## Tujuan

Memenuhi hak data pribadi (UU PDP): user dapat **mengekspor** datanya dan **menghapus/meminta hapus** akun + data pribadinya. Semua operasi di Worker (service-role), terautentikasi, teraudit.

## Opsi yang perlu diputuskan

| # | Keputusan | Opsi A (disarankan v1) | Opsi B |
|---|---|---|---|
| D1 | Model penghapusan | **Hard delete** data pribadi + **anonymize** PII pada catatan finansial yang wajib disimpan (payments/subscriptions: email/nama → null) | Soft-delete semua (flag deleted_at) + purge cron |
| D2 | Catatan finansial (payments, subscriptions, affiliate_commissions) | **Retensi dengan PII di-null** (kepatuhan pajak/audit; tanpa identitas personal) | Ikut dihapus total |
| D3 | Backup R2 | Hapus semua object prefix `{userId}/` + meta backup | Arsip 30 hari lalu hapus |
| D4 | Auth & konfirmasi | Hanya pemilik (JWT) + input konfirmasi teks `HAPUS`; admin override via RBAC + audit | Pemilik + support admin saja |
| D5 | Cara hapus | Sinkron (satu request, dalam batas waktu Worker) — untuk data user tipikal | Async job + notifikasi email |
| D6 | platform_events / notification_log / admin_audit_log | **Retensi** (identitas di-null pada event lama) — log audit tidak dihapus | Ikut dihapus |

## Endpoint yang diusulkan (v1)

```
POST /api/account/export          → JSON envelope: profile, stores, subscriptions,
                                    payments, team member rows, sync_records summary,
                                    backups list, affiliate status
                                    (streaming/zlib untuk payload besar)
POST /api/account/delete          → body { confirm: "HAPUS" }
                                    - hapus data user (cascade FK existing)
                                    - hapus object R2 prefix {userId}/
                                    - anonymize PII retained rows
                                    - revoke sesi + unauth
                                    - writeAudit + writeEvent + email konfirmasi (opsional)
```

## Implementasi (est.)

| Bagian | Est. |
|---|---|
| Export endpoint + serialisasi | S |
| Delete endpoint (cascade + R2 + anonymize) | M |
| Migrasi pendukung (indeks, cleanup anon) | S |
| Tests (auth, ownership, idempotent, R2 cleanup mock) | M |
| Docs (retensi, kebijakan) | S |

## Risiko & catatan

- Hapus `auth.users` → cascade ke profiles/stores/subscriptions/payments (cek FK real saat implementasi; sebagian sudah `on delete cascade`).
- Sync_records menyimpan **seluruh toko** (produk, transaksi) — hapus per store via cascade.
- Anonymize: kolom `email/name/phone/picture` dan `payments.raw` yang berisi affiliateCode/paymentId? (paymentId provider bukan PII; simpan).
- Komisi affiliate: bila affiliate user dihapus, komisi historis tetap (billing), referensi affiliate di-null.
- Uji dengan akun fixture `profitkutest` sebelum rilis.
- **Tidak ada input pengguna**: desain menunggu keputusan D1–D6 sebelum implementasi.

## Keputusan yang dibutuhkan

Silakan tandai D1–D6 (default: A/A/A/A/A/A). Implementasi dilakukan setelahnya + approval produksi (endpoint destruktif).