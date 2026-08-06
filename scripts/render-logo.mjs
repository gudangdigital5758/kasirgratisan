/**
 * Render logo Profitku — satu sumber untuk semua aset.
 *
 * Sumber: `Profitku Logo.png` (PNG asli user) — scanner/printer biru flat + kertas
 * di lingkaran putih + badge centang. Background hitam di luar lingkaran
 * di-flood-fill jadi transparan.
 *
 * Logo ini SATU-SATUNYA identitas (sederhana, tanpa wordmark):
 * - App icon (favicon/PWA/Android legacy): mark komposit di atas background
 *   biru rounded-square #0067FD (full-bleed, safe-zone maskable).
 * - header-icon / OG / cloud lockup: mark transparan (lingkaran putih).
 *
 * Warna brand: biru #0067FD (dari logo).
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

const BRAND = '#0067FD'; // biru utama dari logo
const BRAND_DARK = '#0052C9';

fs.mkdirSync(TMP, { recursive: true });

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
  // 1. flood fill sumber → mark transparan (lingkaran putih + printer + badge)
  const markPath = path.join(TMP, 'mark-transparent.png');
  await floodFillTransparent(SRC, markPath);
  const mark = sharp(markPath);

  // 2. app icon master: mark (lingkaran putih) langsung isi canvas — TANPA bg biru,
  //    logo terlihat lebih besar, tidak ada ring biru di sekeliling.
  const appMasterPath = path.join(TMP, 'appicon-512.png');
  await mark.clone().resize(512, 512).png().toFile(appMasterPath);

  // ── PWA / web assets (dari app icon) ──
  const sizes = [
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['android-chrome-192x192.png', 192],
    ['android-chrome-512x512.png', 512],
    ['kasirgratisan-icon.png', 512],
  ];
  for (const [name, size] of sizes) {
    await sharp(appMasterPath).resize(size, size).png().toFile(path.join(PUB, name));
  }

  // favicon.ico (16 + 32)
  const png16 = await sharp(appMasterPath).resize(16, 16).png().toBuffer();
  const png32 = await sharp(appMasterPath).resize(32, 32).png().toBuffer();
  writeIco([{ png: png16, size: 16 }, { png: png32, size: 32 }], path.join(PUB, 'favicon.ico'));

  // ── header-icon (Onboarding): mark transparan ──
  await mark.clone().resize(256, 256).png().toFile(path.join(PUB, 'header-icon.png'));

  // ── OG image 1200x630 ──
  const ogSvg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#EAF2FF"/><stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient></defs>
    <rect width="1200" height="630" fill="url(#og)"/>
    <text x="600" y="584" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${BRAND}" text-anchor="middle">profitku.my.id — Kasir POS Gratis untuk UMKM</text>
  </svg>`;
  const markOg = await mark.clone().resize(420, 420).png().toBuffer();
  await sharp(Buffer.from(ogSvg))
    .composite([{ input: markOg, left: Math.round((1200 - 420) / 2), top: 70 }])
    .png().toFile(path.join(PUB, 'og-image.png'));

  // ── lockup transparan untuk cloud apps ──
  await mark.clone().resize(256, 256).png().toFile(path.join(TMP, 'profitku-lockup-256.png'));

  // ── Android: legacy icon + round (app icon biru) ──
  const dens = [
    ['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192],
  ];
  for (const [d, size] of dens) {
    const dir = path.join(ANDROID_RES, `mipmap-${d}`);
    await sharp(appMasterPath).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(appMasterPath).resize(size, size).png().toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  // ── Android: adaptive foreground (mark transparan, besar) + background putih ──
  const fgDens = [
    ['ldpi', 81], ['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432],
  ];
  const fgMaster = await mark.clone().resize(300, 300).png().toBuffer(); // ~69% dari 432 (safe zone)
  for (const [d, size] of fgDens) {
    const dir = path.join(ANDROID_RES, `mipmap-${d}`);
    const scale = size / 432;
    const fgSize = Math.round(300 * scale);
    const fg = await sharp(fgMaster).resize(fgSize, fgSize).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fg, left: Math.round((size - fgSize) / 2), top: Math.round((size - fgSize) / 2) }])
      .png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    // background putih supaya tidak ada ring biru (lingkaran logo menyatu)
    await sharp({ create: { width: size, height: size, channels: 3, background: '#FFFFFF' } })
      .png().toFile(path.join(dir, 'ic_launcher_background.png'));
  }

  // ── resources/icon.png (sumber capacitor) ──
  await sharp(appMasterPath).resize(1024, 1024).png().toFile(path.join(RES, 'icon.png'));

  console.log('DONE: semua aset logo dirender.');
}

main().catch((e) => { console.error(e); process.exit(1); });
