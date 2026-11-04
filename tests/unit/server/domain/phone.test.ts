import { describe, expect, it } from "vitest";

import { formatIndianPhone, normalizeIndianPhone } from "@/server/domain/phone";

describe("normalizeIndianPhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["91 9876543210", "+919876543210"],
    ["(022) 2345 6789", "+912223456789"],
    ["+91-80-4123-4567", "+918041234567"],
  ])("%j → %s", (input, e164) => {
    expect(normalizeIndianPhone(input)).toBe(e164);
  });

  it.each([
    "",
    "12345",
    "0123456789", // leading 0 then only 9 digits
    "1234567890", // Indian numbers never start with 1 after the trunk prefix
    "98765432101",
    "+1 415 555 0100",
    "98765abc10",
  ])("rejects %j", (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it("matches the database's E.164 check", () => {
    expect(normalizeIndianPhone("9876543210")).toMatch(/^[+][1-9][0-9]{7,14}$/);
  });
});

describe("formatIndianPhone", () => {
  it("shows a stored number the way people write it", () => {
    expect(formatIndianPhone("+919876543210")).toBe("+91 98765 43210");
  });

  it("leaves numbers from other countries as stored", () => {
    expect(formatIndianPhone("+14155550100")).toBe("+14155550100");
  });
});
