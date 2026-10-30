import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  gstinCheckCharacter,
  gstinMatchesState,
  isValidGstin,
  normalizeGstin,
  panFromGstin,
  parseGstin,
  stateFromGstin,
  validateGstin,
} from "@/server/domain/gstin";

// Publicly listed GSTINs whose check characters were confirmed independently.
const KNOWN_VALID = [
  "27AAPFU0939F1ZV", // sample used in GST portal documentation
  "29AAACI1681G1ZL",
  "27AAACR5055K1Z7",
  "29AAGCB7383J1Z4",
  "24AAACC1206D1ZM",
];

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("validateGstin", () => {
  it.each(KNOWN_VALID)("accepts %s", (gstin) => {
    expect(validateGstin(gstin)).toEqual({
      ok: true,
      gstin,
      stateCode: gstin.slice(0, 2),
      pan: gstin.slice(2, 12),
    });
  });

  it("normalises case and surrounding spaces", () => {
    expect(normalizeGstin(" 27aapfu0939f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true);
  });

  it.each([
    ["", "FORMAT"],
    ["27AAPFU0939F1Z", "FORMAT"], // 14 chars
    ["27AAPFU0939F1ZVX", "FORMAT"], // 16 chars
    ["2XAAPFU0939F1ZV", "FORMAT"], // state not digits
    ["271APFU0939F1ZV", "FORMAT"], // PAN letters
    ["27AAPFUA939F1ZV", "FORMAT"], // PAN digits
    ["27AAPFU093911ZV", "FORMAT"], // PAN last char
    ["27AAPFU0939F0ZV", "FORMAT"], // entity number 0
    ["27AAPFU0939F1YV", "FORMAT"], // 14th char must be Z in v1
    ["27AAPFU0939F1Z-", "FORMAT"],
    ["99AAPFU0939F1ZV", "STATE"], // unknown state code
    ["28AAPFU0939F1ZV", "STATE"], // inactive legacy code
    ["27AAPFU0939F1ZW", "CHECKSUM"],
  ])("rejects %j (%s)", (input, reason) => {
    expect(validateGstin(input)).toEqual({ ok: false, reason });
    expect(isValidGstin(input)).toBe(false);
  });

  it("catches every single-character change to a valid GSTIN", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KNOWN_VALID),
        fc.nat({ max: 14 }),
        fc.constantFrom(...CHARSET.split("")),
        (gstin, index, replacement) => {
          fc.pre(gstin[index] !== replacement);
          const mutated = gstin.slice(0, index) + replacement + gstin.slice(index + 1);
          expect(isValidGstin(mutated)).toBe(false);
        },
      ),
    );
  });

  it("detects adjacent transpositions in the body", () => {
    for (const gstin of KNOWN_VALID) {
      for (let i = 0; i < 13; i++) {
        const a = gstin.charAt(i);
        const b = gstin.charAt(i + 1);
        if (a === b) continue;
        const swapped = gstin.slice(0, i) + b + a + gstin.slice(i + 2);
        expect(isValidGstin(swapped), swapped).toBe(false);
      }
    }
  });
});

describe("gstinCheckCharacter", () => {
  it("computes the check character from the first 14 characters", () => {
    for (const gstin of KNOWN_VALID) {
      expect(gstinCheckCharacter(gstin.slice(0, 14))).toBe(gstin[14]);
    }
  });

  it("rejects input that is not 14 GSTIN characters", () => {
    expect(() => gstinCheckCharacter("27AAPFU0939F1")).toThrow(RangeError);
    expect(() => gstinCheckCharacter("27aapfu0939f1z")).toThrow(RangeError);
  });
});

describe("parseGstin", () => {
  it("returns the normalised GSTIN", () => {
    expect(parseGstin("27aapfu0939f1zv")).toBe("27AAPFU0939F1ZV");
  });

  it.each([
    ["27AAPFU0939F1Z", "GSTIN must be 15 characters in the format 22AAAAA0000A1Z5"],
    ["99AAPFU0939F1ZV", "GSTIN starts with an unknown state code"],
    ["27AAPFU0939F1ZW", "GSTIN check digit does not match. Check for typos"],
  ])("explains why %j is invalid", (input, message) => {
    expect(() => parseGstin(input)).toThrow(message);
  });

  it("points at the gstin field", () => {
    try {
      parseGstin("bad");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.path).toBe("gstin");
    }
  });
});

describe("stateFromGstin / panFromGstin / gstinMatchesState", () => {
  it("extracts state code and PAN", () => {
    expect(stateFromGstin("27AAPFU0939F1ZV")).toBe("27");
    expect(panFromGstin("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
  });

  it("throws for invalid GSTINs", () => {
    expect(() => stateFromGstin("27AAPFU0939F1ZW")).toThrow(ValidationError);
    expect(() => panFromGstin("nope")).toThrow(ValidationError);
  });

  it("compares the GSTIN state with a chosen state", () => {
    expect(gstinMatchesState("27AAPFU0939F1ZV", "27")).toBe(true);
    expect(gstinMatchesState("27AAPFU0939F1ZV", "29")).toBe(false);
  });
});
