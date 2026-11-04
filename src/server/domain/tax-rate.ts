/**
 * GST rates as people write them ("18", "18%", "0.25") and as stored (basis points, SPEC
 * §4.3). This only converts: which rates exist and are active is data in `tax_rates`.
 */

import { parseScaled, splitScaled } from "./decimal";

const MAX_RATE_BP = 10_000;

/** "18%" → 1800, or null if it is not a percentage with at most 2 decimals, up to 100. */
export function parseRatePercent(input: string): number | null {
  const text = input.trim().replace(/\s*%$/, "");
  if (text.includes(",")) return null;
  const rateBp = parseScaled(text, 2);
  if (rateBp === null || rateBp > BigInt(MAX_RATE_BP)) return null;
  return Number(rateBp);
}

/** 1800 → "18%", 25 → "0.25%". */
export function formatRatePercent(rateBp: number): string {
  const { whole, fraction } = splitScaled(BigInt(rateBp), 2);
  const decimals = fraction.replace(/0+$/, "");
  return `${whole.toString()}${decimals ? `.${decimals}` : ""}%`;
}
