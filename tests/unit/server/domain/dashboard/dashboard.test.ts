import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { recoveredAfterReminders } from "@/server/domain/dashboard/recovery";
import { dailySeries } from "@/server/domain/dashboard/series";
import { topN } from "@/server/domain/dashboard/top";

describe("dailySeries", () => {
  it("has one entry per day up to the end, empty days at zero, same days added", () => {
    expect(
      dailySeries(
        [
          { date: "2026-11-09", valuePaise: 500n },
          { date: "2026-11-11", valuePaise: 100n },
          { date: "2026-11-11", valuePaise: -40n },
          { date: "2026-11-01", valuePaise: 999n },
        ],
        "2026-11-11",
        3,
      ),
    ).toEqual([
      { date: "2026-11-09", valuePaise: 500n },
      { date: "2026-11-10", valuePaise: 0n },
      { date: "2026-11-11", valuePaise: 60n },
    ]);
  });

  it("crosses month and year ends", () => {
    expect(dailySeries([], "2027-01-01", 2).map((day) => day.date)).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("keeps the total of the days it covers (property)", () => {
    const day = fc.integer({ min: 1, max: 30 }).map((d) => `2026-11-${String(d).padStart(2, "0")}`);
    fc.assert(
      fc.property(
        fc.array(fc.record({ date: day, valuePaise: fc.bigInt({ min: -1000n, max: 1000n }) })),
        (rows) => {
          const series = dailySeries(rows, "2026-11-30", 30);
          expect(series).toHaveLength(30);
          expect(series.reduce((sum, d) => sum + d.valuePaise, 0n)).toBe(
            rows.reduce((sum, r) => sum + r.valuePaise, 0n),
          );
        },
      ),
    );
  });
});

describe("topN", () => {
  it("biggest first, ties by label, nothing at zero or below", () => {
    expect(
      topN(
        [
          { key: "a", label: "Nails", value: 10n },
          { key: "b", label: "Cement", value: 30n },
          { key: "c", label: "Bolts", value: 10n },
          { key: "d", label: "Sand", value: 0n },
          { key: "e", label: "Glue", value: -5n },
          { key: "f", label: "Paint", value: 20n },
        ],
        3,
      ).map((item) => item.key),
    ).toEqual(["b", "f", "c"]);
  });

  it("equal labels fall back to the key, so the order is stable", () => {
    expect(
      topN(
        [
          { key: "z", label: "Same", value: 1n },
          { key: "y", label: "Same", value: 1n },
        ],
        5,
      ).map((item) => item.key),
    ).toEqual(["y", "z"]);
  });
});

describe("recoveredAfterReminders", () => {
  const reminders = [
    { customerId: "c1", date: "2026-10-01", overduePaise: 10_000n },
    { customerId: "c1", date: "2026-10-10", overduePaise: 4_000n },
    { customerId: "c2", date: "2026-10-05", overduePaise: 3_000n },
  ];

  it("counts payments within 14 days, for the latest reminder, up to what was overdue", () => {
    expect(
      recoveredAfterReminders(reminders, [
        // Before any reminder: not counted.
        { customerId: "c1", date: "2026-09-30", amountPaise: 1_000n },
        // After the first reminder only.
        { customerId: "c1", date: "2026-10-03", amountPaise: 6_000n },
        // After the second: counts towards it (₹40 cap), the rest is not recovered.
        { customerId: "c1", date: "2026-10-12", amountPaise: 5_000n },
        // c2: the 14th day still counts, the 15th doesn't.
        { customerId: "c2", date: "2026-10-19", amountPaise: 1_000n },
        { customerId: "c2", date: "2026-10-20", amountPaise: 1_000n },
        // Someone never reminded.
        { customerId: "c3", date: "2026-10-12", amountPaise: 9_000n },
      ]),
    ).toEqual({ reminders: 3, remindedPaise: 17_000n, recoveredPaise: 11_000n });
  });

  it("is zero with no reminders, and a reminder with nothing overdue recovers nothing", () => {
    expect(recoveredAfterReminders([], [])).toEqual({
      reminders: 0,
      remindedPaise: 0n,
      recoveredPaise: 0n,
    });
    expect(
      recoveredAfterReminders(
        [{ customerId: "c1", date: "2026-10-01", overduePaise: 0n }],
        [{ customerId: "c1", date: "2026-10-02", amountPaise: 500n }],
      ).recoveredPaise,
    ).toBe(0n);
  });

  it("never recovers more than was overdue or paid (property)", () => {
    const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-10-${String(d).padStart(2, "0")}`);
    const who = fc.constantFrom("c1", "c2");
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            customerId: who,
            date: day,
            overduePaise: fc.bigInt({ min: 0n, max: 10_000n }),
          }),
        ),
        fc.array(
          fc.record({
            customerId: who,
            date: day,
            amountPaise: fc.bigInt({ min: 1n, max: 10_000n }),
          }),
        ),
        (rs, ps) => {
          const result = recoveredAfterReminders(rs, ps);
          expect(result.recoveredPaise >= 0n).toBe(true);
          expect(result.recoveredPaise <= result.remindedPaise).toBe(true);
          expect(result.recoveredPaise <= ps.reduce((sum, p) => sum + p.amountPaise, 0n)).toBe(
            true,
          );
        },
      ),
    );
  });
});
