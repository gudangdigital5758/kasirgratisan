const ACTION_BUTTONS = ['whatsNew', 'requestFeature', 'donate', 'telegram'] as const;
const LINK_BUTTONS = new Set(['requestFeature', 'donate', 'telegram']);
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const PLATFORM_SETTINGS = ['maintenance_mode', 'dunning_enabled', 'mock_payment_note'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateActionButtons(value: unknown): string | null {
  if (!isRecord(value)) return 'value harus berupa object';

  for (const name of ACTION_BUTTONS) {
    const button = value[name];
    if (!isRecord(button)) return `Button '${name}' tidak valid`;
    if (typeof button.enabled !== 'boolean') {
      return `Button '${name}' field enabled harus boolean`;
    }
    if (!LINK_BUTTONS.has(name)) continue;
    if (typeof button.url !== 'string') return `Button '${name}' field url harus string`;
    if (!button.url.trim()) return `Button '${name}' field url wajib diisi`;
    try {
      if (!ALLOWED_URL_PROTOCOLS.has(new URL(button.url).protocol)) {
        return `Button '${name}' memakai protokol URL yang tidak diizinkan`;
      }
    } catch {
      return `Button '${name}' field url tidak valid`;
    }
  }

  return null;
}

export function validatePlatformSettings(value: unknown): string | null {
  if (!isRecord(value)) return 'Body harus berupa object';
  const keys = Object.keys(value);
  if (keys.length === 0) return 'Minimal satu setting wajib dikirim';
  const unknownKey = keys.find(
    (key) => !PLATFORM_SETTINGS.includes(key as (typeof PLATFORM_SETTINGS)[number]),
  );
  if (unknownKey) return `Field '${unknownKey}' tidak diizinkan`;

  for (const key of ['maintenance_mode', 'dunning_enabled'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      return `Field '${key}' harus boolean`;
    }
  }
  if (value.mock_payment_note !== undefined && typeof value.mock_payment_note !== 'string') {
    return "Field 'mock_payment_note' harus string";
  }
  return null;
}