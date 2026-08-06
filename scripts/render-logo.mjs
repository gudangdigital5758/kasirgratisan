/**
 * Render logo Profitku — satu sumber untuk semua aset.
 *
 * Varian 1 (mark / app icon): SVG bersih — lingkaran biru + terminal POS + grafik naik,
 *   TANPA teks, safe-zone maskable 80%. Dipakai di favicon, PWA, Android launcher.
 *
 * Varian 2 (lockup): PNG asli user (`Profitku Logo.png`) — background hitam di luar
 *   lingkaran di-flood-fill jadi transparan (teks di dalam lingkaran dipertahankan).
 *   Dipakai di header-icon (Onboarding), OG image, header dashboard/market.
 *
 * Warna brand: biru #0060E0 (dari logo).
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('d:/GitHub/kasirgratisan');
const SRC = path.join(ROOT, 'Profitku Logo.png');
const PUB = path.join(ROOT, 'public');
const RES = path.join(ROOT, 'resources');
const TMP = path.join(ROOT, 'scripts', '.logo-tmp');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

const BRAND = '#0060E0'; // biru utama dari logo
const BRAND_DARK = '#004FC8';

fs.mkdirSync(TMP, { recursive: true });

// ─────────────────────────────────────────────────────────────
// Varian 1 — SVG mark (512 viewBox, safe-zone 80%)
// ─────────────────────────────────────────────────────────────
const SVG_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1E7CF0"/>
      <stop offset="1" stop-color="${BRAND_DARK}"/>
    </linearGradient>
  </defs>
  <!-- background rounded-square -->
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <!-- receipt sticking out top -->
  <rect x="252" y="118" width="76" height="110" rx="10" fill="#FFFFFF"/>
  <rect x="266" y="136" width="48" height="8" rx="4" fill="#9CC3F5"/>
  <rect x="266" y="154" width="40" height="8" rx="4" fill="#9CC3F5"/>
  <rect x="266" y="172" width="48" height="8" rx="4" fill="#9CC3F5"/>
  <rect x="266" y="190" width="30" height="8" rx="4" fill="#9CC3F5"/>
  <!-- terminal body -->
  <rect x="132" y="176" width="248" height="196" rx="20" fill="#FFFFFF"/>
  <!-- screen -->
  <rect x="152" y="196" width="208" height="140" rx="12" fill="#EAF2FF"/>
  <rect x="168" y="212" width="60" height="10" rx="5" fill="#9CC3F5"/>
  <rect x="168" y="240" width="176" height="10" rx="5" fill="#C7DCFC"/>
  <rect x="168" y="266" width="150" height="10" rx="5" fill="#C7DCFC"/>
  <rect x="168" y="292" width="164" height="10" rx="5" fill="#C7DCFC"/>
  <!-- total bar -->
  <rect x="168" y="318" width="176" height="10" rx="5" fill="${BRAND}"/>
  <!-- trend badge overlapping left of terminal -->
  <circle cx="168" cy="172" r="62" fill="#FFFFFF"/>
  <path d="M140 188 L166 160 L186 180 L212 148" stroke="${BRAND}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="212" cy="148" r="7" fill="${BRAND}"/>
</svg>`;

// Varian 1 foreground (untuk adaptive icon Android) — mark putih tanpa bg,
// posisi center, skala ~70%.
const SVG_FOREGROUND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(0.62) translate(-256 -256)">
    <rect x="252" y="118" width="76" height="110" rx="10" fill="#FFFFFF"/>
    <rect x="266" y="136" width="48" height="8" rx="4" fill="#BFD6FF"/>
    <rect x="266" y="154" width="40" height="8" rx="4" fill="#BFD6FF"/>
    <rect x="266" y="172" width="48" height="8" rx="4" fill="#BFD6FF"/>
    <rect x="266" y="190" width="30" height="8" rx="4" fill="#BFD6FF"/>
    <rect x="132" y="176" width="248" height="196" rx="20" fill="#FFFFFF"/>
    <rect x="152" y="196" width="208" height="140" rx="12" fill="#4A90E8"/>
    <rect x="168" y="212" width="60" height="10" rx="5" fill="#BFD6FF"/>
    <rect x="168" y="240" width="176" height="10" rx="5" fill="#BFD6FF"/>
    <rect x="168" y="266" width="150" height="10" rx="5" fill="#BFD6FF"/>
    <rect x="168" y="292" width="164" height="10" rx="5" fill="#BFD6FF"/>
    <rect x="168" y="318" width="176" height="10" rx="5" fill="#FFFFFF"/>
    <circle cx="168" cy="172" r="62" fill="#FFFFFF"/>
    <path d="M140 188 L166 160 L186 180 L212 148" stroke="#4A90E8" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="212" cy="148" r="7" fill="#4A90E8"/>
  </g>
</svg>`;

// ─────────────────────────────────────────────────────────────
// Flood fill: hapus background hitam di luar lingkaran (transparan)
// ─────────────────────────────────────────────────────────────
async function floodFillTransparent(srcPath, outPath, threshold = 60) {
  // ensureAlpha → selalu RGBA (4 channel) supaya indeks alpha aman
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const buf = Buffer.from(data);
  const at = (x, y) => (y * width + x) * channels;
  const isDark = (i) => buf[i] < threshold && buf[i + 1] < threshold && buf[i + 2] < threshold && buf[i + 3] > 0;
  const visited = new Uint8Array(width * height);
  const stack = [];

  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    if (isDark(at(x, y))) {
      visited[idx] = 1;
      stack.push([x, y]);
    }
  };
  // seed dari semua tepi
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }

  while (stack.length) {
    const [x, y] = stack.pop();
    const i = at(x, y);
    buf[i + 3] = 0; // transparan
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      if (isDark(at(nx, ny))) {
        visited[nIdx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  await sharp(buf, { raw: { width, height, channels } }).png().toFile(outPath);
}

// ─────────────────────────────────────────────────────────────
// ICO writer (PNG-compressed, didukung browser modern)
// ─────────────────────────────────────────────────────────────
function writeIco(entries, outPath) {
  // entries: [{png: Buffer, size: number}]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type icon
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dirs = [];
  const datas = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, 0);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    dir.writeUInt8(0, 2); // palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(e.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(dir);
    datas.push(e.png);
  }
  fs.writeFileSync(outPath, Buffer.concat([header, ...dirs, ...datas]));
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  // 1. render mark SVG ke 1024 (master)
  const masterPath = path.join(TMP, 'mark-1024.png');
  await sharp(Buffer.from(SVG_MARK)).resize(1024, 1024).png().toFile(masterPath);

  // 2. flood fill lockup asli → transparan
  const lockupPath = path.join(TMP, 'lockup-transparent.png');
  await floodFillTransparent(SRC, lockupPath);
  const lockup = sharp(lockupPath);

  // ── PWA / web assets (dari mark) ──
  const sizes = [
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['android-chrome-192x192.png', 192],
    ['android-chrome-512x512.png', 512],
    ['kasirgratisan-icon.png', 512],
  ];
  for (const [name, size] of sizes) {
    await sharp(masterPath).resize(size, size).png().toFile(path.join(PUB, name));
  }

  // favicon.ico (16 + 32)
  const png16 = await sharp(masterPath).resize(16, 16).png().toBuffer();
  const png32 = await sharp(masterPath).resize(32, 32).png().toBuffer();
  writeIco([{ png: png16, size: 16 }, { png: png32, size: 32 }], path.join(PUB, 'favicon.ico'));

  // ── Lockup: header-icon (Onboarding) ──
  await lockup.clone().resize(256, 256).png().toFile(path.join(PUB, 'header-icon.png'));

  // ── Lockup: OG image 1200x630 ──
  const ogSvg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#EAF2FF"/><stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient></defs>
    <rect width="1200" height="630" fill="url(#og)"/>
    <text x="600" y="584" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${BRAND}" text-anchor="middle">profitku.my.id — Kasir POS Gratis untuk UMKM</text>
  </svg>`;
  const lockupBuf = await lockup.clone().resize(420, 420).png().toBuffer();
  await sharp(Buffer.from(ogSvg))
    .composite([{ input: lockupBuf, left: Math.round((1200 - 420) / 2), top: 70 }])
    .png().toFile(path.join(PUB, 'og-image.png'));

  // ── Lockup transparan untuk cloud apps (dashboard/market header) ──
  await lockup.clone().resize(256, 256).png().toFile(path.join(TMP, 'profitku-lockup-256.png'));

  // ── Android: legacy icon + round (mark) ──
  const dens = [
    ['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192],
  ];
  for (const [d, size] of dens) {
    const dir = path.join(ANDROID_RES, `mipmap-${d}`);
    await sharp(masterPath).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(masterPath).resize(size, size).png().toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  // ── Android: adaptive foreground (mark putih) + background (biru) ──
  const fgDens = [
    ['ldpi', 81], ['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432],
  ];
  const fgMaster = await sharp(Buffer.from(SVG_FOREGROUND)).resize(432, 432).png().toBuffer();
  for (const [d, size] of fgDens) {
    const dir = path.join(ANDROID_RES, `mipmap-${d}`);
    await sharp(fgMaster).resize(size, size).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    // background: solid biru
    await sharp({ create: { width: size, height: size, channels: 3, background: BRAND } })
      .png().toFile(path.join(dir, 'ic_launcher_background.png'));
  }

  // ── resources/icon.png (sumber capacitor) ──
  await sharp(masterPath).resize(1024, 1024).png().toFile(path.join(RES, 'icon.png'));

  console.log('DONE: semua aset logo dirender.');
}

main().catch((e) => { console.error(e); process.exit(1); });
