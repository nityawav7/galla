import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildGstr1,
  type Gstr1Invoice,
  type Gstr1Line,
  type Gstr1Note,
} from "@/server/domain/gstr1/build";
import { gstr1Periods, parseGstr1Period } from "@/server/domain/gstr1/period";

const LAKH = 10_000_000n;

function line(overrides: Partial<Gstr1Line> = {}): Gstr1Line {
  return {
    rateBp: 1800,
    taxablePaise: 10_000n,
    igstPaise: 0n,
    cgstPaise: 900n,
    sgstPaise: 900n,
    utgstPaise: 0n,
    hsn: "3917",
    uqc: "NOS-NUMBERS",
    qtyMilli: 1_000n,
    ...overrides,
  };
}

function invoice(overrides: Partial<Gstr1Invoice> = {}): Gstr1Invoice {
  return {
    number: "INV/26-27/0001",
    date: "2026-11-02",
    cancelled: false,
    recipientGstin: null,
    recipientName: null,
    placeOfSupply: "27",
    interState: false,
    totalPaise: 11_800n,
    lines: [line()],
    ...overrides,
  };
}

describe("parseGstr1Period", () => {
  it.each([
    ["2026-11", { from: "2026-11-01", to: "2026-11-30", kind: "month" }],
    ["2027-02", { from: "2027-02-01", to: "2027-02-28", kind: "month" }],
    ["26-27-Q1", { from: "2026-04-01", to: "2026-06-30", kind: "quarter" }],
    ["26-27-Q3", { from: "2026-10-01", to: "2026-12-31", kind: "quarter" }],
    ["26-27-Q4", { from: "2027-01-01", to: "2027-03-31", kind: "quarter" }],
  ] as const)("%s", (value, expected) => {
    expect(parseGstr1Period(value)).toEqual({ value, ...expected });
  });

  it.each(["2026-13", "2026-1", "26-28-Q1", "26-27-Q5", "", "nope"])("refuses %s", (value) => {
    expect(parseGstr1Period(value)).toBeNull();
  });

  it("offers this and the last 11 months, and this and the last 3 quarters", () => {
    const periods = gstr1Periods("2026-11-12");
    expect(periods.months).toHaveLength(12);
    expect(periods.months[0]).toBe("2026-11");
    expect(periods.months.at(-1)).toBe("2025-12");
    expect(periods.quarters).toEqual(["26-27-Q3", "26-27-Q2", "26-27-Q1", "25-26-Q4"]);
    expect(gstr1Periods("2027-01-05").quarters[0]).toBe("26-27-Q4");
  });
});

