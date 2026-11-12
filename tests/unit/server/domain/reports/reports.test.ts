import { describe, expect, it } from "vitest";

import { toCsv } from "@/server/domain/reports/csv";
import { type HsnLine, hsnSummary } from "@/server/domain/reports/hsn";
import { presetRange, rangeProblem, REPORT_PRESETS } from "@/server/domain/reports/period";
import {
  type RegisterInvoice,
  type RegisterNote,
  salesRegister,
} from "@/server/domain/reports/register";

describe("presetRange", () => {
  it.each([
    ["thisMonth", "2026-11-11", "2026-11-01", "2026-11-11"],
    ["lastMonth", "2026-11-11", "2026-10-01", "2026-10-31"],
    ["lastMonth", "2026-03-15", "2026-02-01", "2026-02-28"],
    ["lastMonth", "2027-01-05", "2026-12-01", "2026-12-31"],
    ["thisQuarter", "2026-11-11", "2026-10-01", "2026-11-11"],
    ["thisQuarter", "2027-02-01", "2027-01-01", "2027-02-01"],
    ["lastQuarter", "2026-11-11", "2026-07-01", "2026-09-30"],
    ["lastQuarter", "2026-05-01", "2026-01-01", "2026-03-31"],
    ["thisFy", "2026-11-11", "2026-04-01", "2026-11-11"],
    ["thisFy", "2027-03-31", "2026-04-01", "2027-03-31"],
  ] as const)("%s on %s is %s to %s", (preset, today, from, to) => {
    expect(presetRange(preset, today)).toEqual({ from, to });
  });

  it("lists the presets in menu order", () => {
    expect(REPORT_PRESETS).toEqual([
      "thisMonth",
      "lastMonth",
      "thisQuarter",
      "lastQuarter",
      "thisFy",
    ]);
  });
});

describe("rangeProblem", () => {
  it.each([
    ["2026-11-01", "2026-11-11", null],
    ["2026-11-11", "2026-11-11", null],
    ["2026-11-12", "2026-11-11", "rangeReversed"],
    ["2025-11-11", "2026-11-11", null],
    ["2025-11-10", "2026-11-11", "rangeTooLong"],
    ["2026-02-30", "2026-03-01", "dateInvalid"],
  ] as const)("%s to %s → %s", (from, to, problem) => {
    expect(rangeProblem(from, to, 366)).toBe(problem);
  });
});

const zero = {
  cgstPaise: 0n,
  sgstPaise: 0n,
  utgstPaise: 0n,
  igstPaise: 0n,
  roundOffPaise: 0n,
};

const invoices: RegisterInvoice[] = [
  {
    date: "2026-11-02",
    number: "SH/26-27/0002",
    status: "CANCELLED",
    customer: "Mehta Traders",
    gstin: null,
    placeOfSupply: "27",
    ...zero,
    taxablePaise: 50_000n,
    totalPaise: 50_000n,
    paidPaise: 0n,
    creditedPaise: 0n,
  },
  {
    date: "2026-11-01",
    number: "SH/26-27/0001",
    status: "PARTIALLY_PAID",
    customer: "Shah Stores",
    gstin: "29AABCU9603R1ZM",
    placeOfSupply: "29",
    ...zero,
    taxablePaise: 10_000n,
    igstPaise: 1_800n,
    roundOffPaise: 0n,
    totalPaise: 11_800n,
    paidPaise: 5_000n,
    creditedPaise: 1_180n,
  },
];

const notes: RegisterNote[] = [
  {
    date: "2026-11-01",
    number: "CN/26-27/0001",
    invoiceNumber: "SH/26-27/0001",
    customer: "Shah Stores",
    gstin: "29AABCU9603R1ZM",
    placeOfSupply: "29",
    ...zero,
    taxablePaise: 1_000n,
    igstPaise: 180n,
    totalPaise: 1_180n,
  },
];

describe("salesRegister", () => {
  it("lists invoices and credit notes by date; cancelled ones stay, at zero", () => {
    const { rows, totals } = salesRegister(invoices, notes);
    expect(
      rows.map((row) => [row.kind, row.number, row.status, row.totalPaise, row.balancePaise]),
    ).toEqual([
      ["INVOICE", "SH/26-27/0001", "PARTIALLY_PAID", 11_800n, 5_620n],
      ["CREDIT_NOTE", "CN/26-27/0001", "CREDIT_NOTE", -1_180n, 0n],
      ["INVOICE", "SH/26-27/0002", "CANCELLED", 0n, 0n],
    ]);
    expect(rows[1]).toMatchObject({
      against: "SH/26-27/0001",
      taxablePaise: -1_000n,
      igstPaise: -180n,
    });
    expect(totals).toEqual({
      invoices: 2,
      cancelled: 1,
      creditNotes: 1,
      taxablePaise: 9_000n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      utgstPaise: 0n,
      igstPaise: 1_620n,
      roundOffPaise: 0n,
      totalPaise: 10_620n,
    });
  });

  it("orders invoices of the same day by number", () => {
    const later = { ...invoices[1], number: "SH/26-27/0010" } as RegisterInvoice;
    const earlier = { ...invoices[1], number: "SH/26-27/0009" } as RegisterInvoice;
    expect(salesRegister([later, earlier], []).rows.map((row) => row.number)).toEqual([
      "SH/26-27/0009",
      "SH/26-27/0010",
    ]);
  });

  it("is empty for an empty period", () => {
    expect(salesRegister([], []).rows).toEqual([]);
  });
});

