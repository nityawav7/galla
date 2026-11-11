import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  balancePaise,
  displayStatus,
  type DisplayStatusInput,
  settledStatus,
} from "@/server/domain/invoice/status";

function invoice(overrides: Partial<DisplayStatusInput> = {}): DisplayStatusInput {
  return {
    status: "ISSUED",
    dueDate: "2026-11-10",
    today: "2026-11-06",
    grandTotalPaise: 10_000n,
    amountPaidPaise: 0n,
    amountCreditedPaise: 0n,
    ...overrides,
  };
}

describe("balancePaise", () => {
  it("is the grand total less payments and credit notes", () => {
    expect(balancePaise(invoice({ amountPaidPaise: 2_500n, amountCreditedPaise: 1_000n }))).toBe(
      6_500n,
    );
  });
});

describe("displayStatus", () => {
  it.each(["DRAFT", "CANCELLED"] as const)("shows %s as stored, even if past due", (status) => {
    expect(displayStatus(invoice({ status, dueDate: "2026-01-01" }))).toBe(status);
  });

  it("is ISSUED before the due date and on it", () => {
    expect(displayStatus(invoice())).toBe("ISSUED");
    expect(displayStatus(invoice({ dueDate: "2026-11-06" }))).toBe("ISSUED");
  });

  it("is OVERDUE the day after the due date (IST) while money is owed", () => {
    expect(displayStatus(invoice({ dueDate: "2026-11-05" }))).toBe("OVERDUE");
    expect(
      displayStatus(
        invoice({ status: "PARTIALLY_PAID", dueDate: "2026-11-05", amountPaidPaise: 100n }),
      ),
    ).toBe("OVERDUE");
  });

  it("is never OVERDUE without a due date", () => {
    expect(displayStatus(invoice({ dueDate: null }))).toBe("ISSUED");
  });

  it("is CREDITED when credit notes cleared the balance", () => {
    expect(displayStatus(invoice({ dueDate: "2026-01-01", amountCreditedPaise: 10_000n }))).toBe(
      "CREDITED",
    );
  });

  it("is PAID when payments (with or without credit) cleared it", () => {
    expect(
      displayStatus(
        invoice({ status: "PAID", amountPaidPaise: 6_000n, amountCreditedPaise: 4_000n }),
      ),
    ).toBe("PAID");
  });

  it("keeps the stored status for a zero-value invoice", () => {
    expect(displayStatus(invoice({ grandTotalPaise: 0n, dueDate: "2026-01-01" }))).toBe("ISSUED");
  });
});

describe("settledStatus", () => {
  const money = (paid: bigint, credited: bigint) => ({
    grandTotalPaise: 10_000n,
    amountPaidPaise: paid,
    amountCreditedPaise: credited,
  });

  it.each([
    [0n, 0n, "ISSUED"],
    [0n, 4_000n, "ISSUED"],
    [0n, 10_000n, "ISSUED"],
    [1n, 0n, "PARTIALLY_PAID"],
    [6_000n, 3_999n, "PARTIALLY_PAID"],
    [6_000n, 4_000n, "PAID"],
    [10_000n, 0n, "PAID"],
  ] as const)("paid %s, credited %s → %s", (paid, credited, expected) => {
    expect(settledStatus(money(paid, credited))).toBe(expected);
  });

  it("agrees with displayStatus once nothing is overdue", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        (grand, a, b) => {
          const paid = a > grand ? grand : a;
          const credited = b > grand - paid ? grand - paid : b;
          const input = {
            grandTotalPaise: grand,
            amountPaidPaise: paid,
            amountCreditedPaise: credited,
          };
          const status = settledStatus(input);
          const shown = displayStatus({ ...input, status, dueDate: null, today: "2026-11-10" });
          if (status === "PAID") expect(shown).toBe("PAID");
          if (status === "PARTIALLY_PAID") expect(shown).toBe("PARTIALLY_PAID");
          if (status === "ISSUED") expect(["ISSUED", "CREDITED"]).toContain(shown);
        },
      ),
    );
  });
});
