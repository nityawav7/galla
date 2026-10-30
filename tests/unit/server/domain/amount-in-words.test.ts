import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { amountInWords } from "@/server/domain/amount-in-words";

describe("amountInWords", () => {
  it.each([
    // SPEC §8 cases (rupees)
    [0n, "Rupees Zero Only"],
    [100n, "Rupees One Only"],
    [9900n, "Rupees Ninety Nine Only"],
    [10000000n, "Rupees One Lakh Only"],
    [
      12345678950n,
      "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Fifty Paise Only",
    ],
    // paise
    [1n, "Rupees Zero and One Paisa Only"],
    [99n, "Rupees Zero and Ninety Nine Paise Only"],
    [105n, "Rupees One and Five Paise Only"],
    // teens, tens and hundreds
    [1100n, "Rupees Eleven Only"],
    [1900n, "Rupees Nineteen Only"],
    [2000n, "Rupees Twenty Only"],
    [10100n, "Rupees One Hundred One Only"],
    [11000n, "Rupees One Hundred Ten Only"],
    [100500n, "Rupees One Thousand Five Only"],
    [2000000n, "Rupees Twenty Thousand Only"],
    [100100000n, "Rupees Ten Lakh One Thousand Only"],
    [1000000000n, "Rupees One Crore Only"],
    // crores above 99 keep counting in the Indian system
    [100000000000n, "Rupees One Hundred Crore Only"],
    [1000000000500n, "Rupees One Thousand Crore Five Only"],
    [10000000000500n, "Rupees Ten Thousand Crore Five Only"],
  ])("%i paise → %s", (paise, expected) => {
    expect(amountInWords(paise)).toBe(expected);
  });

  it("rejects negative amounts", () => {
    expect(() => amountInWords(-1n)).toThrow(RangeError);
  });

  it("is always well formed", () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 15n), (paise) => {
        const words = amountInWords(paise);
        expect(words).toMatch(/^Rupees [A-Z][A-Za-z ]* Only$/);
        expect(words).not.toMatch(/ {2}/);
        expect(words.includes(" and ")).toBe(paise % 100n !== 0n);
        if (paise >= 100n) expect(words).not.toContain("Zero");
      }),
    );
  });
});
