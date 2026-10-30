/** Quantities are integer milli-units (1.5 kg = 1500n) so fractional amounts stay exact. */

import { ValidationError } from "@/lib/errors";

import { parseScaled, splitScaled } from "./decimal";

export const MILLI_PER_UNIT = 1000n;

export function parseQuantity(input: string): bigint {
  const milli = parseScaled(input, 3);
  if (milli === null) {
    throw new ValidationError("Enter a quantity with up to 3 decimals, like 2 or 1.5", [
      { path: "quantity", message: "Invalid quantity" },
    ]);
  }
  return milli;
}

/** Shortest decimal form: 1500n → "1.5", 2000n → "2". */
export function formatQuantity(milli: bigint): string {
  const { negative, whole, fraction } = splitScaled(milli, 3);
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}
