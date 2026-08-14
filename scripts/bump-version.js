import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(__dirname, '..', 'version.json');

function getTodayTag() {
  // Selalu Asia/Jakarta (WIB) agar tanggal konsisten di lokal & CI runner (UTC).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
}

function bumpVersion() {
  const todayTag = getTodayTag();
  let buildNumber = 1;
  let versionCode = 1;

  try {
    const raw = readFileSync(VERSION_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const parts = String(data.appVersion).split('.');
    const currentTag = `${parts[0]}.${parts[1]}.${parts[2]}`;

    if (currentTag === todayTag) {
      buildNumber = (parseInt(parts[3], 10) || 0) + 1;
    }
    versionCode = (parseInt(data.versionCode, 10) || 0) + 1;
  } catch {
    buildNumber = 1;
    versionCode = 1;
  }

  const appVersion = `${todayTag}.${buildNumber}`;
  const newContent = JSON.stringify({ appVersion, versionCode }, null, 2) + '\n';

  writeFileSync(VERSION_FILE, newContent, 'utf-8');

  console.log(`[bump-version] App version bumped to: ${appVersion}, versionCode: ${versionCode}`);
}

bumpVersion();
