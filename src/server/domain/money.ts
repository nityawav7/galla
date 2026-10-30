/**
 * Money is always integer paise held in a `bigint` (SPEC §4.4). This module is the
 * only place that rounds; everything else calls `divRoundHalfUp`.
 */

import { ValidationError } from "@/lib/errors";

import { parseScaled, splitScaled } from "./decimal";

export const PAISE_PER_RUPEE = 100n;

/**
 * Integer division rounded half up, i.e. half away from zero for negative values
 * (2.5 → 3, -2.5 → -3).
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive");
  const quotient = numerator / denominator; // truncates towards zero
  const remainder = numerator % denominator; // has the sign of the numerator
  const doubled = 2n * (remainder < 0n ? -remainder : remainder);
  if (doubled < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/** Parses a rupee amount typed by a user ("1,234.50") into paise. */
export function parseRupees(input: string): bigint {
  const paise = parseScaled(input, 2);
  if (paise === null) {
    throw new ValidationError("Enter an amount like 120 or 120.50", [
      { path: "amount", message: "Invalid amount" },
    ]);
  }
  return paise;
}

/** Plain decimal rupees ("1234.50"), for inputs and exports. */
export function formatRupees(paise: bigint): string {
  const { negative, whole, fraction } = splitScaled(paise, 2);
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Indian digit grouping: the last three digits, then groups of two (12,34,56,789). */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${tail}`;
}

/** Display format, same as `Intl.NumberFormat("en-IN", { currency: "INR" })`: ₹1,23,456.50 */
export function formatINR(paise: bigint): string {
  const { negative, whole, fraction } = splitScaled(paise, 2);
  return `${negative ? "-" : ""}₹${groupIndian(whole.toString())}.${fraction}`;
}

/** Nearest whole rupee, 50 paise rounding up. */
export function roundToRupee(paise: bigint): bigint {
  return divRoundHalfUp(paise, PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
}

export function sumPaise(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}
