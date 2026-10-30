/**
 * Exact conversion between decimal strings and scaled integers (paise, milli-units).
 * Never goes through floating point.
 */

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a non-negative decimal like "1,23,456.5" into an integer scaled by 10^scale.
 * Grouping commas are ignored. Returns null for anything else, including more
 * fractional digits than `scale` (user input is never silently rounded).
 */
export function parseScaled(input: string, scale: number): bigint | null {
  const match = DECIMAL.exec(input.trim().replaceAll(",", ""));
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > scale) return null;
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

export interface ScaledParts {
  negative: boolean;
  whole: bigint;
  /** Fractional digits, zero-padded to `scale`. */
  fraction: string;
}

export function splitScaled(value: bigint, scale: number): ScaledParts {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  return {
    negative,
    whole: magnitude / factor,
    fraction: (magnitude % factor).toString().padStart(scale, "0"),
  };
}
