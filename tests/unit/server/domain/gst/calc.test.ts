import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { computeInvoice, computeLine, type LineInput } from "@/server/domain/gst/calc";
import type { TaxMode } from "@/server/domain/gst/place-of-supply";

function line(overrides: Partial<LineInput> = {}): LineInput {
  return {
    qtyMilli: 1000n,
    unitPricePaise: 10000n,
    rateBp: 1800,
    priceIncludesTax: false,
    discountPaise: 0n,
    ...overrides,
  };
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

describe("computeLine", () => {
  it("tax-exclusive, intra-state 18%", () => {
    expect(computeLine(line({ qtyMilli: 2000n }), "INTRA_SGST")).toEqual({
      grossPaise: 20000n,
      taxableBeforeDiscountPaise: 20000n,
      discountPaise: 0n,
      taxablePaise: 20000n,
      cgstPaise: 1800n,
      sgstPaise: 1800n,
      utgstPaise: 0n,
      igstPaise: 0n,
      totalPaise: 23600n,
    });
  });

  it("tax-exclusive, inter-state 18%", () => {
    expect(computeLine(line({ qtyMilli: 2000n }), "INTER")).toMatchObject({
      taxablePaise: 20000n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      utgstPaise: 0n,
      igstPaise: 3600n,
      totalPaise: 23600n,
    });
  });

  it("intra-state in a UT without legislature puts the second half in UTGST", () => {
    expect(computeLine(line(), "INTRA_UTGST")).toMatchObject({
      cgstPaise: 900n,
      sgstPaise: 0n,
      utgstPaise: 900n,
      igstPaise: 0n,
      totalPaise: 11800n,
    });
  });

  it("tax-inclusive ₹118 at 18% backs out to ₹100 + ₹18", () => {
    expect(
      computeLine(line({ unitPricePaise: 11800n, priceIncludesTax: true }), "INTRA_SGST"),
    ).toMatchObject({
      grossPaise: 11800n,
      taxablePaise: 10000n,
      cgstPaise: 900n,
      sgstPaise: 900n,
      totalPaise: 11800n,
    });
  });

  it("tax-inclusive ₹100 at 5% rounds the taxable value half up", () => {
    // 10000 × 10000 / 10500 = 9523.81 → 9524; 9524 × 500 / 20000 = 238.1 → 238
    expect(computeLine(line({ rateBp: 500, priceIncludesTax: true }), "INTRA_SGST")).toMatchObject({
      taxablePaise: 9524n,
      cgstPaise: 238n,
      sgstPaise: 238n,
      totalPaise: 10000n,
    });
    // 9524 × 500 / 10000 = 476.2 → 476
    expect(computeLine(line({ rateBp: 500, priceIncludesTax: true }), "INTER")).toMatchObject({
      taxablePaise: 9524n,
      igstPaise: 476n,
      totalPaise: 10000n,
    });
  });

  it("fractional quantity rounds the gross half up", () => {
    // 1.5 × ₹33.33 = 49.995 → ₹50.00
    expect(computeLine(line({ qtyMilli: 1500n, unitPricePaise: 3333n }), "INTER").grossPaise).toBe(
      5000n,
    );
    // 0.5 × 1 paisa = 0.5 → 1 paisa
    expect(computeLine(line({ qtyMilli: 500n, unitPricePaise: 1n }), "INTER").grossPaise).toBe(1n);
  });

  it("0.25% splits into equal halves rounded half up", () => {
    // 10000 × 25 / 20000 = 12.5 → 13 each
    expect(computeLine(line({ rateBp: 25 }), "INTRA_SGST")).toMatchObject({
      cgstPaise: 13n,
      sgstPaise: 13n,
      totalPaise: 10026n,
    });
    expect(computeLine(line({ rateBp: 25 }), "INTER")).toMatchObject({
      igstPaise: 25n,
      totalPaise: 10025n,
    });
  });

  it("discount comes off before tax", () => {
    expect(computeLine(line({ discountPaise: 1000n }), "INTRA_SGST")).toMatchObject({
      taxableBeforeDiscountPaise: 10000n,
      discountPaise: 1000n,
      taxablePaise: 9000n,
      cgstPaise: 810n,
      sgstPaise: 810n,
      totalPaise: 10620n,
    });
  });

  it("discount on a tax-inclusive line comes off the backed-out taxable value", () => {
    expect(
      computeLine(
        line({ unitPricePaise: 11800n, priceIncludesTax: true, discountPaise: 1000n }),
        "INTER",
      ),
    ).toMatchObject({ taxablePaise: 9000n, igstPaise: 1620n, totalPaise: 10620n });
  });

  it("no-tax mode ignores the rate and the tax-inclusive flag", () => {
    expect(computeLine(line({ unitPricePaise: 11800n, priceIncludesTax: true }), "NONE")).toEqual({
      grossPaise: 11800n,
      taxableBeforeDiscountPaise: 11800n,
      discountPaise: 0n,
      taxablePaise: 11800n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      utgstPaise: 0n,
      igstPaise: 0n,
      totalPaise: 11800n,
    });
  });

  it("0% rate has no tax", () => {
    expect(computeLine(line({ rateBp: 0, priceIncludesTax: true }), "INTRA_SGST")).toMatchObject({
      taxablePaise: 10000n,
      cgstPaise: 0n,
      totalPaise: 10000n,
    });
  });

  it("allows a free line and a full discount", () => {
    expect(computeLine(line({ unitPricePaise: 0n }), "INTER").totalPaise).toBe(0n);
    expect(computeLine(line({ discountPaise: 10000n }), "INTER").totalPaise).toBe(0n);
  });

  it.each([
    [{ qtyMilli: 0n }, "qtyMilli"],
    [{ qtyMilli: -1000n }, "qtyMilli"],
    [{ unitPricePaise: -1n }, "unitPricePaise"],
    [{ rateBp: -1 }, "rateBp"],
    [{ rateBp: 10001 }, "rateBp"],
    [{ rateBp: 18.5 }, "rateBp"],
    [{ discountPaise: -1n }, "discountPaise"],
    [{ discountPaise: 10001n }, "discountPaise"],
  ])("rejects %o", (overrides, field) => {
    try {
      computeLine(line(overrides), "INTER");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((issue) => issue.path)).toEqual([field]);
    }
  });

  it("reports every invalid field at once", () => {
    try {
      computeLine(line({ qtyMilli: 0n, unitPricePaise: -1n, rateBp: -5 }), "INTER");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).issues.map((issue) => issue.path)).toEqual([
        "qtyMilli",
        "unitPricePaise",
        "rateBp",
      ]);
    }
  });
});

