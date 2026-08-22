import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';

const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

interface NumberInputProps {
  /** Raw numeric value as string. Integer mode: "10000". Decimal mode: dot-decimal "1.5". */
  value: string;
  /** Called with the raw numeric string (integer "10000" atau dot-decimal "1.5"). */
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Izinkan input desimal (koma). Nilai tetap dikirim sebagai dot-decimal. */
  decimal?: boolean;
}

const formatInt = (raw: string, locale: string) => {
  if (!raw) return '';
  return Number(raw).toLocaleString(locale);
};

/**
 * Format raw dot-decimal ("1234.5") untuk tampilan id-ID ("1.234,5").
 * Bagian desimal dibawa apa adanya (string) agar trailing koma/nol tidak hilang
 * saat user sedang mengetik (mis. "12," atau "12,50").
 */
const formatDecimal = (raw: string, locale: string) => {
  if (!raw) return '';
  const [intPart, decPart = ''] = raw.split('.');
  const intFmt = intPart === '' ? '0' : Number(intPart).toLocaleString(locale);
  return raw.includes('.') ? `${intFmt},${decPart}` : intFmt;
};

/**
 * Ubah teks yang diketik user (koma = desimal, titik = pemisah ribuan) menjadi
 * raw dot-decimal. Mengembalikan '' bila tidak ada digit sama sekali.
 */
const parseDecimal = (input: string): string => {
  // Format ID: titik = ribuan (dibuang), koma = desimal (hanya yang pertama).
  const cleaned = input.replace(/[^\d,]/g, '');
  if (!/\d/.test(cleaned)) return ''; // string kosong / tanpa digit sama sekali
  const firstComma = cleaned.indexOf(',');
  if (firstComma < 0) return cleaned;
  const intPart = cleaned.slice(0, firstComma);
  const decPart = cleaned.slice(firstComma + 1).replace(/,/g, ''); // koma ganda diabaikan
  return `${intPart || '0'}.${decPart}`; // ",5" -> "0.5"; "12," -> "12."; "12,3,4" -> "12.34"
};

/**
 * Text input yang menampilkan angka berformat ribuan (id-ID: 10.000) sambil
 * mengekspos raw numeric string lewat onChange. Set `decimal` untuk mengizinkan
 * input pecahan (mis. 1,5 kg).
 */
export default function NumberInput({ value, onChange, placeholder, className, decimal }: NumberInputProps) {
  const { i18n } = useTranslation();
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';

  return (
    <Input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={decimal ? formatDecimal(value, numberLocale) : formatInt(value, numberLocale)}
      onChange={e => {
        if (decimal) {
          onChange(parseDecimal(e.target.value));
        } else {
          onChange(e.target.value.replace(/\D/g, ''));
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}
