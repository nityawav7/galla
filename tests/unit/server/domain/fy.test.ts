import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  addDays,
  daysBetween,
  formatIndianDate,
  fyForDate,
  fyForInstant,
  fyRange,
  istDateFromInstant,
  isValidIsoDate,
  parseFy,
} from "@/server/domain/fy";

describe("istDateFromInstant", () => {
  it.each([
    ["2026-03-31T18:29:59.999Z", "2026-03-31"], // 23:59:59.999 IST
    ["2026-03-31T18:30:00.000Z", "2026-04-01"], // 00:00 IST
    ["2026-12-31T18:30:00.000Z", "2027-01-01"],
    ["2026-06-15T00:00:00.000Z", "2026-06-15"],
    ["2026-06-14T19:00:00.000Z", "2026-06-15"],
  ])("%s is %s in India", (instant, expected) => {
    expect(istDateFromInstant(new Date(instant))).toBe(expected);
  });

  it("rejects an invalid Date", () => {
    expect(() => istDateFromInstant(new Date("nope"))).toThrow(RangeError);
  });
});

describe("fyForDate", () => {
  it.each([
    ["2026-03-31", "25-26"],
    ["2026-04-01", "26-27"],
    ["2027-03-31", "26-27"],
    ["2027-04-01", "27-28"],
    ["2026-01-15", "25-26"],
    ["2000-04-01", "00-01"],
    ["2099-12-31", "99-00"],
    ["2100-03-31", "99-00"],
  ])("%s falls in FY %s", (date, fy) => {
    expect(fyForDate(date)).toBe(fy);
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-4-1",
    "26-04-01",
    "",
    // Two-digit FY labels are only unambiguous for FY 2000-01 to 2099-00.
    "2000-03-31",
    "2100-04-01",
  ])("rejects %j", (date) => {
    expect(() => fyForDate(date)).toThrow(ValidationError);
  });
});

describe("fyForInstant", () => {
  it("uses the India date at the 31 March / 1 April boundary", () => {
    expect(fyForInstant(new Date("2026-03-31T18:29:59.999Z"))).toBe("25-26");
    expect(fyForInstant(new Date("2026-03-31T18:30:00.000Z"))).toBe("26-27");
  });
});

describe("fyRange", () => {
  it("returns 1 April to 31 March", () => {
    expect(fyRange("26-27")).toEqual({ startDate: "2026-04-01", endDate: "2027-03-31" });
    expect(fyRange("99-00")).toEqual({ startDate: "2099-04-01", endDate: "2100-03-31" });
  });

  it("contains exactly the dates that map back to it", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2017-07-01"), max: new Date("2099-03-31"), noInvalidDate: true }),
        (instant) => {
          const date = istDateFromInstant(instant);
          const { startDate, endDate } = fyRange(fyForDate(date));
          expect(startDate <= date && date <= endDate).toBe(true);
        },
      ),
    );
  });
});

describe("parseFy", () => {
  it("accepts consecutive years", () => {
    expect(parseFy("26-27")).toBe("26-27");
    expect(parseFy("99-00")).toBe("99-00");
  });

  it.each(["26-28", "2026-27", "26/27", "", "ab-cd"])("rejects %j", (fy) => {
    expect(() => parseFy(fy)).toThrow(ValidationError);
  });
});

describe("isValidIsoDate", () => {
  it("knows leap years", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2100-02-29")).toBe(false);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-03-30", 3, "2026-04-02"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-06-15", 0, "2026-06-15"],
    ["2026-06-15", 365, "2027-06-15"],
  ])("%s + %i days is %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it.each([
    ["2026-02-30", 1],
    ["nope", 1],
    ["2026-06-15", 1.5],
  ])("rejects %s + %s", (date, days) => {
    expect(() => addDays(date, days)).toThrow(ValidationError);
  });
});

describe("daysBetween", () => {
  it.each([
    ["2026-11-10", "2026-11-10", 0],
    ["2026-11-10", "2026-11-11", 1],
    ["2026-11-11", "2026-11-10", -1],
    ["2028-02-28", "2028-03-01", 2],
    ["2026-03-31", "2026-04-01", 1],
    ["2026-01-01", "2027-01-01", 365],
  ])("from %s to %s is %i days", (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });

  it("is the inverse of addDays", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2000, max: 2000 }), (days) => {
        expect(daysBetween("2026-06-15", addDays("2026-06-15", days))).toBe(days);
      }),
    );
  });

  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-03-01", "nope"],
  ])("rejects %s to %s", (from, to) => {
    expect(() => daysBetween(from, to)).toThrow(ValidationError);
  });
});

describe("formatIndianDate", () => {
  it("shows DD-MM-YYYY and leaves anything else as it is", () => {
    expect(formatIndianDate("2026-04-01")).toBe("01-04-2026");
    expect(formatIndianDate("nope")).toBe("nope");
  });
});
