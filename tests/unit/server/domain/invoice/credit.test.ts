import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { computeLine } from "@/server/domain/gst/calc";
import { type TaxMode } from "@/server/domain/gst/place-of-supply";
import {
  type CreditableLine,
  creditForReturn,
  creditNoteTotals,
} from "@/server/domain/invoice/credit";

/** An issued line as stored: its amounts come from the real engine. */
function issuedLine(
  qtyMilli: bigint,
  unitPricePaise: bigint,
  rateBp: number,
  discountPaise: bigint,
  taxMode: TaxMode,
): CreditableLine {
  const amounts = computeLine(
    { qtyMilli, unitPricePaise, rateBp, priceIncludesTax: false, discountPaise },
    taxMode,
  );
  return {
    qtyMilli,
    discountPaise: amounts.discountPaise,
    taxablePaise: amounts.taxablePaise,
    cgstPaise: amounts.cgstPaise,
    sgstPaise: amounts.sgstPaise,
    utgstPaise: amounts.utgstPaise,
    igstPaise: amounts.igstPaise,
    lineTotalPaise: amounts.totalPaise,
  };
}

// 3 units of ₹99.99 at 18% intra-state with ₹10 off: taxable 289.97, halves 26.10 each.
const line = issuedLine(3000n, 9999n, 1800, 1000n, "INTRA_SGST");

describe("creditForReturn", () => {
  it("credits a whole line exactly", () => {
    expect(creditForReturn(line, 0n, 3000n)).toEqual({
      discountPaise: 1000n,
      taxablePaise: 28997n,
      cgstPaise: 2610n,
      sgstPaise: 2610n,
      utgstPaise: 0n,
      igstPaise: 0n,
      totalPaise: 34217n,
    });
  });

  it("credits one unit as the difference of what was returned before and after", () => {
    const first = creditForReturn(line, 0n, 1000n);
    expect(first).toEqual({
      discountPaise: 333n,
      taxablePaise: 9666n,
      cgstPaise: 870n,
      sgstPaise: 870n,
      utgstPaise: 0n,
      igstPaise: 0n,
      totalPaise: 11406n,
    });
    const rest = creditForReturn(line, 1000n, 2000n);
    expect(first.totalPaise + rest.totalPaise).toBe(line.lineTotalPaise);
  });

  it.each([
    [0n, 0n, "qtyPositive"],
    [0n, -1n, "qtyPositive"],
    [2500n, 600n, "returnTooMany"],
    [-1n, 100n, "returnTooMany"],
  ])("refuses returning %s + %s milli-units of 3", (before, qty, message) => {
    expect(() => creditForReturn(line, before, qty)).toThrow(ValidationError);
    try {
      creditForReturn(line, before, qty);
    } catch (error) {
      expect((error as ValidationError).issues).toEqual([{ path: "qty", message }]);
    }
  });

  const taxModes = fc.constantFrom<TaxMode>("INTRA_SGST", "INTRA_UTGST", "INTER", "NONE");
  const lines = fc
    .record({
      qty: fc.bigInt({ min: 1n, max: 50_000n }),
      price: fc.bigInt({ min: 0n, max: 10_000_000n }),
      rate: fc.constantFrom(0, 25, 300, 500, 1800, 4000),
      taxMode: taxModes,
      discountShare: fc.integer({ min: 0, max: 100 }),
    })
    .map(({ qty, price, rate, taxMode, discountShare }) => {
      const gross = (qty * price + 500n) / 1000n;
      const discount = (gross * BigInt(discountShare)) / 100n;
      return issuedLine(qty, price, rate, discount, taxMode);
    });

  /** Splits the line's quantity into 1–6 positive parts. */
  const splits = lines.chain((issued) =>
    fc
      .array(fc.bigInt({ min: 1n, max: issued.qtyMilli }), { minLength: 0, maxLength: 5 })
      .map((cuts) => {
        const points = [...new Set(cuts.filter((cut) => cut < issued.qtyMilli))].sort((a, b) =>
          a < b ? -1 : 1,
        );
        const bounds = [0n, ...points, issued.qtyMilli];
        return { issued, parts: bounds.slice(1).map((end, index) => end - (bounds[index] ?? 0n)) };
      }),
  );

  it("any split of the returns adds up exactly to the line (property)", () => {
    fc.assert(
      fc.property(splits, ({ issued, parts }) => {
        let returned = 0n;
        const sum = { taxable: 0n, cgst: 0n, sgst: 0n, utgst: 0n, igst: 0n, total: 0n, disc: 0n };
        for (const part of parts) {
          const credit = creditForReturn(issued, returned, part);
          returned += part;
          sum.taxable += credit.taxablePaise;
          sum.cgst += credit.cgstPaise;
          sum.sgst += credit.sgstPaise;
          sum.utgst += credit.utgstPaise;
          sum.igst += credit.igstPaise;
          sum.total += credit.totalPaise;
          sum.disc += credit.discountPaise;
        }
        expect(sum).toEqual({
          taxable: issued.taxablePaise,
          cgst: issued.cgstPaise,
          sgst: issued.sgstPaise,
          utgst: issued.utgstPaise,
          igst: issued.igstPaise,
          total: issued.lineTotalPaise,
          disc: issued.discountPaise,
        });
      }),
    );
  });

  it("every credit line has equal halves, no negatives, and adds up (property)", () => {
    fc.assert(
      fc.property(splits, ({ issued, parts }) => {
        let returned = 0n;
        for (const part of parts) {
          const credit = creditForReturn(issued, returned, part);
          returned += part;
          for (const value of Object.values(credit)) expect(value).toBeGreaterThanOrEqual(0n);
          if (issued.sgstPaise > 0n) expect(credit.cgstPaise).toBe(credit.sgstPaise);
          if (issued.utgstPaise > 0n) expect(credit.cgstPaise).toBe(credit.utgstPaise);
          expect(credit.totalPaise).toBe(
            credit.taxablePaise +
              credit.cgstPaise +
              credit.sgstPaise +
              credit.utgstPaise +
              credit.igstPaise,
          );
        }
      }),
    );
  });
});

describe("creditNoteTotals", () => {
  const credits = [creditForReturn(line, 0n, 1000n), creditForReturn(line, 1000n, 2000n)];

  it("sums the lines and adds no round-off to a partial credit note", () => {
    expect(creditNoteTotals([credits[0] ?? creditForReturn(line, 0n, 1n)], null)).toEqual({
      discountPaise: 333n,
      taxablePaise: 9666n,
      cgstPaise: 870n,
      sgstPaise: 870n,
      utgstPaise: 0n,
      igstPaise: 0n,
      roundOffPaise: 0n,
      grandTotalPaise: 11406n,
    });
  });

  it("carries the invoice's round-off on the note that completes the invoice", () => {
    expect(creditNoteTotals(credits, -17n)).toMatchObject({
      roundOffPaise: -17n,
      grandTotalPaise: 34200n,
    });
  });
});
