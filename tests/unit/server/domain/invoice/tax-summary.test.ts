import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { taxSummaryByRate, type TaxedLine } from "@/server/domain/invoice/tax-summary";

const line = (rateBp: number, taxable: bigint, igst = 0n, cgst = 0n): TaxedLine => ({
  rateBp,
  taxablePaise: taxable,
  cgstPaise: cgst,
  sgstPaise: cgst,
  utgstPaise: 0n,
  igstPaise: igst,
});

describe("taxSummaryByRate", () => {
  it("groups lines by rate, lowest rate first", () => {
    expect(
      taxSummaryByRate([line(1800, 10000n, 1800n), line(500, 2000n, 100n), line(1800, 500n, 90n)]),
    ).toEqual([
      {
        rateBp: 500,
        taxablePaise: 2000n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        utgstPaise: 0n,
        igstPaise: 100n,
      },
      {
        rateBp: 1800,
        taxablePaise: 10500n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        utgstPaise: 0n,
        igstPaise: 1890n,
      },
    ]);
  });

  it("returns nothing for no lines", () => {
    expect(taxSummaryByRate([])).toEqual([]);
  });

  it("adds up to the document totals for any lines (sums, never recomputed)", () => {
    const arbitraryLine = fc.record({
      rateBp: fc.constantFrom(0, 25, 300, 500, 1800, 4000),
      taxablePaise: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      cgstPaise: fc.bigInt({ min: 0n, max: 10n ** 8n }),
      sgstPaise: fc.bigInt({ min: 0n, max: 10n ** 8n }),
      utgstPaise: fc.bigInt({ min: 0n, max: 10n ** 8n }),
      igstPaise: fc.bigInt({ min: 0n, max: 10n ** 8n }),
    });
    fc.assert(
      fc.property(fc.array(arbitraryLine, { maxLength: 30 }), (lines) => {
        const rows = taxSummaryByRate(lines);
        const total = (pick: (value: TaxedLine) => bigint, values: readonly TaxedLine[]) =>
          values.reduce((sum, value) => sum + pick(value), 0n);
        for (const pick of [
          (value: TaxedLine) => value.taxablePaise,
          (value: TaxedLine) => value.cgstPaise,
          (value: TaxedLine) => value.sgstPaise,
          (value: TaxedLine) => value.utgstPaise,
          (value: TaxedLine) => value.igstPaise,
        ]) {
          expect(total(pick, rows)).toBe(total(pick, lines));
        }
        expect(new Set(rows.map((row) => row.rateBp)).size).toBe(rows.length);
      }),
    );
  });
});
