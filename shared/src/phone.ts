// Phone helpers for country-code + national-number fields.
// Stored shape is always "{code} {nationalDigits}", e.g. "+91 8301930122".

/** Calling codes used across Hub forms — longest-first match for splitting. */
export const KNOWN_CALLING_CODES = [
  '+971',
  '+966',
  '+974',
  '+234',
  '+254',
  '+91',
  '+44',
  '+65',
  '+61',
  '+49',
  '+33',
  '+81',
  '+86',
  '+55',
  '+27',
  '+62',
  '+60',
  '+1',
] as const;

/** Strict national length when we enforce it (India mobile). */
const NATIONAL_EXACT_DIGITS: Record<string, number> = {
  '+91': 10,
};

const NATIONAL_MAX_DIGITS: Record<string, number> = {
  '+91': 10,
  '+1': 10,
};

/**
 * Digits-only national number: strip trunk leading 0s (domestic prefix) and
 * cap to the country max when known.
 */
export function normalizeNationalNumber(raw: string, countryCode: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  while (digits.startsWith('0')) digits = digits.slice(1);
  const max = NATIONAL_MAX_DIGITS[countryCode] ?? 15;
  if (digits.length > max) digits = digits.slice(0, max);
  return digits;
}

/** Build the canonical stored phone: "+91 8301930122". */
export function formatStoredPhone(countryCode: string, nationalRaw: string): string {
  const code = (countryCode || '').trim() || '+91';
  const national = normalizeNationalNumber(nationalRaw, code);
  if (!national) return code;
  return `${code} ${national}`;
}

/** Split "+91 08301930122" → { code: '+91', number: '08301930122' }. */
export function splitStoredPhone(
  stored: string | null | undefined,
  fallbackCode = '+91',
): { code: string; number: string } {
  if (!stored) return { code: fallbackCode, number: '' };
  const trimmed = stored.trim();
  const sorted = [...KNOWN_CALLING_CODES].sort((a, b) => b.length - a.length);
  for (const code of sorted) {
    if (trimmed.startsWith(code)) {
      return { code, number: trimmed.slice(code.length).trim() };
    }
  }
  return { code: fallbackCode, number: trimmed };
}

/** Normalize a full stored (or pasted) phone string. */
export function normalizeStoredPhone(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) return '';
  const { code, number } = splitStoredPhone(trimmed);
  // If the raw string had no recognizable code, split falls back to +91 —
  // only trust that when the input actually started with '+'.
  if (!trimmed.startsWith('+')) {
    return normalizeNationalNumber(trimmed, '+91');
  }
  return formatStoredPhone(code, number);
}

export function isValidNationalNumber(nationalDigits: string, countryCode: string): boolean {
  const digits = normalizeNationalNumber(nationalDigits, countryCode);
  const exact = NATIONAL_EXACT_DIGITS[countryCode];
  if (exact != null) return digits.length === exact;
  return digits.length >= 4 && digits.length <= 15;
}

/** Validate after normalizeStoredPhone / formatStoredPhone. */
export function isValidStoredPhone(stored: string): boolean {
  const trimmed = stored.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('+')) {
    const { code, number } = splitStoredPhone(trimmed);
    return isValidNationalNumber(number, code);
  }
  // Bare national digits (legacy onboard path) — treat as India.
  return isValidNationalNumber(trimmed, '+91');
}
