// One-off verification: FUL-001/FUL-007 fix = pure variable rename (behavior-identical).
// Method: strip comments, then reverse-rename the FIXED body (raw_json -> raw, unqualified
// variable only) and require exact equality with the ORIGINAL body. The reverse direction is
// unambiguous: `pay.raw` (qualified column) never matches; `raw = raw_json` in SET becomes
// `raw = raw` matching the original buggy statement verbatim.
import { readFileSync } from 'node:fs';

function plpgsqlBody(sql) {
  const m = sql.match(/\$\$([\s\S]*?)\$\$/);
  return m ? m[1] : '';
}

function stripComments(body) {
  return body
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

function reverseRename(fixed) {
  // unqualified `raw_json` -> `raw` ; `pay.raw_json`/`xxxraw_json` untouched
  return fixed.replace(/(^|[^\w.])(raw_json)\b/g, '$1raw');
}

function check(origFile, fixedFile, label) {
  const orig = stripComments(plpgsqlBody(readFileSync(origFile, 'utf8')));
  const fixed = stripComments(plpgsqlBody(readFileSync(fixedFile, 'utf8')));
  const reverted = reverseRename(fixed);
  const same = reverted === orig;
  console.log(`${label}: ${same ? 'FIX = PURE RENAME (behavior-identical)' : 'DIFFERS'}`);
  if (!same) {
    let i = 0;
    while (i < reverted.length && reverted[i] === orig[i]) i++;
    console.log(`  first diff at ${i}`);
    console.log(`  reversed-fix: ${JSON.stringify(reverted.slice(i, i + 100))}`);
    console.log(`  original:     ${JSON.stringify(orig.slice(i, i + 100))}`);
  }
  return same;
}

const checks = [
  ['supabase/migrations/20260811110000_cloud_billing_atomic.sql',
   'supabase/migrations/20260817020000_fix_fulfill_cloud_payment_raw.sql',
   'FUL-001 fulfill_cloud_payment'],
  ['supabase/migrations/20260812150000_batch_checkout.sql',
   'supabase/migrations/20260817030000_fix_batch_fulfillment_raw.sql',
   'FUL-007 fulfill_cloud_payment_batch'],
];

const ok = checks.every(([a, b, l]) => check(a, b, l));
console.log(ok ? 'ALL FIXES PURE RENAME' : 'SOME FIX CHANGES BEHAVIOR');
process.exit(ok ? 0 : 1);