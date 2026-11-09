/**
 * Tax by GST rate, as the 80 mm slip and the A4 footer print it. Every figure is a sum of the
 * stored line values (SPEC §4.5: totals are sums of lines), never recomputed from a rate.
 */

export interface TaxedLine {
  rateBp: number;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
}

export interface RateSummary {
  rateBp: number;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
}

/** One row per rate that appears on the document, lowest rate first. */
export function taxSummaryByRate(lines: readonly TaxedLine[]): RateSummary[] {
  const byRate = new Map<number, RateSummary>();
  for (const line of lines) {
    const row = byRate.get(line.rateBp) ?? {
      rateBp: line.rateBp,
      taxablePaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      utgstPaise: 0n,
      igstPaise: 0n,
    };
    row.taxablePaise += line.taxablePaise;
    row.cgstPaise += line.cgstPaise;
    row.sgstPaise += line.sgstPaise;
    row.utgstPaise += line.utgstPaise;
    row.igstPaise += line.igstPaise;
    byRate.set(line.rateBp, row);
  }
  return [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp);
}
