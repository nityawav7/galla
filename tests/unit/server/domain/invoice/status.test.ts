import { describe, expect, it } from "vitest";

import {
  balancePaise,
  displayStatus,
  type DisplayStatusInput,
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
