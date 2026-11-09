import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildUpiPayLink, isValidUpiVpa, normalizeUpiVpa, upiAmount } from "@/server/domain/upi";

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

describe("upiAmount", () => {
  it.each([
    [1n, "0.01"],
    [50n, "0.50"],
    [100n, "1.00"],
    [80200n, "802.00"],
    [12345678901n, "123456789.01"],
  ])("%s paise → %s", (paise, expected) => {
    expect(upiAmount(paise)).toBe(expected);
  });

  it("refuses zero and negative amounts", () => {
    expect(() => upiAmount(0n)).toThrow(RangeError);
    expect(() => upiAmount(-5n)).toThrow(RangeError);
  });

  it("round-trips any positive amount exactly (no floats)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 15n }), (paise) => {
        const [whole = "", fraction = ""] = upiAmount(paise).split(".");
        expect(BigInt(whole) * 100n + BigInt(fraction)).toBe(paise);
        expect(fraction).toHaveLength(2);
      }),
    );
  });
});

describe("buildUpiPayLink", () => {
  const payment = {
    vpa: "shop@oksbi",
    payeeName: "Sharma Hardware",
    amountPaise: 80200n,
    note: "SH/26-27/0001",
  };

  it("builds the SPEC F5 link with the parameters in order", () => {
    expect(buildUpiPayLink(payment)).toBe(
      "upi://pay?pa=shop@oksbi&pn=Sharma%20Hardware&am=802.00&cu=INR&tn=SH%2F26-27%2F0001",
    );
  });

  it("normalises the UPI ID and keeps the @ literal", () => {
    expect(buildUpiPayLink({ ...payment, vpa: " Shop@OKSBI " })).toContain("pa=shop@oksbi&");
  });

  it("encodes characters that would break the query: & = # + and Hindi", () => {
    const link = buildUpiPayLink({ ...payment, payeeName: "A&B = #1 + श्री", note: "x?y" });
    const query = new URLSearchParams(link.slice("upi://pay?".length));
    expect(query.get("pn")).toBe("A&B = #1 + श्री");
    expect(query.get("tn")).toBe("x?y");
    expect([...query.keys()]).toEqual(["pa", "pn", "am", "cu", "tn"]);
  });

  it("collapses whitespace and keeps at most 50 characters of the name and note", () => {
    const link = buildUpiPayLink({ ...payment, payeeName: `  ${"क".repeat(60)}  `, note: "a  b" });
    const query = new URLSearchParams(link.slice("upi://pay?".length));
    expect(query.get("pn")).toBe("क".repeat(50));
    expect(query.get("tn")).toBe("a b");
  });

  it("never cuts a Hindi letter from its vowel sign", () => {
    const link = buildUpiPayLink({ ...payment, payeeName: "की".repeat(60) });
    const query = new URLSearchParams(link.slice("upi://pay?".length));
    expect(query.get("pn")).toBe("की".repeat(50));
  });

  it("refuses an invalid UPI ID or a zero amount", () => {
    expect(() => buildUpiPayLink({ ...payment, vpa: "not-a-vpa" })).toThrow(RangeError);
    expect(() => buildUpiPayLink({ ...payment, amountPaise: 0n })).toThrow(RangeError);
  });
});
