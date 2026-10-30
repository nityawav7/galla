/**
 * Invoice and credit note numbers (SPEC §4.6): `{prefix}/{FY}/{seq}`, at most 16
 * characters from A–Z a–z 0–9 - / (Rule 46). Sequences are assigned by the
 * invoice service inside the issuing transaction; this module only formats.
 */

import { ValidationError } from "@/lib/errors";

import { parseFy } from "./fy";

export type NumberSeries = "INV" | "CN";

export const MAX_DOCUMENT_NUMBER_LENGTH = 16;
const SEQUENCE_DIGITS = 4;
// "/26-27/" plus four sequence digits leaves room for a 5-character prefix.
export const MAX_PREFIX_LENGTH = MAX_DOCUMENT_NUMBER_LENGTH - "/00-00/".length - SEQUENCE_DIGITS;

export const DEFAULT_PREFIXES: Record<NumberSeries, string> = { INV: "INV", CN: "CN" };

const PREFIX_PATTERN = /^[A-Za-z0-9-]+$/;

/** Returns the trimmed prefix, or throws if it would not fit Rule 46. */
export function validatePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed.length > MAX_PREFIX_LENGTH || !PREFIX_PATTERN.test(trimmed)) {
    const message = `Prefix must be 1–${String(MAX_PREFIX_LENGTH)} letters, digits or hyphens`;
    throw new ValidationError(message, [{ path: "prefix", message }]);
  }
  return trimmed;
}

/** Invoices and credit notes must be told apart by their numbers. */
export function validateSeriesPrefixes(invoicePrefix: string, creditNotePrefix: string): void {
  const invoice = validatePrefix(invoicePrefix);
  const creditNote = validatePrefix(creditNotePrefix);
  if (invoice.toUpperCase() === creditNote.toUpperCase()) {
    const message = "Credit note prefix must be different from the invoice prefix";
    throw new ValidationError(message, [{ path: "creditNotePrefix", message }]);
  }
}

export function formatDocumentNumber(prefix: string, fy: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1)
    throw new RangeError("Sequence must be a positive integer");
  const number = `${validatePrefix(prefix)}/${parseFy(fy)}/${String(seq).padStart(SEQUENCE_DIGITS, "0")}`;
  if (number.length > MAX_DOCUMENT_NUMBER_LENGTH) {
    const message = `Invoice number ${number} is longer than ${String(MAX_DOCUMENT_NUMBER_LENGTH)} characters. Use a shorter prefix`;
    throw new ValidationError(message, [{ path: "prefix", message }]);
  }
  return number;
}
