/**
 * Indian phone numbers, stored in E.164 (`+91` and 10 digits) as the schema requires.
 * Accepts what people type: spaces, hyphens, brackets, a leading 0 (trunk prefix) or 91/+91.
 * Mobile numbers start with 6–9; landlines with their STD code start with 2–5.
 */

const ALLOWED = /^[+]?[0-9\s()-]+$/;
const NATIONAL = /^[2-9][0-9]{9}$/;

function nationalNumber(digits: string, hadPlus: boolean): string | null {
  if (hadPlus) return digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : null;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/** "+919876543210", or null if this is not a valid Indian number. */
export function normalizeIndianPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!ALLOWED.test(trimmed)) return null;
  const national = nationalNumber(trimmed.replace(/\D/g, ""), trimmed.startsWith("+"));
  return national && NATIONAL.test(national) ? `+91${national}` : null;
}

/** "+919876543210" → "+91 98765 43210". Other numbers are shown as stored. */
export function formatIndianPhone(e164: string): string {
  return e164.replace(/^\+91([0-9]{5})([0-9]{5})$/, "+91 $1 $2");
}
