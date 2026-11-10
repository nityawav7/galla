import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  autoAllocate,
  checkManualAllocation,
  oldestFirst,
  type OpenItem,
  pairWithSources,
} from "@/server/domain/payment/allocation";

function invoice(id: string, date: string, balance: bigint, number = `INV/26-27/${id}`): OpenItem {
  return { invoiceId: id, invoiceDate: date, number, balancePaise: balance };
}
const opening = (balance: bigint): OpenItem => ({
  invoiceId: null,
  invoiceDate: null,
  number: null,
  balancePaise: balance,
});

const items = [
  invoice("0003", "2026-10-05", 30_000n),
  invoice("0001", "2026-09-01", 10_000n),
  invoice("0002", "2026-09-01", 20_000n),
];

function problems(run: () => unknown): { path: string; message: string }[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return [...(error as ValidationError).issues];
  }
  throw new Error("expected a ValidationError");
}

describe("oldestFirst", () => {
  it("puts the opening balance first, then invoice date, number and id; drops settled items", () => {
    const sorted = oldestFirst([
      ...items,
      invoice("0004", "2026-08-01", 0n),
      opening(5_000n),
      invoice("b", "2026-09-01", 1n, "INV/26-27/0002"),
    ]);
    expect(sorted.map((item) => item.invoiceId)).toEqual([null, "0001", "0002", "b", "0003"]);
  });
});

describe("autoAllocate", () => {
  it("pays the oldest invoices first and keeps the rest on account", () => {
    expect(autoAllocate(35_000n, items)).toEqual({
      allocations: [
        { invoiceId: "0001", amountPaise: 10_000n },
        { invoiceId: "0002", amountPaise: 20_000n },
        { invoiceId: "0003", amountPaise: 5_000n },
      ],
      onAccountPaise: 0n,
    });
    expect(autoAllocate(70_000n, items).onAccountPaise).toBe(10_000n);
  });

  it("pays the opening balance before any invoice", () => {
    expect(autoAllocate(6_000n, [...items, opening(5_000n)]).allocations).toEqual([
      { invoiceId: null, amountPaise: 5_000n },
      { invoiceId: "0001", amountPaise: 1_000n },
    ]);
  });

  it("puts everything on account when nothing is open, and allows zero", () => {
    expect(autoAllocate(500n, [])).toEqual({ allocations: [], onAccountPaise: 500n });
    expect(autoAllocate(0n, items)).toEqual({ allocations: [], onAccountPaise: 0n });
  });

  it("refuses a negative amount", () => {
    expect(() => autoAllocate(-1n, items)).toThrow(RangeError);
  });

  const openItems = fc.uniqueArray(
    fc.record({
      invoiceId: fc.uuid(),
      invoiceDate: fc
        .integer({ min: 1, max: 28 })
        .map((day) => `2026-10-${String(day).padStart(2, "0")}`),
      number: fc.constant(null),
      balancePaise: fc.bigInt({ min: 0n, max: 100_000n }),
    }),
    { selector: (item) => item.invoiceId, maxLength: 8 },
  );

  it("never over-allocates, keeps every paisa, and is oldest first (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 500_000n }),
        openItems,
        fc.bigInt({ min: 0n, max: 50_000n }),
        (amount, invoices, owed) => {
          const all: OpenItem[] = [...invoices, opening(owed)];
          const { allocations, onAccountPaise } = autoAllocate(amount, all);
          const total = allocations.reduce((sum, a) => sum + a.amountPaise, 0n);
          expect(total + onAccountPaise).toBe(amount);
          expect(onAccountPaise >= 0n).toBe(true);
          const byId = new Map(all.map((item) => [item.invoiceId, item]));
          for (const allocation of allocations) {
            expect(allocation.amountPaise > 0n).toBe(true);
            expect(
              allocation.amountPaise <= (byId.get(allocation.invoiceId)?.balancePaise ?? 0n),
            ).toBe(true);
          }
          // Only the last item paid may be paid in part, and money stays on account only once
          // everything open is paid.
          allocations.slice(0, -1).forEach((allocation) => {
            expect(allocation.amountPaise).toBe(byId.get(allocation.invoiceId)?.balancePaise);
          });
          const paidIds = allocations.map((allocation) => allocation.invoiceId);
          expect(paidIds).toEqual(
            oldestFirst(all)
              .slice(0, paidIds.length)
              .map((item) => item.invoiceId),
          );
          if (onAccountPaise > 0n) expect(paidIds).toHaveLength(oldestFirst(all).length);
          // The input order doesn't matter.
          expect(autoAllocate(amount, [...all].reverse())).toEqual({ allocations, onAccountPaise });
        },
      ),
    );
  });
});

