import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { formatQuantity, parseQuantity } from "@/server/domain/quantity";

describe("parseQuantity", () => {
  it.each([
    ["1", 1000n],
    ["1.5", 1500n],
    ["0.25", 250n],
    ["0.001", 1n],
    ["2.000", 2000n],
    ["1,000", 1000000n],
    [" 3 ", 3000n],
  ])("parses %j", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it.each(["", "1.0001", "-1", "1/2", "abc"])("rejects %j", (input) => {
    expect(() => parseQuantity(input)).toThrow(ValidationError);
  });
});

describe("formatQuantity", () => {
  it.each([
    [1000n, "1"],
    [1500n, "1.5"],
    [250n, "0.25"],
    [1n, "0.001"],
    [0n, "0"],
    [1000000n, "1000"],
    [-1500n, "-1.5"],
  ])("formats %i milli-units as %s", (milli, expected) => {
    expect(formatQuantity(milli)).toBe(expected);
  });

  it("round-trips with parseQuantity", () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 12n), (milli) => {
        expect(parseQuantity(formatQuantity(milli))).toBe(milli);
      }),
    );
  });
});
