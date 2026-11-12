import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_FIELDS } from "@/server/domain/audit/describe";

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

describe("activity page messages", () => {
  const english = flatten(en);
  const hindi = flatten(hi);

  it("has words for every audit action, field and category", () => {
    const keys = [
      ...AUDIT_ACTIONS.map((action) => `audit.actions.${action}`),
      ...AUDIT_FIELDS.map((field) => `audit.fields.${field}`),
      ...AUDIT_CATEGORIES.flatMap((category) => [
        `audit.categories.${category}`,
        `audit.fallback.${category}`,
      ]),
    ];
    for (const key of keys) {
      expect(english[key], key).toBeTruthy();
      expect(hindi[key], key).toBeTruthy();
    }
  });
});
