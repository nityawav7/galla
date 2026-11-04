/**
 * UPI IDs (virtual payment addresses), printed on invoices and encoded in the payment QR
 * (Phase 7). Format: a 2–256 character name of letters, digits, dot, hyphen or underscore,
 * then "@" and the payment app's handle (oksbi, ybl, paytm …). Case does not matter.
 */

const VPA_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/;

export function normalizeUpiVpa(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUpiVpa(input: string): boolean {
  return VPA_PATTERN.test(normalizeUpiVpa(input));
}
