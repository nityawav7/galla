import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/** Flattens nested messages to { "auth.login.title": "Sign in", … }. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value !== "object" || value === null) return { [prefix]: String(value) };
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, inner]) =>
      Object.entries(flatten(inner, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("messages", () => {
  const english = flatten(en);
  const hindi = flatten(hi);

  it("has the same keys in Hindi and English", () => {
    expect(Object.keys(hindi).sort()).toEqual(Object.keys(english).sort());
  });

  it("uses the same placeholders in both languages", () => {
    for (const [key, text] of Object.entries(english)) {
      expect(placeholders(hindi[key] ?? ""), key).toEqual(placeholders(text));
    }
  });
});
