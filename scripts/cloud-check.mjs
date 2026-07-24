/**
 * Cek kesiapan cloud lokal: .env app + GET /health API.
 * Usage: node scripts/cloud-check.mjs
 *        node scripts/cloud-check.mjs --url https://api.profitku.my.id
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function flag(ok, label, detail = '') {
  const mark = ok ? 'OK ' : 'MISS';
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

const args = process.argv.slice(2);
const urlFlag = args.find((a) => a.startsWith('--url='));
const urlIdx = args.indexOf('--url');
const explicitUrl =
  urlFlag?.slice('--url='.length) ||
  (urlIdx >= 0 ? args[urlIdx + 1] : null);

const env = {
  ...parseEnvFile(resolve(root, '.env')),
  ...process.env,
};

console.log('Profitku cloud check\n');

console.log('App .env (client-safe vars):');
const hasApi = flag(
  Boolean(env.VITE_AUTH_API_URL),
  'VITE_AUTH_API_URL',
  env.VITE_AUTH_API_URL || 'set ke http://127.0.0.1:8787 atau https://api.profitku.my.id',
);
const hasSbUrl = flag(
  Boolean(env.VITE_SUPABASE_URL) && !String(env.VITE_SUPABASE_URL).includes('YOUR_PROJECT'),
  'VITE_SUPABASE_URL',
);
const hasSbAnon = flag(Boolean(env.VITE_SUPABASE_ANON_KEY), 'VITE_SUPABASE_ANON_KEY');
const hasGoogle = flag(Boolean(env.VITE_GOOGLE_CLIENT_ID), 'VITE_GOOGLE_CLIENT_ID');
const hasOneSignalClient = flag(
  Boolean(env.VITE_ONESIGNAL_APP_ID),
  'VITE_ONESIGNAL_APP_ID (opsional — push client)',
  env.VITE_ONESIGNAL_APP_ID ? 'set' : 'kosong = push dimatikan di browser',
);

const devVarsPath = resolve(root, 'workers/api/.dev.vars');
console.log('\nWorker local .dev.vars:');
if (existsSync(devVarsPath)) {
  const dv = parseEnvFile(devVarsPath);
  flag(Boolean(dv.SUPABASE_URL), 'SUPABASE_URL');
  flag(Boolean(dv.SUPABASE_ANON_KEY), 'SUPABASE_ANON_KEY');
  flag(Boolean(dv.SUPABASE_SERVICE_ROLE_KEY), 'SUPABASE_SERVICE_ROLE_KEY');
  flag(Boolean(dv.RESEND_API_KEY), 'RESEND_API_KEY (opsional)');
  flag(Boolean(dv.FONNTE_TOKEN), 'FONNTE_TOKEN (opsional)');
  flag(Boolean(dv.ONESIGNAL_APP_ID && dv.ONESIGNAL_REST_API_KEY), 'ONESIGNAL_* (opsional push server)');
  flag(Boolean(dv.ADMIN_EMAILS), 'ADMIN_EMAILS (opsional admin)');
} else {
  console.log('  [MISS] workers/api/.dev.vars — copy dari .dev.vars.example untuk dev lokal');
}

const apiBase = (
  explicitUrl ||
  env.VITE_AUTH_API_URL ||
  'http://127.0.0.1:8787'
).replace(/\/$/, '');

console.log(`\nAPI health: GET ${apiBase}/health`);
let healthOk = false;
try {
  const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`  [FAIL] HTTP ${res.status}`);
  } else {
    healthOk = true;
    console.log('  [OK ] reachable');
    console.log(
      `       service=${body.service ?? '?'} supabase=${body.supabase} r2=${body.r2} resend=${body.resend} fonnte=${body.fonnte} onesignal=${body.onesignal}`,
    );
    if (body.supabase !== true) console.log('       → set Worker secrets SUPABASE_*');
    if (body.r2 !== true) console.log('       → enable R2 binding BACKUP_BUCKET + deploy');
    if (body.resend !== true) console.log('       → optional: RESEND_API_KEY');
    if (body.fonnte !== true) console.log('       → optional: FONNTE_TOKEN');
    if (body.onesignal !== true) console.log('       → optional: ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY');
  }
} catch (err) {
  console.log(`  [FAIL] ${err instanceof Error ? err.message : err}`);
  console.log('       → jalankan: npm run api:dev   atau deploy Worker dulu');
}

console.log('\nFiles / migrations:');
flag(existsSync(resolve(root, 'supabase/migrations/20260723000000_init_profitku.sql')), 'migration init');
flag(existsSync(resolve(root, 'supabase/migrations/20260724000000_admin_ops.sql')), 'migration admin_ops');
flag(
  existsSync(resolve(root, 'supabase/migrations/20260724120000_notification_push_channel.sql')),
  'migration push channel',
);
flag(existsSync(resolve(root, 'supabase/seed.sql')), 'seed.sql');
flag(existsSync(resolve(root, 'workers/api/wrangler.toml')), 'wrangler.toml');
flag(existsSync(resolve(root, 'admin/package.json')), 'admin SPA package');

const readyClient = hasApi && hasSbUrl && hasSbAnon && hasGoogle;
const readyApi = healthOk;

console.log('\n---');
if (readyClient && readyApi) {
  console.log('Status: client env + API reachable.');
  console.log('Lanjut: docs/PRODUCTION-STABILIZE.md (smoke browser + migrasi SQL jika belum).');
  process.exit(0);
}
console.log('Status: belum lengkap. Ikuti docs/DEPLOY-CLOUD.md + docs/PRODUCTION-STABILIZE.md');
process.exit(1);
