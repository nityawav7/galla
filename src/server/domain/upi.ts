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

/** "Pay via UPI" amounts in rupees with two decimals ("802.00"), from paise without floats. */
export function upiAmount(paise: bigint): string {
  if (paise <= 0n) throw new RangeError("A UPI amount must be positive");
  const whole = paise / 100n;
  const fraction = (paise % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}`;
}

/** UPI apps show at most about 50 characters of the payee name and note. */
const MAX_TEXT = 50;
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Whitespace collapsed, cut at 50 whole characters (a Hindi letter keeps its vowel sign). */
function shortText(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return Array.from(GRAPHEMES.segment(clean), (part) => part.segment)
    .slice(0, MAX_TEXT)
    .join("")
    .trimEnd();
}

export interface UpiPayment {
  vpa: string;
  /** The shop's name as the payer's app shows it. */
  payeeName: string;
  amountPaise: bigint;
  /** The invoice number, shown as the payment note. */
  note: string;
}

/**
 * The UPI deep link of SPEC F5: `upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn={invoiceNo}`.
 * The same text goes into the QR code. `pa` is a validated VPA ([a-z0-9._-] and "@") and stays
 * literal, because some apps reject "%40"; the name and note are percent-encoded.
 */
export function buildUpiPayLink(payment: UpiPayment): string {
  if (!isValidUpiVpa(payment.vpa)) throw new RangeError("Invalid UPI ID");
  const params = [
    `pa=${normalizeUpiVpa(payment.vpa)}`,
    `pn=${encodeURIComponent(shortText(payment.payeeName))}`,
    `am=${upiAmount(payment.amountPaise)}`,
    "cu=INR",
    `tn=${encodeURIComponent(shortText(payment.note))}`,
  ];
  return `upi://pay?${params.join("&")}`;
}