describe("computeInvoice", () => {
  it("sums line values and rounds off to the rupee", () => {
    const { lines, totals } = computeInvoice({
      lines: [
        line({ unitPricePaise: 10050n }), // 100.50 + 9.05 + 9.05 = 118.60 (18%)
        line({ unitPricePaise: 1999n, rateBp: 500 }), // 19.99 + 0.50 + 0.50 = 20.99
      ],
      taxMode: "INTRA_SGST",
      roundOff: true,
    });
    expect(lines.map((l) => l.totalPaise)).toEqual([11860n, 2099n]);
    expect(totals).toEqual({
      grossPaise: 12049n,
      discountPaise: 0n,
      taxablePaise: 12049n,
      cgstPaise: 955n,
      sgstPaise: 955n,
      utgstPaise: 0n,
      igstPaise: 0n,
      taxPaise: 1910n,
      subTotalPaise: 13959n,
      roundOffPaise: 41n,
      grandTotalPaise: 14000n,
    });
  });

  it("rounds 50 paise up and 49 paise down", () => {
    const at = (paise: bigint) =>
      computeInvoice({
        lines: [line({ unitPricePaise: paise, rateBp: 0 })],
        taxMode: "INTER",
        roundOff: true,
      }).totals;
    expect(at(10050n)).toMatchObject({ roundOffPaise: 50n, grandTotalPaise: 10100n });
    expect(at(10049n)).toMatchObject({ roundOffPaise: -49n, grandTotalPaise: 10000n });
  });

  it("leaves the total alone without round-off", () => {
    const { totals } = computeInvoice({
      lines: [line({ unitPricePaise: 10050n })],
      taxMode: "INTER",
      roundOff: false,
    });
    expect(totals).toMatchObject({
      subTotalPaise: 11859n,
      roundOffPaise: 0n,
      grandTotalPaise: 11859n,
    });
  });

  it("an empty draft totals zero", () => {
    const { lines, totals } = computeInvoice({ lines: [], taxMode: "INTER", roundOff: true });
    expect(lines).toEqual([]);
    expect(totals.grandTotalPaise).toBe(0n);
  });

  it("prefixes validation paths with the line index", () => {
    try {
      computeInvoice({
        lines: [line(), line({ discountPaise: 99999n })],
        taxMode: "INTER",
        roundOff: false,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((issue) => issue.path)).toEqual([
        "lines.1.discountPaise",
      ]);
    }
  });

  it("rethrows unexpected errors untouched", () => {
    const broken = { ...line(), qtyMilli: undefined } as unknown as LineInput;
    expect(() => computeInvoice({ lines: [broken], taxMode: "INTER", roundOff: false })).toThrow(
      TypeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Property tests for the SPEC §4.5 invariants.

const SPEC_RATES = [0, 25, 300, 500, 1200, 1800, 2800, 4000];
const TAX_MODES: TaxMode[] = ["INTRA_SGST", "INTRA_UTGST", "INTER", "NONE"];

const rateArb = fc.oneof(fc.constantFrom(...SPEC_RATES), fc.integer({ min: 0, max: 5000 }));

/** A valid line: the discount is a random share of the line's pre-discount taxable value. */
const lineArb = (mode: TaxMode): fc.Arbitrary<LineInput> =>
  fc
    .record({
      qtyMilli: fc.bigInt(1n, 10n ** 7n),
      unitPricePaise: fc.bigInt(0n, 10n ** 9n),
      rateBp: rateArb,
      priceIncludesTax: fc.boolean(),
      discountShare: fc.oneof(fc.constant(0n), fc.bigInt(0n, 1000n)),
    })
    .map(({ discountShare, ...rest }) => {
      const before = computeLine({ ...rest, discountPaise: 0n }, mode).taxableBeforeDiscountPaise;
      return { ...rest, discountPaise: (before * discountShare) / 1000n };
    });

const modeArb = fc.constantFrom(...TAX_MODES);

describe("§4.5 invariants", () => {
  it("line total = taxable + taxes, and nothing is negative", () => {
    fc.assert(
      fc.property(
        modeArb.chain((mode) => fc.tuple(fc.constant(mode), lineArb(mode))),
        ([mode, input]) => {
          const out = computeLine(input, mode);
          expect(out.totalPaise).toBe(
            out.taxablePaise + out.cgstPaise + out.sgstPaise + out.utgstPaise + out.igstPaise,
          );
          for (const value of Object.values(out)) expect(value >= 0n).toBe(true);
          expect(out.discountPaise <= out.taxableBeforeDiscountPaise).toBe(true);
          expect(out.taxablePaise).toBe(out.taxableBeforeDiscountPaise - out.discountPaise);
        },
      ),
    );
  });

  it("intra-state lines have equal halves in exactly one of SGST/UTGST, and no IGST", () => {
    fc.assert(
      fc.property(lineArb("INTRA_SGST"), lineArb("INTRA_UTGST"), (sgstLine, utgstLine) => {
        const s = computeLine(sgstLine, "INTRA_SGST");
        expect(s.cgstPaise).toBe(s.sgstPaise);
        expect(s.utgstPaise).toBe(0n);
        expect(s.igstPaise).toBe(0n);

        const u = computeLine(utgstLine, "INTRA_UTGST");
        expect(u.cgstPaise).toBe(u.utgstPaise);
        expect(u.sgstPaise).toBe(0n);
        expect(u.igstPaise).toBe(0n);
      }),
    );
  });

  it("inter-state lines carry only IGST; no-tax lines carry nothing", () => {
    fc.assert(
      fc.property(lineArb("INTER"), lineArb("NONE"), (interLine, noneLine) => {
        const i = computeLine(interLine, "INTER");
        expect([i.cgstPaise, i.sgstPaise, i.utgstPaise]).toEqual([0n, 0n, 0n]);

        const n = computeLine(noneLine, "NONE");
        expect([n.cgstPaise, n.sgstPaise, n.utgstPaise, n.igstPaise]).toEqual([0n, 0n, 0n, 0n]);
        expect(n.totalPaise).toBe(n.taxablePaise);
      }),
    );
  });

  it("tax-exclusive lines: taxable = gross − discount", () => {
    fc.assert(
      fc.property(
        modeArb.chain((mode) =>
          fc.tuple(
            fc.constant(mode),
            lineArb(mode).map((l) => ({ ...l, priceIncludesTax: false })),
          ),
        ),
        ([mode, input]) => {
          const out = computeLine(input, mode);
          expect(out.taxablePaise).toBe(out.grossPaise - input.discountPaise);
        },
      ),
    );
  });

  it("tax-inclusive back-calculation: |taxable + tax − gross| ≤ 1 paisa", () => {
    fc.assert(
      fc.property(
        modeArb.chain((mode) =>
          fc.tuple(
            fc.constant(mode),
            lineArb(mode).map((l) => ({ ...l, priceIncludesTax: true, discountPaise: 0n })),
          ),
        ),
        ([mode, input]) => {
          const out = computeLine(input, mode);
          expect(abs(out.totalPaise - out.grossPaise) <= 1n).toBe(true);
        },
      ),
    );
  });

  it("Σ line totals + round-off = grand total; totals are sums of line values", () => {
    fc.assert(
      fc.property(
        modeArb.chain((mode) =>
          fc.tuple(fc.constant(mode), fc.array(lineArb(mode), { maxLength: 20 }), fc.boolean()),
        ),
        ([mode, inputs, roundOff]) => {
          const { lines, totals } = computeInvoice({ lines: inputs, taxMode: mode, roundOff });
          const sum = (pick: (l: (typeof lines)[number]) => bigint) =>
            lines.reduce((acc, l) => acc + pick(l), 0n);

          expect(totals.subTotalPaise).toBe(sum((l) => l.totalPaise));
          expect(totals.grandTotalPaise).toBe(totals.subTotalPaise + totals.roundOffPaise);
          expect(totals.taxablePaise).toBe(sum((l) => l.taxablePaise));
          expect(totals.cgstPaise).toBe(sum((l) => l.cgstPaise));
          expect(totals.sgstPaise).toBe(sum((l) => l.sgstPaise));
          expect(totals.utgstPaise).toBe(sum((l) => l.utgstPaise));
          expect(totals.igstPaise).toBe(sum((l) => l.igstPaise));
          expect(totals.taxPaise).toBe(
            totals.cgstPaise + totals.sgstPaise + totals.utgstPaise + totals.igstPaise,
          );

          if (roundOff) {
            expect(totals.grandTotalPaise % 100n).toBe(0n);
            expect(totals.roundOffPaise >= -49n && totals.roundOffPaise <= 50n).toBe(true);
          } else {
            expect(totals.roundOffPaise).toBe(0n);
          }
          expect(totals.grandTotalPaise >= 0n).toBe(true);
        },
      ),
    );
  });
});
