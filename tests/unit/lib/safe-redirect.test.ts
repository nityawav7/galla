import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/invite/0192abcd", "/invite/0192abcd"],
    ["/b/sharma-hardware/settings?tab=gst", "/b/sharma-hardware/settings?tab=gst"],
    ["/b", "/b"],
  ])("keeps %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "b",
    "https://evil.example/login",
    "//evil.example",
    String.raw`/\evil.example`,
    String.raw`\\evil.example`,
    "javascript:alert(1)",
    // Browsers drop tabs in URLs, which would turn this into //evil.example.
    "/\t/evil.example",
  ])("falls back to /b for %j", (next) => {
    expect(safeNextPath(next)).toBe("/b");
  });
});
