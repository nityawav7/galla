import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { releaseAllocations } from "@/server/domain/payment/release";

const rows = [
  { paymentId: "p1", paymentDate: "2026-11-01", amountPaise: 30_000n },
  { paymentId: null, paymentDate: null, amountPaise: 5_000n },
  { paymentId: "p3", paymentDate: "2026-11-05", amountPaise: 10_000n },
  { paymentId: "p2", paymentDate: "2026-11-05", amountPaise: 2_000n },
];

describe("releaseAllocations", () => {
  it("takes money back from the newest payment first and the opening advance last", () => {
    expect(releaseAllocations(13_000n, rows)).toEqual([
      { paymentId: "p3", amountPaise: 10_000n },
      { paymentId: "p2", amountPaise: 2_000n },
      { paymentId: "p1", amountPaise: 1_000n },
    ]);
    expect(releaseAllocations(46_000n, rows).at(-1)).toEqual({
      paymentId: null,
      amountPaise: 4_000n,
    });
  });

  it("releases nothing for nothing, and refuses more than was paid", () => {
    expect(releaseAllocations(0n, rows)).toEqual([]);
    expect(() => releaseAllocations(47_001n, rows)).toThrow(RangeError);
    expect(() => releaseAllocations(-1n, rows)).toThrow(RangeError);
  });

  it("releases exactly the excess, never more than a row holds (property)", () => {
    const row = fc.record({
      paymentId: fc.option(fc.uuid(), { nil: null }),
      paymentDate: fc.option(
        fc.integer({ min: 1, max: 28 }).map((d) => `2026-11-${String(d).padStart(2, "0")}`),
        { nil: null },
      ),
      amountPaise: fc.bigInt({ min: 1n, max: 100_000n }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(row, { maxLength: 8, selector: (r) => r.paymentId }),
        fc.integer({ min: 0, max: 1000 }),
        (allocations, share) => {
          const paid = allocations.reduce((sum, r) => sum + r.amountPaise, 0n);
          const excess = (paid * BigInt(share)) / 1000n;
          const released = releaseAllocations(excess, allocations);
          expect(released.reduce((sum, r) => sum + r.amountPaise, 0n)).toBe(excess);
          for (const item of released) {
            const from = allocations.find((r) => r.paymentId === item.paymentId);
            expect(item.amountPaise > 0n && item.amountPaise <= (from?.amountPaise ?? 0n)).toBe(
              true,
            );
          }
        },
      ),
    );
  });
});
