import { describe, expect, it } from "vitest";

import { buildReminder, type ReminderTemplates } from "@/server/domain/share/reminder";
import { waMeLink } from "@/server/domain/share/whatsapp";

const en: ReminderTemplates = {
  greeting: "Namaste {customer},",
  due: "This is a reminder from {shop}: {amount} is due.",
  dueOverdue: "This is a reminder from {shop}: {amount} is due, of which {overdue} is overdue.",
  opening: "Earlier balance · {amount}",
  line: "{number} · {amount} · due {dueDate}",
  more: "…and {count} more.",
  thanks: "Thank you!",
};

const base = {
  customer: "Ramesh Traders",
  shop: "Sharma Hardware",
  amount: "₹2,002.00",
  overdue: null,
  opening: null,
  invoices: [],
  more: 0,
};

describe("buildReminder", () => {
  it("lists each invoice with its link on the next line", () => {
    expect(
      buildReminder(en, {
        ...base,
        overdue: "₹502.00",
        opening: "₹1,500.00",
        invoices: [
          {
            number: "SH/26-27/0001",
            amount: "₹502.00",
            dueDate: "01-11-2026",
            link: "https://galla.example/i/abc",
          },
        ],
      }),
    ).toBe(
      [
        "Namaste Ramesh Traders,",
        "This is a reminder from Sharma Hardware: ₹2,002.00 is due, of which ₹502.00 is overdue.",
        "",
        "Earlier balance · ₹1,500.00",
        "SH/26-27/0001 · ₹502.00 · due 01-11-2026",
        "https://galla.example/i/abc",
        "",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("leaves out the link when it is turned off, and counts the rest", () => {
    const text = buildReminder(en, {
      ...base,
      invoices: [{ number: "SH/26-27/0002", amount: "₹10.00", dueDate: "on receipt", link: null }],
      more: 2,
    });
    expect(text).toBe(
      [
        "Namaste Ramesh Traders,",
        "This is a reminder from Sharma Hardware: ₹2,002.00 is due.",
        "",
        "SH/26-27/0002 · ₹10.00 · due on receipt",
        "…and 2 more.",
        "",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("with nothing listed, has no empty section", () => {
    expect(buildReminder(en, base)).toBe(
      [
        "Namaste Ramesh Traders,",
        "This is a reminder from Sharma Hardware: ₹2,002.00 is due.",
        "",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("fills only known placeholders and keeps other braces as typed", () => {
    expect(
      buildReminder({ ...en, greeting: "Hi {customer} {nope}" }, { ...base, customer: "{shop}" }),
    ).toMatch(/^Hi \{shop\} \{nope\}\n/);
  });

  it("survives the wa.me link: Hindi, ₹ and line breaks arrive exactly", () => {
    const text = buildReminder(
      { ...en, greeting: "नमस्ते {customer},", thanks: "धन्यवाद!" },
      { ...base, customer: "रमेश & Sons #1" },
    );
    const link = waMeLink("919876543210", text);
    expect(new URL(link).searchParams.get("text")).toBe(text);
  });
});
