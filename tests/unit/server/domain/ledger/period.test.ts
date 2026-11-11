import { describe, expect, it } from "vitest";

import { LEDGER_PERIODS, periodStart } from "@/server/domain/ledger/period";

describe("periodStart", () => {
  it.each([
    ["fy", "2026-11-11", "2026-04-01"],
    ["fy", "2026-04-01", "2026-04-01"],
    ["fy", "2027-03-31", "2026-04-01"],
    ["lastFy", "2026-11-11", "2025-04-01"],
    ["lastFy", "2027-03-31", "2025-04-01"],
    ["lastFy", "2027-04-01", "2026-04-01"],
  ] as const)("%s on %s starts %s", (period, today, start) => {
    expect(periodStart(period, today)).toBe(start);
  });

  it("all time has no start", () => {
    expect(periodStart("all", "2026-11-11")).toBeNull();
  });

  it("lists the periods in menu order", () => {
    expect(LEDGER_PERIODS).toEqual(["fy", "lastFy", "all"]);
  });
});
