/**
 * Normalisasi input rupiah pada trust boundary API (audit HPP desimal 2026-08-22).
 *
 * Menerima number ATAU string format Indonesia ("10.333,567": titik = ribuan,
 * koma = desimal), menolak non-numerik/null/negatif, lalu membulatkan half-up
 * ke integer rupiah. Return null berarti INVALID — caller wajib 400.
 *
 * Aturan string:
 *  - ada koma              -> semua titik dibuang, koma pertama jadi desimal ("10.333,5" -> 10333.5)
 *  - grup ribuan 3-3       -> semua titik dibuang ("10.333.567" -> 10333567)
 *  - satu titik tanpa koma -> desimal gaya internasional ("10.5" -> 10.5)
 */
// Math.round sudah half-up, tapi noise float seperti 2.6749999999999998 bisa
// membuat nilai tepat .5 turun; epsilon menjaga pembulatan half-up.
const EPSILON = 1e-9;

export function toRupiah(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (s.includes(',')) {
      const t = s.replace(/\./g, '');
      if (!/^\d+(,\d+)?$/.test(t)) return null;
      n = Number(t.replace(',', '.'));
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      n = Number(s.replace(/\./g, '')); // titik = pemisah ribuan (grup harus 3 digit)
    } else {
      n = Number(s);
    }
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n + EPSILON);
}

// ponytail: hanya format ID/internasional tanpa simbol mata uang; tambah parser lain saat ada input nyata yang butuh.