describe("hsnSummary", () => {
  const line = (overrides: Partial<HsnLine>): HsnLine => ({
    hsn: "3917",
    uqc: "NOS",
    rateBp: 1800,
    qtyMilli: 1_000n,
    taxablePaise: 10_000n,
    cgstPaise: 900n,
    sgstPaise: 900n,
    utgstPaise: 0n,
    igstPaise: 0n,
    credit: false,
    ...overrides,
  });

  it("groups by HSN, unit and rate; credit notes take away; no HSN sorts last", () => {
    const { rows, totals } = hsnSummary([
      line({}),
      line({
        qtyMilli: 2_000n,
        taxablePaise: 20_000n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        igstPaise: 3_600n,
      }),
      line({
        credit: true,
        qtyMilli: 500n,
        taxablePaise: 5_000n,
        cgstPaise: 450n,
        sgstPaise: 450n,
      }),
      line({ rateBp: 500, taxablePaise: 1_000n, cgstPaise: 25n, sgstPaise: 25n }),
      line({ hsn: null, uqc: "KGS", rateBp: 0, taxablePaise: 700n, cgstPaise: 0n, sgstPaise: 0n }),
      line({
        hsn: "1006",
        uqc: "KGS",
        utgstPaise: 50n,
        sgstPaise: 0n,
        cgstPaise: 50n,
        taxablePaise: 1_000n,
      }),
    ]);
    expect(rows).toEqual([
      {
        hsn: "1006",
        uqc: "KGS",
        rateBp: 1800,
        qtyMilli: 1_000n,
        taxablePaise: 1_000n,
        igstPaise: 0n,
        cgstPaise: 50n,
        sgstPaise: 50n,
        totalPaise: 1_100n,
      },
      {
        hsn: "3917",
        uqc: "NOS",
        rateBp: 500,
        qtyMilli: 1_000n,
        taxablePaise: 1_000n,
        igstPaise: 0n,
        cgstPaise: 25n,
        sgstPaise: 25n,
        totalPaise: 1_050n,
      },
      {
        hsn: "3917",
        uqc: "NOS",
        rateBp: 1800,
        qtyMilli: 2_500n,
        taxablePaise: 25_000n,
        igstPaise: 3_600n,
        cgstPaise: 450n,
        sgstPaise: 450n,
        totalPaise: 29_500n,
      },
      {
        hsn: null,
        uqc: "KGS",
        rateBp: 0,
        qtyMilli: 1_000n,
        taxablePaise: 700n,
        igstPaise: 0n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        totalPaise: 700n,
      },
    ]);
    expect(totals).toEqual({
      taxablePaise: 27_700n,
      igstPaise: 3_600n,
      cgstPaise: 525n,
      sgstPaise: 525n,
      totalPaise: 32_350n,
    });
  });
});

describe("hsnSummary ordering", () => {
  it("keeps lines without an HSN last, by unit", () => {
    const base: HsnLine = {
      hsn: null,
      uqc: "NOS",
      rateBp: 0,
      qtyMilli: 1n,
      taxablePaise: 1n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      utgstPaise: 0n,
      igstPaise: 0n,
      credit: false,
    };
    expect(
      hsnSummary([base, { ...base, uqc: "BAG" }, { ...base, hsn: "1006" }]).rows.map((row) => [
        row.hsn,
        row.uqc,
      ]),
    ).toEqual([
      ["1006", "NOS"],
      [null, "BAG"],
      [null, "NOS"],
    ]);
  });
});

describe("toCsv", () => {
  it("quotes what needs it, keeps numbers, and defuses formulas", () => {
    expect(
      toCsv([
        ["Name", "Amount", "Note"],
        ['Shah, "Big" Stores', "-1180.00", "=HYPERLINK(1)"],
        ["Line\nbreak", "12", "+91 98765"],
        ["@cmd", "-", "-x"],
      ]),
    ).toBe(
      [
        "﻿Name,Amount,Note",
        '"Shah, ""Big"" Stores",-1180.00,\'=HYPERLINK(1)',
        '"Line\nbreak",12,\'+91 98765',
        "'@cmd,'-,'-x",
        "",
      ].join("\r\n"),
    );
  });
});
