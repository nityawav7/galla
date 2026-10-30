/**
 * GSTIN validation (SPEC §4.1): 2-digit state code + PAN + entity number + "Z" +
 * a mod-36 check character. v1 accepts only the regular taxpayer format.
 */

import { ValidationError } from "@/lib/errors";

import { isActiveStateCode } from "./states";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const BODY_PATTERN = /^[0-9A-Z]{14}$/;

export type GstinInvalidReason = "FORMAT" | "STATE" | "CHECKSUM";

export type GstinValidation =
  | { ok: true; gstin: string; stateCode: string; pan: string }
  | { ok: false; reason: GstinInvalidReason };

const MESSAGES: Record<GstinInvalidReason, string> = {
  FORMAT: "GSTIN must be 15 characters in the format 22AAAAA0000A1Z5",
  STATE: "GSTIN starts with an unknown state code",
  CHECKSUM: "GSTIN check digit does not match. Check for typos",
};

export function normalizeGstin(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Check character for the first 14 characters: alternate weights 1 and 2, add the
 * base-36 digits of each product, and take the complement mod 36.
 */
export function gstinCheckCharacter(body: string): string {
  if (!BODY_PATTERN.test(body)) throw new RangeError("Expected 14 GSTIN characters");
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const product = CHARSET.indexOf(body.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET.charAt((36 - (sum % 36)) % 36);
}

export function validateGstin(input: string): GstinValidation {
  const gstin = normalizeGstin(input);
  if (!GSTIN_PATTERN.test(gstin)) return { ok: false, reason: "FORMAT" };
  const stateCode = gstin.slice(0, 2);
  if (!isActiveStateCode(stateCode)) return { ok: false, reason: "STATE" };
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin.charAt(14)) {
    return { ok: false, reason: "CHECKSUM" };
  }
  return { ok: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}

export function isValidGstin(input: string): boolean {
  return validateGstin(input).ok;
}

function requireValid(input: string): Extract<GstinValidation, { ok: true }> {
  const result = validateGstin(input);
  if (!result.ok) {
    throw new ValidationError(MESSAGES[result.reason], [
      { path: "gstin", message: MESSAGES[result.reason] },
    ]);
  }
  return result;
}

/** Returns the normalised GSTIN or throws a ValidationError explaining what is wrong. */
export function parseGstin(input: string): string {
  return requireValid(input).gstin;
}

export function stateFromGstin(gstin: string): string {
  return requireValid(gstin).stateCode;
}

export function panFromGstin(gstin: string): string {
  return requireValid(gstin).pan;
}

/** SPEC §4.1: a customer's chosen state should match their GSTIN (override with a warning). */
export function gstinMatchesState(gstin: string, stateCode: string): boolean {
  return stateFromGstin(gstin) === stateCode;
}
