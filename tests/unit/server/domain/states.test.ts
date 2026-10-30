import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { findState, GST_STATES, getActiveState, isActiveStateCode } from "@/server/domain/states";

describe("GST state table", () => {
  it("has unique two-digit codes", () => {
    const codes = GST_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^\d{2}$/);
  });

  it("covers 01–38 and 97", () => {
    const codes = new Set(GST_STATES.map((state) => state.code));
    for (let n = 1; n <= 38; n++) expect(codes.has(String(n).padStart(2, "0"))).toBe(true);
    expect(codes.has("97")).toBe(true);
  });

  it.each(["04", "26", "31", "35", "38", "97"])(
    "%s is a UT without legislature (UTGST)",
    (code) => {
      expect(findState(code)?.isUtWithoutLegislature).toBe(true);
    },
  );

  it.each(["01", "07", "34", "27", "29", "37"])("%s charges SGST", (code) => {
    expect(findState(code)?.isUtWithoutLegislature).toBe(false);
  });

  it.each(["25", "28"])("legacy code %s is kept but inactive", (code) => {
    expect(findState(code)?.active).toBe(false);
    expect(isActiveStateCode(code)).toBe(false);
  });

  it("finds active states and rejects unknown or inactive codes", () => {
    expect(getActiveState("27").name).toBe("Maharashtra");
    expect(findState("99")).toBeUndefined();
    expect(isActiveStateCode("99")).toBe(false);
    expect(() => getActiveState("99")).toThrow(ValidationError);
    expect(() => getActiveState("28")).toThrow(ValidationError);
  });
});
