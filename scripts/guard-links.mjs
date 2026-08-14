/**
 * Guard anti-drift: blokir format link referral root (/?ref=) yang sudah
 * usang. Kanonik = /join?ref= (DECISIONS 2026-08-10, platform_settings['links']).
 * Dipanggil dari `npm run lint` — CI merah bila ada pelanggaran.
 * Catatan: pola regex sengaja di-escape agar tidak mendeteksi dirinya sendiri.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
// Scan hanya kode user-facing (docs/scripts bebas menyebut pola untuk dokumentasi/regex).
const DIRS = ['src', 'admin/src', 'workers/api/src', 'public'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.html', '.sql', '.md']);
const BAD = /profitku\.my\.id\/\?ref=/;

let bad = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
    } else if (EXTS.has(extname(p))) {
      const content = readFileSync(p, 'utf8');
      if (BAD.test(content)) {
        console.error(`[guard-links] DRIFT: ${p.replace(ROOT + '\\', '').replace(ROOT + '/', '')} mengandung profitku.my.id/?ref= — gunakan /join?ref= kanonik`);
        bad += 1;
      }
    }
  }
};

for (const d of DIRS) walk(join(ROOT, d));
if (bad > 0) {
  console.error(`[guard-links] ${bad} pelanggaran ditemukan — perbaiki sebelum commit.`);
  process.exit(1);
}
console.log('[guard-links] OK — tidak ada link referral root form.');
