import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  formatDocumentNumber,
  MAX_DOCUMENT_NUMBER_LENGTH,
  MAX_PREFIX_LENGTH,
  validatePrefix,
  validateSeriesPrefixes,
} from "@/server/domain/numbering";

describe("formatDocumentNumber", () => {
  it.each([
    ["GAL", "26-27", 42, "GAL/26-27/0042"],
    ["INV", "26-27", 1, "INV/26-27/0001"],
    ["CN", "26-27", 7, "CN/26-27/0007"],
    ["SHOP1", "99-00", 9999, "SHOP1/99-00/9999"],
    ["A", "26-27", 123456, "A/26-27/123456"],
    ["inv-2", "26-27", 3, "inv-2/26-27/0003"],
  ])("%s + %s + %i → %s", (prefix, fy, seq, expected) => {
    expect(formatDocumentNumber(prefix, fy, seq)).toBe(expected);
  });

  it("a maximum-length prefix always fits 9999 documents in 16 characters", () => {
    expect(formatDocumentNumber("ABCDE", "26-27", 9999)).toHaveLength(MAX_DOCUMENT_NUMBER_LENGTH);
  });

  it("refuses a number longer than 16 characters", () => {
    expect(() => formatDocumentNumber("ABCDE", "26-27", 10000)).toThrow(ValidationError);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects sequence %d", (seq) => {
    expect(() => formatDocumentNumber("INV", "26-27", seq)).toThrow(RangeError);
  });

  it("rejects a bad FY label", () => {
    expect(() => formatDocumentNumber("INV", "26-28", 1)).toThrow(ValidationError);
  });

  it("only produces Rule 46 characters within 16 characters", () => {
    const prefixArb = fc.stringMatching(/^[A-Za-z0-9-]{1,5}$/);
    fc.assert(
      fc.property(
        prefixArb,
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 1, max: 9999 }),
        (prefix, year, seq) => {
          const fy = `${String(year).padStart(2, "0")}-${String((year + 1) % 100).padStart(2, "0")}`;
          const number = formatDocumentNumber(prefix, fy, seq);
          expect(number).toMatch(/^[A-Za-z0-9/-]{1,16}$/);
          expect(number.split("/")).toEqual([prefix, fy, String(seq).padStart(4, "0")]);
        },
      ),
    );
  });
});

describe("validatePrefix", () => {
  it("trims and accepts letters, digits and hyphens", () => {
    expect(validatePrefix(" GAL ")).toBe("GAL");
    expect(validatePrefix("A-1")).toBe("A-1");
  });

  it.each(["", "  ", "TOOLONG", "A/B", "A B", "₹", "INV_1"])("rejects %j", (prefix) => {
    expect(() => validatePrefix(prefix)).toThrow(ValidationError);
  });

  it(`allows at most ${String(MAX_PREFIX_LENGTH)} characters`, () => {
    expect(validatePrefix("ABCDE")).toBe("ABCDE");
    expect(() => validatePrefix("ABCDEF")).toThrow(ValidationError);
  });
});

describe("validateSeriesPrefixes", () => {
  it("accepts different prefixes", () => {
    expect(() => {
      validateSeriesPrefixes("INV", "CN");
    }).not.toThrow();
  });

  it.each([
    ["INV", "INV"],
    ["inv", "INV"],
    [" CN", "cn "],
  ])("rejects %j and %j as the same series", (invoicePrefix, creditNotePrefix) => {
    expect(() => {
      validateSeriesPrefixes(invoicePrefix, creditNotePrefix);
    }).toThrow(ValidationError);
  });
});
