import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  divRoundHalfUp,
  formatINR,
  formatRupees,
  parseRupees,
  roundToRupee,
  sumPaise,
} from "@/server/domain/money";

describe("divRoundHalfUp", () => {
  it.each([
    [0n, 3n, 0n],
    [10n, 4n, 3n], // 2.5 → 3
    [9n, 4n, 2n], // 2.25 → 2
    [11n, 4n, 3n], // 2.75 → 3
    [-10n, 4n, -3n], // -2.5 → -3 (half away from zero)
    [-9n, 4n, -2n],
    [-11n, 4n, -3n],
    [1n, 2n, 1n],
    [-1n, 2n, -1n],
    [1n, 3n, 0n],
  ])("%i / %i = %i", (n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected);
  });

  it("rejects a non-positive denominator", () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1n, -2n)).toThrow(RangeError);
  });

  it("is within half a unit of the exact quotient", () => {
    fc.assert(
      fc.property(fc.bigInt(-(10n ** 18n), 10n ** 18n), fc.bigInt(1n, 10n ** 9n), (n, d) => {
        const q = divRoundHalfUp(n, d);
        const error = q * d - n; // scaled by d
        expect(2n * (error < 0n ? -error : error) <= d).toBe(true);
      }),
    );
  });

  it("is symmetric around zero", () => {
    fc.assert(
      fc.property(fc.bigInt(-(10n ** 15n), 10n ** 15n), fc.bigInt(1n, 10n ** 6n), (n, d) => {
        expect(divRoundHalfUp(-n, d)).toBe(-divRoundHalfUp(n, d));
      }),
    );
  });
});

describe("parseRupees", () => {
  it.each([
    ["0", 0n],
    ["1", 100n],
    ["1.5", 150n],
    ["1.05", 105n],
    ["0.99", 99n],
    [" 120.50 ", 12050n],
    ["1,23,456.78", 12345678n],
    ["1,234,567", 123456700n],
    ["007", 700n],
    ["12345678901234567", 1234567890123456700n],
  ])("parses %j", (input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });

  it.each(["", " ", ".", "1.", ".5", "1.234", "-1", "+1", "1e3", "abc", "1.2.3", "₹10", "1 000"])(
    "rejects %j",
    (input) => {
      expect(() => parseRupees(input)).toThrow(ValidationError);
    },
  );

  it("round-trips with formatRupees", () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 15n), (paise) => {
        expect(parseRupees(formatRupees(paise))).toBe(paise);
      }),
    );
  });
});

describe("formatRupees", () => {
  it.each([
    [0n, "0.00"],
    [5n, "0.05"],
    [100n, "1.00"],
    [12345678n, "123456.78"],
    [-150n, "-1.50"],
    [-5n, "-0.05"],
  ])("formats %i paise as %s", (paise, expected) => {
    expect(formatRupees(paise)).toBe(expected);
  });
});

describe("formatINR", () => {
  it.each([
    [0n, "₹0.00"],
    [5n, "₹0.05"],
    [99n, "₹0.99"],
    [100000n, "₹1,000.00"],
    [10000000n, "₹1,00,000.00"],
    [12345678950n, "₹12,34,56,789.50"],
    [-12345n, "-₹123.45"],
    [-50n, "-₹0.50"],
  ])("formats %i paise as %s", (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it("matches Intl en-IN currency formatting", () => {
    const intl = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
    fc.assert(
      fc.property(fc.bigInt(-(10n ** 13n), 10n ** 13n), (paise) => {
        expect(formatINR(paise)).toBe(intl.format(Number(paise) / 100));
      }),
    );
  });
});

describe("roundToRupee", () => {
  it.each([
    [0n, 0n],
    [149n, 100n],
    [150n, 200n], // 50 paise rounds up
    [199n, 200n],
    [12345n, 12300n],
    [-150n, -200n],
  ])("%i → %i", (paise, expected) => {
    expect(roundToRupee(paise)).toBe(expected);
  });

  it("moves by at most 50 paise and lands on a whole rupee", () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 15n), (paise) => {
        const rounded = roundToRupee(paise);
        expect(rounded % 100n).toBe(0n);
        expect(rounded - paise >= -49n && rounded - paise <= 50n).toBe(true);
      }),
    );
  });
});

describe("sumPaise", () => {
  it("adds bigint amounts exactly", () => {
    expect(sumPaise([])).toBe(0n);
    expect(sumPaise([1n, 2n, 3n])).toBe(6n);
    expect(sumPaise([2n ** 62n, 2n ** 62n])).toBe(2n ** 63n);
  });
});