describe("checkManualAllocation", () => {
  it("accepts allocations within each balance and keeps the rest on account", () => {
    expect(
      checkManualAllocation(
        25_000n,
        [
          { invoiceId: "0003", amountPaise: 20_000n },
          { invoiceId: null, amountPaise: 1_000n },
        ],
        [...items, opening(1_000n)],
      ),
    ).toEqual({
      allocations: [
        { invoiceId: "0003", amountPaise: 20_000n },
        { invoiceId: null, amountPaise: 1_000n },
      ],
      onAccountPaise: 4_000n,
    });
  });

  it("reports every problem with its path", () => {
    expect(
      problems(() =>
        checkManualAllocation(
          100_000n,
          [
            { invoiceId: "0001", amountPaise: 10_001n },
            { invoiceId: "0002", amountPaise: 0n },
            { invoiceId: "0001", amountPaise: 1n },
            { invoiceId: "nope", amountPaise: 1n },
            { invoiceId: null, amountPaise: 1n },
          ],
          items,
        ),
      ),
    ).toEqual([
      { path: "items.0.amount", message: "allocationExceedsBalance" },
      { path: "items.1.amount", message: "allocationAmountPositive" },
      { path: "items.2.invoiceId", message: "duplicateInvoice" },
      { path: "items.3.invoiceId", message: "invoiceNotOpen" },
      { path: "items.4.invoiceId", message: "invoiceNotOpen" },
    ]);
  });

  it("refuses allocations that add up to more than the payment", () => {
    expect(
      problems(() =>
        checkManualAllocation(
          15_000n,
          [
            { invoiceId: "0001", amountPaise: 10_000n },
            { invoiceId: "0002", amountPaise: 5_001n },
          ],
          items,
        ),
      ),
    ).toEqual([{ path: "amount", message: "allocationExceedsPayment" }]);
  });

  it("refuses a settled invoice", () => {
    expect(
      problems(() =>
        checkManualAllocation(
          1n,
          [{ invoiceId: "0009", amountPaise: 1n }],
          [invoice("0009", "2026-01-01", 0n)],
        ),
      ),
    ).toEqual([{ path: "items.0.invoiceId", message: "invoiceNotOpen" }]);
  });
});

describe("pairWithSources", () => {
  it("takes from the sources in order, splitting an allocation when needed", () => {
    expect(
      pairWithSources(
        [
          { paymentId: null, availablePaise: 3_000n },
          { paymentId: "p1", availablePaise: 0n },
          { paymentId: "p2", availablePaise: 10_000n },
        ],
        [
          { invoiceId: "0001", amountPaise: 5_000n },
          { invoiceId: "0002", amountPaise: 4_000n },
        ],
      ),
    ).toEqual([
      { paymentId: null, invoiceId: "0001", amountPaise: 3_000n },
      { paymentId: "p2", invoiceId: "0001", amountPaise: 2_000n },
      { paymentId: "p2", invoiceId: "0002", amountPaise: 4_000n },
    ]);
  });

  it("never pays the opening balance from the opening advance", () => {
    expect(
      pairWithSources(
        [
          { paymentId: null, availablePaise: 3_000n },
          { paymentId: "p1", availablePaise: 1_000n },
        ],
        [{ invoiceId: null, amountPaise: 1_000n }],
      ),
    ).toEqual([{ paymentId: "p1", invoiceId: null, amountPaise: 1_000n }]);
  });

  it("refuses allocations beyond the money on account", () => {
    expect(() =>
      pairWithSources(
        [{ paymentId: "p1", availablePaise: 1_000n }],
        [{ invoiceId: "0001", amountPaise: 1_001n }],
      ),
    ).toThrow(RangeError);
  });
});
