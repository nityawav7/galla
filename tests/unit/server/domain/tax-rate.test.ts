import { describe, expect, it } from "vitest";

import { formatRatePercent, parseRatePercent } from "@/server/domain/tax-rate";

describe("parseRatePercent", () => {
  it.each([
    ["18", 1800],
    ["18%", 1800],
    [" 18 % ", 1800],
    ["0", 0],
    ["0.25", 25],
    ["5.0", 500],
    ["100", 10000],
  ])("reads %j as %i basis points", (input, rateBp) => {
    expect(parseRatePercent(input)).toBe(rateBp);
  });

  it.each(["", "%", "eighteen", "-5", "18.255", "100.01", "1,800"])("rejects %j", (input) => {
    expect(parseRatePercent(input)).toBeNull();
  });
});

describe("formatRatePercent", () => {
  it.each([
    [1800, "18%"],
    [25, "0.25%"],
    [0, "0%"],
    [250, "2.5%"],
  ])("shows %i basis points as %s", (rateBp, label) => {
    expect(formatRatePercent(rateBp)).toBe(label);
  });
});
