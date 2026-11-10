import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildLedger, type LedgerInput } from "@/server/domain/ledger/ledger";

const input: LedgerInput = {
  openingBalancePaise: 50_000n,
  openingDate: "2026-04-10",
  invoices: [
    { id: "i2", number: "INV/26-27/0002", date: "2026-05-01", grandTotalPaise: 20_000n },
    { id: "i1", number: "INV/26-27/0001", date: "2026-05-01", grandTotalPaise: 10_000n },
  ],
  creditNotes: [{ id: "c1", number: "CN/26-27/0001", date: "2026-05-01", grandTotalPaise: 2_000n }],
  payments: [
    { id: "p2", date: "2026-05-01", amountPaise: 3_000n },
    { id: "p1", date: "2026-04-20", amountPaise: 40_000n },
  ],
};

describe("buildLedger", () => {
  it("lists the opening balance, then everything by date with a running balance", () => {
    const ledger = buildLedger(input);
    expect(ledger.rows.map((row) => [row.kind, row.id, row.balancePaise])).toEqual([
      ["OPENING", null, 50_000n],
      ["PAYMENT", "p1", 10_000n],
      // Same day: invoices (by number), then credit notes, then payments.
      ["INVOICE", "i1", 20_000n],
      ["INVOICE", "i2", 40_000n],
      ["CREDIT_NOTE", "c1", 38_000n],
      ["PAYMENT", "p2", 35_000n],
    ]);
    expect(ledger).toMatchObject({
      broughtForwardPaise: null,
      debitPaise: 80_000n,
      creditPaise: 45_000n,
      closingPaise: 35_000n,
    });
  });

  it("shows an opening advance as a credit and leaves out a zero opening balance", () => {
    expect(buildLedger({ ...input, openingBalancePaise: -5_000n }).rows[0]).toMatchObject({
      kind: "OPENING",
      debitPaise: 0n,
      creditPaise: 5_000n,
      balancePaise: -5_000n,
    });
    expect(buildLedger({ ...input, openingBalancePaise: 0n }).rows[0]?.kind).toBe("PAYMENT");
  });

  it("moves the opening row back to an earlier payment's date", () => {
    const ledger = buildLedger({
      ...input,
      payments: [{ id: "p0", date: "2026-04-01", amountPaise: 1_000n }],
    });
    expect(ledger.rows.slice(0, 2).map((row) => [row.kind, row.date])).toEqual([
      ["OPENING", "2026-04-01"],
      ["PAYMENT", "2026-04-01"],
    ]);
  });

  it("folds rows before `from` into a balance brought forward", () => {
    const ledger = buildLedger(input, "2026-05-01");
    expect(ledger.broughtForwardPaise).toBe(10_000n);
    expect(ledger.rows.map((row) => row.id)).toEqual(["i1", "i2", "c1", "p2"]);
    expect(ledger).toMatchObject({
      debitPaise: 30_000n,
      creditPaise: 5_000n,
      closingPaise: 35_000n,
    });
    expect(buildLedger(input, "2027-01-01")).toMatchObject({
      broughtForwardPaise: 35_000n,
      rows: [],
      closingPaise: 35_000n,
    });
    expect(
      buildLedger({ ...input, openingBalancePaise: 0n, payments: [] }, "2026-01-01"),
    ).toMatchObject({ broughtForwardPaise: 0n });
  });

  const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-06-${String(d).padStart(2, "0")}`);
  const doc = fc.record({
    id: fc.uuid(),
    number: fc.string({ maxLength: 4 }),
    date: day,
    grandTotalPaise: fc.bigInt({ min: 0n, max: 1_000_000n }),
  });
  const randomInput = fc.record({
    openingBalancePaise: fc.bigInt({ min: -100_000n, max: 100_000n }),
    openingDate: day,
    invoices: fc.array(doc, { maxLength: 10 }),
    creditNotes: fc.array(doc, { maxLength: 5 }),
    payments: fc.array(
      fc.record({ id: fc.uuid(), date: day, amountPaise: fc.bigInt({ min: 1n, max: 1_000_000n }) }),
      { maxLength: 10 },
    ),
  });
  const sum = (values: readonly { grandTotalPaise?: bigint; amountPaise?: bigint }[]) =>
    values.reduce((total, value) => total + (value.grandTotalPaise ?? value.amountPaise ?? 0n), 0n);

  it("SPEC F7: balance = opening + invoices − payments − credit notes (property)", () => {
    fc.assert(
      fc.property(randomInput, day, (data, from) => {
        const ledger = buildLedger(data);
        expect(ledger.closingPaise).toBe(
          data.openingBalancePaise +
            sum(data.invoices) -
            sum(data.payments) -
            sum(data.creditNotes),
        );
        // Every row is the one before plus its debit, less its credit, in date order.
        let previous = 0n;
        ledger.rows.forEach((row, index) => {
          expect(row.balancePaise).toBe(previous + row.debitPaise - row.creditPaise);
          if (index > 0) expect(row.date >= (ledger.rows[index - 1]?.date ?? "")).toBe(true);
          previous = row.balancePaise;
        });
        // The order the documents come in doesn't matter.
        const shuffled = {
          ...data,
          invoices: [...data.invoices].reverse(),
          payments: [...data.payments].reverse(),
          creditNotes: [...data.creditNotes].reverse(),
        };
        expect(buildLedger(shuffled).closingPaise).toBe(ledger.closingPaise);
        // A period starts from what was brought forward and ends at the same closing balance.
        const period = buildLedger(data, from);
        expect((period.broughtForwardPaise ?? 0n) + period.debitPaise - period.creditPaise).toBe(
          ledger.closingPaise,
        );
        expect(period.closingPaise).toBe(ledger.closingPaise);
      }),
    );
  });
});
