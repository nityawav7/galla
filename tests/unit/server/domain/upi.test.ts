import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isValidUpiVpa, normalizeUpiVpa } from "@/server/domain/upi";

describe("normalizeUpiVpa", () => {
  it("trims and lower-cases (UPI IDs are case-insensitive)", () => {
    expect(normalizeUpiVpa("  RameshHardware@OKSBI ")).toBe("rameshhardware@oksbi");
  });
});

describe("isValidUpiVpa", () => {
  it.each([
    "ramesh@upi",
    "9876543210@paytm",
    "ramesh.hardware@oksbi",
    "shop_42@ybl",
    "a-b@icici",
    "RAMESH@OKAXIS",
    "ab@axl",
  ])("accepts %s", (vpa) => {
    expect(isValidUpiVpa(vpa)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["ramesh", "no handle"],
    ["@upi", "no name"],
    ["a@upi", "name too short"],
    ["ramesh@", "empty handle"],
    ["ramesh@u", "handle too short"],
    ["ramesh@@upi", "two @"],
    ["ram esh@upi", "space"],
    [".ramesh@upi", "starts with a dot"],
    ["ramesh@up-i", "symbol in handle"],
    ["ramesh@1upi", "handle starts with a digit"],
    [`${"a".repeat(257)}@upi`, "name too long"],
  ])("rejects %j (%s)", (vpa) => {
    expect(isValidUpiVpa(vpa)).toBe(false);
  });

  it("is unaffected by surrounding spaces and case", () => {
    fc.assert(
      fc.property(fc.constantFrom("ramesh@upi", "shop.42@oksbi"), fc.boolean(), (vpa, upper) => {
        const variant = `  ${upper ? vpa.toUpperCase() : vpa} `;
        expect(isValidUpiVpa(variant)).toBe(true);
      }),
    );
  });
});
