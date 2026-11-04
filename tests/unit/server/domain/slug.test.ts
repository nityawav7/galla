import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_SLUG_LENGTH, slugify, slugWithSuffix } from "@/server/domain/slug";

// The CHECK constraint on businesses.slug.
const DB_SLUG = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

describe("slugify", () => {
  it.each([
    ["Sharma Hardware", "sharma-hardware"],
    ["  Sharma   & Sons  Hardware ", "sharma-sons-hardware"],
    ["Gupta's Kirana Store", "guptas-kirana-store"],
    ["M/s. R.K. Traders", "m-s-r-k-traders"],
    ["Café Délice", "cafe-delice"],
    ["24x7 Medicals", "24x7-medicals"],
    ["---Shop---", "shop"],
  ])("%j → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("falls back to 'shop' when nothing Latin is left (e.g. a Hindi name)", () => {
    expect(slugify("शर्मा हार्डवेयर")).toBe("shop");
    expect(slugify("")).toBe("shop");
  });

  it("cuts long names at a word boundary within the limit", () => {
    const slug = slugify("The Extremely Long Named General Store And Hardware Suppliers Pvt Ltd");
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH - 5);
    expect(slug).toBe("the-extremely-long-named-general-store-and");
  });

  it("cuts a single word that is longer than the limit", () => {
    expect(slugify("x".repeat(80))).toBe("x".repeat(MAX_SLUG_LENGTH - 5));
  });

  it("always satisfies the database check, leaving room for a suffix", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (name) => {
        const slug = slugify(name);
        expect(slug).toMatch(DB_SLUG);
        expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH - 5);
      }),
    );
  });
});

describe("slugWithSuffix", () => {
  it("appends a lower-case suffix", () => {
    expect(slugWithSuffix("sharma-hardware", "X7K2")).toBe("sharma-hardware-x7k2");
  });

  it("stays valid for any base slug", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.stringMatching(/^[a-z0-9]{4}$/), (name, s) => {
        expect(slugWithSuffix(slugify(name), s)).toMatch(DB_SLUG);
      }),
    );
  });

  it("rejects suffixes that are not 4 letters or digits", () => {
    expect(() => slugWithSuffix("shop", "ab")).toThrow(RangeError);
    expect(() => slugWithSuffix("shop", "a-b!")).toThrow(RangeError);
  });
});
