import { describe, expect, it } from "vitest";

import { ageReceivables, type AgingInvoice } from "@/server/domain/ledger/aging";
import { customerCredit } from "@/server/domain/ledger/customer-credit";

const LIMITS = [30, 60, 90] as const;
const TODAY = "2026-11-10";

function aged(invoices: AgingInvoice[], openingOwedPaise = 0n, onAccountPaise = 0n) {
  return ageReceivables(
    { openInvoices: invoices, openingOwedPaise, onAccountPaise, today: TODAY },
    LIMITS,
  );
}

const due = (dueDate: string | null, balancePaise = 100n, invoiceDate = "2026-01-01") => ({
  invoiceDate,
  dueDate,
  balancePaise,
});

describe("ageReceivables", () => {
  it.each([
    ["2026-11-11", "notDue"],
    ["2026-11-10", 0], // due today: 0 days past due
    ["2026-10-11", 0], // 30 days
    ["2026-10-10", 1], // 31 days
    ["2026-09-11", 1], // 60 days
    ["2026-09-10", 2], // 61 days
    ["2026-08-12", 2], // 90 days
    ["2026-08-11", 3], // 91 days
  ] as const)("an invoice due %s goes in %s", (dueDate, bucket) => {
    const result = aged([due(dueDate)]);
    if (bucket === "notDue") {
      expect(result.notDuePaise).toBe(100n);
      expect(result.pastDuePaise).toEqual([0n, 0n, 0n, 0n]);
    } else {
      expect(result.notDuePaise).toBe(0n);
      expect(result.pastDuePaise[bucket]).toBe(100n);
    }
  });

  it("counts as overdue only what was due before today", () => {
    expect(aged([due("2026-11-10"), due("2026-11-09", 50n)]).overduePaise).toBe(50n);
  });

  it("takes the invoice date when there is no due date, across a leap day", () => {
    const result = ageReceivables(
      {
        openInvoices: [due(null, 100n, "2028-01-31")],
        openingOwedPaise: 0n,
        onAccountPaise: 0n,
        today: "2028-03-01",
      },
      LIMITS,
    );
    // 31 Jan → 1 Mar 2028 is 30 days (29 days in February).
    expect(result.pastDuePaise).toEqual([100n, 0n, 0n, 0n]);
  });

  it("skips settled invoices and adds the opening balance less money on account", () => {
    expect(
      aged([due("2026-12-01", 1_000n), due("2026-01-01", 0n), due("2026-06-01", 500n)], 300n, 200n),
    ).toEqual({
      notDuePaise: 1_000n,
      pastDuePaise: [0n, 0n, 0n, 500n],
      openingPaise: 300n,
      onAccountPaise: 200n,
      totalPaise: 1_600n,
      overduePaise: 500n,
    });
  });
});

describe("customerCredit", () => {
  it("works out what is left of an opening balance owed", () => {
    expect(
      customerCredit({
        openingBalancePaise: 5_000n,
        appliedToOpeningPaise: 2_000n,
        appliedFromOpeningPaise: 0n,
        unallocatedPaise: 700n,
      }),
    ).toEqual({ openingOwedPaise: 3_000n, advanceLeftPaise: 0n, onAccountPaise: 700n });
  });

  it("adds what is left of an opening advance to the money on account", () => {
    expect(
      customerCredit({
        openingBalancePaise: -5_000n,
        appliedToOpeningPaise: 0n,
        appliedFromOpeningPaise: 1_000n,
        unallocatedPaise: 700n,
      }),
    ).toEqual({ openingOwedPaise: 0n, advanceLeftPaise: 4_000n, onAccountPaise: 4_700n });
  });

  it.each([
    [5_000n, 5_001n, 0n, 0n],
    [-5_000n, 0n, 5_001n, 0n],
    [0n, 0n, 0n, -1n],
  ])("refuses impossible sums (opening %s)", (opening, to, from, unallocated) => {
    expect(() =>
      customerCredit({
        openingBalancePaise: opening,
        appliedToOpeningPaise: to,
        appliedFromOpeningPaise: from,
        unallocatedPaise: unallocated,
      }),
    ).toThrow(RangeError);
  });
});