describe("buildGstr1", () => {
  it("a registered buyer goes to B2B, one row per rate; 0% to EXEMP as nil-rated", () => {
    const report = buildGstr1({
      b2clThresholdPaise: LAKH,
      invoices: [
        invoice({
          recipientGstin: "29AABCU9603R1ZM",
          recipientName: "Shah Stores",
          placeOfSupply: "29",
          interState: true,
          totalPaise: 22_350n,
          lines: [
            line({ igstPaise: 1_800n, cgstPaise: 0n, sgstPaise: 0n }),
            line({
              rateBp: 500,
              igstPaise: 50n,
              cgstPaise: 0n,
              sgstPaise: 0n,
              taxablePaise: 1_000n,
            }),
            line({
              rateBp: 1800,
              igstPaise: 900n,
              cgstPaise: 0n,
              sgstPaise: 0n,
              taxablePaise: 5_000n,
            }),
            line({ rateBp: 0, cgstPaise: 0n, sgstPaise: 0n, taxablePaise: 3_600n, hsn: "1006" }),
          ],
        }),
      ],
      notes: [],
    });
    expect(report.b2b).toEqual([
      {
        gstin: "29AABCU9603R1ZM",
        name: "Shah Stores",
        number: "INV/26-27/0001",
        date: "2026-11-02",
        invoiceValuePaise: 22_350n,
        placeOfSupply: "29",
        rateBp: 500,
        taxablePaise: 1_000n,
      },
      {
        gstin: "29AABCU9603R1ZM",
        name: "Shah Stores",
        number: "INV/26-27/0001",
        date: "2026-11-02",
        invoiceValuePaise: 22_350n,
        placeOfSupply: "29",
        rateBp: 1800,
        taxablePaise: 15_000n,
      },
    ]);
    expect(report.exemp).toEqual([
      { supply: "INTER_REGISTERED", nilRatedPaise: 3_600n },
      { supply: "INTRA_REGISTERED", nilRatedPaise: 0n },
      { supply: "INTER_UNREGISTERED", nilRatedPaise: 0n },
      { supply: "INTRA_UNREGISTERED", nilRatedPaise: 0n },
    ]);
    expect(report.b2cl).toEqual([]);
    expect(report.b2cs).toEqual([]);
    expect(report.hsnB2b.map((row) => [row.hsn, row.rateBp, row.taxablePaise])).toEqual([
      ["1006", 0, 3_600n],
      ["3917", 500, 1_000n],
      ["3917", 1800, 15_000n],
    ]);
  });

  it("unregistered: inter-state above ₹1 lakh is B2CL, the rest is B2CS by state and rate", () => {
    const big = LAKH * 2n;
    const report = buildGstr1({
      b2clThresholdPaise: LAKH,
      invoices: [
        invoice({
          number: "INV/26-27/0002",
          placeOfSupply: "29",
          interState: true,
          totalPaise: big,
          lines: [line({ taxablePaise: big, cgstPaise: 0n, sgstPaise: 0n })],
        }),
        // Exactly ₹1 lakh is not above it: B2CS.
        invoice({
          number: "INV/26-27/0003",
          placeOfSupply: "29",
          interState: true,
          totalPaise: LAKH,
          lines: [line({ taxablePaise: 5_000n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 900n })],
        }),
        invoice({ number: "INV/26-27/0004" }),
        invoice({ number: "INV/26-27/0005" }),
      ],
      notes: [],
    });
    expect(report.b2cl).toEqual([
      {
        number: "INV/26-27/0002",
        date: "2026-11-02",
        invoiceValuePaise: big,
        placeOfSupply: "29",
        rateBp: 1800,
        taxablePaise: big,
      },
    ]);
    expect(report.b2cs).toEqual([
      { placeOfSupply: "27", rateBp: 1800, taxablePaise: 20_000n },
      { placeOfSupply: "29", rateBp: 1800, taxablePaise: 5_000n },
    ]);
    expect(report.hsnB2c[0]).toMatchObject({ hsn: "3917", rateBp: 1800, qtyMilli: 4_000n });
  });

  it("credit notes: registered to CDNR, against B2CL to CDNUR, other unregistered reduce B2CS", () => {
    const note = (overrides: Partial<Gstr1Note>): Gstr1Note => ({
      number: "CN/26-27/0001",
      date: "2026-11-09",
      recipientGstin: null,
      recipientName: null,
      placeOfSupply: "27",
      interState: false,
      totalPaise: 5_900n,
      invoiceTotalPaise: 11_800n,
      lines: [line({ taxablePaise: 5_000n, cgstPaise: 450n, sgstPaise: 450n })],
      ...overrides,
    });
    const report = buildGstr1({
      b2clThresholdPaise: LAKH,
      invoices: [invoice({})],
      notes: [
        note({
          recipientGstin: "29AABCU9603R1ZM",
          recipientName: "Shah Stores",
          placeOfSupply: "29",
          interState: true,
        }),
        note({
          number: "CN/26-27/0002",
          placeOfSupply: "29",
          interState: true,
          invoiceTotalPaise: LAKH * 3n,
        }),
        note({ number: "CN/26-27/0003" }),
      ],
    });
    expect(report.cdnr).toEqual([
      {
        gstin: "29AABCU9603R1ZM",
        name: "Shah Stores",
        noteNumber: "CN/26-27/0001",
        noteDate: "2026-11-09",
        placeOfSupply: "29",
        noteValuePaise: 5_900n,
        rateBp: 1800,
        taxablePaise: 5_000n,
      },
    ]);
    expect(report.cdnur).toEqual([
      {
        noteNumber: "CN/26-27/0002",
        noteDate: "2026-11-09",
        placeOfSupply: "29",
        noteValuePaise: 5_900n,
        rateBp: 1800,
        taxablePaise: 5_000n,
      },
    ]);
    // ₹100 sold in Maharashtra less the ₹50 note on a small sale.
    expect(report.b2cs).toEqual([{ placeOfSupply: "27", rateBp: 1800, taxablePaise: 5_000n }]);
    expect(report.hsnB2c[0]).toMatchObject({ qtyMilli: -1_000n, taxablePaise: 0n });
    expect(report.hsnB2b[0]).toMatchObject({ qtyMilli: -1_000n, taxablePaise: -5_000n });
  });

  it("cancelled invoices only count in DOCS; DOCS gives each series' range", () => {
    const report = buildGstr1({
      b2clThresholdPaise: LAKH,
      invoices: [
        invoice({ number: "INV/26-27/0003" }),
        invoice({ number: "INV/26-27/0001", cancelled: true }),
        invoice({ number: "INV/26-27/0002", lines: [line({ hsn: null })] }),
      ],
      notes: [
        {
          number: "CN/26-27/0004",
          date: "2026-11-09",
          recipientGstin: null,
          recipientName: null,
          placeOfSupply: "27",
          interState: false,
          totalPaise: 1_180n,
          invoiceTotalPaise: 11_800n,
          lines: [line({ taxablePaise: 1_000n })],
        },
      ],
    });
    expect(report.docs).toEqual([
      { nature: "INVOICES", from: "INV/26-27/0001", to: "INV/26-27/0003", total: 3, cancelled: 1 },
      {
        nature: "CREDIT_NOTES",
        from: "CN/26-27/0004",
        to: "CN/26-27/0004",
        total: 1,
        cancelled: 0,
      },
    ]);
    expect(report.b2cs).toEqual([{ placeOfSupply: "27", rateBp: 1800, taxablePaise: 19_000n }]);
    expect(report.linesWithoutHsn).toBe(1);
    expect(buildGstr1({ b2clThresholdPaise: LAKH, invoices: [], notes: [] }).docs).toEqual([]);
  });

  it("every rupee of taxable value lands in exactly one table (property)", () => {
    const rate = fc.constantFrom(0, 500, 1800);
    const anyLine = fc
      .record({
        rateBp: rate,
        taxablePaise: fc.bigInt({ min: 0n, max: 5_000_000n }),
        hsn: fc.option(fc.constantFrom("1006", "3917"), { nil: null }),
      })
      .map((l) => line({ ...l, cgstPaise: 0n, sgstPaise: 0n }));
    const who = fc.record({
      recipientGstin: fc.option(fc.constant("29AABCU9603R1ZM"), { nil: null }),
      interState: fc.boolean(),
      placeOfSupply: fc.constantFrom("27", "29"),
    });
    const anyInvoice = fc
      .record({
        who,
        lines: fc.array(anyLine, { minLength: 1, maxLength: 4 }),
        cancelled: fc.boolean(),
        total: fc.bigInt({ min: 1n, max: LAKH * 3n }),
      })
      .map(({ who: w, lines, cancelled, total }) =>
        invoice({ ...w, lines, cancelled, totalPaise: total }),
      );
    const anyNote = fc
      .record({
        who,
        lines: fc.array(anyLine, { minLength: 1, maxLength: 2 }),
        total: fc.bigInt({ min: 1n, max: LAKH * 3n }),
      })
      .map(({ who: w, lines, total }): Gstr1Note => ({
        number: "CN/26-27/0001",
        date: "2026-11-09",
        recipientName: null,
        totalPaise: 1n,
        invoiceTotalPaise: total,
        ...w,
        lines,
      }));
    fc.assert(
      fc.property(
        fc.array(anyInvoice, { maxLength: 6 }),
        fc.array(anyNote, { maxLength: 3 }),
        (invoices, notes) => {
          const report = buildGstr1({ b2clThresholdPaise: LAKH, invoices, notes });
          const sum = (rows: readonly { taxablePaise: bigint }[]) =>
            rows.reduce((total, row) => total + row.taxablePaise, 0n);
          const net =
            invoices.filter((i) => !i.cancelled).reduce((t, i) => t + sum(i.lines), 0n) -
            notes.reduce((t, n) => t + sum(n.lines), 0n);
          const nil = report.exemp.reduce((t, row) => t + row.nilRatedPaise, 0n);
          expect(
            sum(report.b2b) +
              sum(report.b2cl) +
              sum(report.b2cs) +
              nil -
              sum(report.cdnr) -
              sum(report.cdnur),
          ).toBe(net);
          expect(sum(report.hsnB2b) + sum(report.hsnB2c)).toBe(net);
        },
      ),
    );
  });
});
