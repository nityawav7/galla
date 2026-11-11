/*
 * HSN-wise summary of outward supplies (SPEC F8, GSTR-1 table 12): quantity, taxable value and tax
 * per HSN/SAC, unit (UQC) and rate. Credit-note lines take away. Lines without an HSN are grouped
 * together (null) and sort last, so the shop can see what to fix.
 */

export interface HsnLine {
  hsn: string | null;
  uqc: string;
  rateBp: number;
  qtyMilli: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  /** A credit-note line: subtracted. */
  credit: boolean;
}

export interface HsnRow {
  hsn: string | null;
  uqc: string;
  rateBp: number;
  qtyMilli: bigint;
  taxablePaise: bigint;
  igstPaise: bigint;
  cgstPaise: bigint;
  /** State or UT tax (SGST + UTGST). */
  sgstPaise: bigint;
  totalPaise: bigint;
}

export type HsnTotals = Pick<
  HsnRow,
  "taxablePaise" | "igstPaise" | "cgstPaise" | "sgstPaise" | "totalPaise"
>;

export function hsnSummary(lines: readonly HsnLine[]): { rows: HsnRow[]; totals: HsnTotals } {
  const groups = new Map<string, HsnRow>();
  for (const line of lines) {
    const sign = line.credit ? -1n : 1n;
    const key = `${line.hsn ?? ""}|${line.uqc}|${String(line.rateBp)}`;
    const row = groups.get(key) ?? {
      hsn: line.hsn,
      uqc: line.uqc,
      rateBp: line.rateBp,
      qtyMilli: 0n,
      taxablePaise: 0n,
      igstPaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      totalPaise: 0n,
    };
    const tax = line.igstPaise + line.cgstPaise + line.sgstPaise + line.utgstPaise;
    row.qtyMilli += sign * line.qtyMilli;
    row.taxablePaise += sign * line.taxablePaise;
    row.igstPaise += sign * line.igstPaise;
    row.cgstPaise += sign * line.cgstPaise;
    row.sgstPaise += sign * (line.sgstPaise + line.utgstPaise);
    row.totalPaise += sign * (line.taxablePaise + tax);
    groups.set(key, row);
  }
  const rows = [...groups.values()].sort(
    (a, b) =>
      Number(a.hsn === null) - Number(b.hsn === null) ||
      (a.hsn ?? "").localeCompare(b.hsn ?? "") ||
      a.uqc.localeCompare(b.uqc) ||
      a.rateBp - b.rateBp,
  );
  const totals: HsnTotals = {
    taxablePaise: 0n,
    igstPaise: 0n,
    cgstPaise: 0n,
    sgstPaise: 0n,
    totalPaise: 0n,
  };
  for (const row of rows) {
    totals.taxablePaise += row.taxablePaise;
    totals.igstPaise += row.igstPaise;
    totals.cgstPaise += row.cgstPaise;
    totals.sgstPaise += row.sgstPaise;
    totals.totalPaise += row.totalPaise;
  }
  return { rows, totals };
}
