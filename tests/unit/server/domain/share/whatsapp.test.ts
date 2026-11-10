import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeIndianPhone } from "@/server/domain/phone";
import {
  MAX_TEMPLATE_LENGTH,
  renderShareTemplate,
  type ShareValues,
  templateProblems,
  waMeLink,
  whatsAppNumber,
} from "@/server/domain/share/whatsapp";

const VALUES: ShareValues = {
  customer: "Ramesh Traders",
  shop: "Sharma Hardware",
  number: "SH/26-27/0001",
  amount: "₹802.00",
  dueDate: "24-11-2026",
  link: "https://galla-mu.vercel.app/i/AbCdEfGhIjKlMnOpQrStUv",
};

describe("whatsAppNumber (SPEC F6: digits with the country code)", () => {
  it.each([
    ["+919876543210", "919876543210"],
    ["+14155550123", "14155550123"],
    ["+971501234567", "971501234567"],
  ])("%s → %s", (e164, digits) => {
    expect(whatsAppNumber(e164)).toBe(digits);
  });

  it.each([null, "", "9876543210", "+0919876543210", "+91 98765 43210", "+91-98765", "+1234567"])(
    "refuses %s",
    (input) => {
      expect(whatsAppNumber(input)).toBeNull();
    },
  );

  it("turns any way an Indian number is typed into 91 + 10 digits", () => {
    for (const typed of ["98765 43210", "098765-43210", "+91 98765 43210", "91 9876543210"]) {
      expect(whatsAppNumber(normalizeIndianPhone(typed))).toBe("919876543210");
    }
  });
});

describe("waMeLink (SPEC F6: correctly URL-encoded)", () => {
  it("encodes newlines, ₹, &, #, + and spaces", () => {
    expect(waMeLink("919876543210", "Bill #12 & co\n₹1+2")).toBe(
      "https://wa.me/919876543210?text=Bill%20%2312%20%26%20co%0A%E2%82%B91%2B2",
    );
  });

  it("leaves the number out for a walk-in, so WhatsApp asks whom to send to", () => {
    expect(waMeLink(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });

  it("round-trips any message exactly through the text parameter", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (text) => {
        const url = new URL(waMeLink("919876543210", text));
        expect(url.hostname).toBe("wa.me");
        expect(url.pathname).toBe("/919876543210");
        expect(url.searchParams.get("text")).toBe(text);
        expect([...url.searchParams.keys()]).toEqual(["text"]);
      }),
    );
  });

  it("keeps Hindi and emoji intact", () => {
    const text = "नमस्ते रमेश जी 🙏\nकुल ₹802.00";
    expect(new URL(waMeLink(null, text)).searchParams.get("text")).toBe(text);
  });
});

describe("renderShareTemplate", () => {
  it("fills every placeholder, as often as it appears", () => {
    expect(
      renderShareTemplate(
        "Namaste {customer},\n{shop}: invoice {number} for {amount}, due {dueDate}.\n{link}\n{number}",
        VALUES,
      ),
    ).toBe(
      "Namaste Ramesh Traders,\nSharma Hardware: invoice SH/26-27/0001 for ₹802.00, due 24-11-2026.\n" +
        "https://galla-mu.vercel.app/i/AbCdEfGhIjKlMnOpQrStUv\nSH/26-27/0001",
    );
  });

  it("leaves anything else in braces as typed, and never evaluates it", () => {
    expect(renderShareTemplate("{name} {} {link} {constructor} ${amount}", VALUES)).toBe(
      `{name} {} ${VALUES.link} {constructor} $₹802.00`,
    );
  });

  it("inserts values literally, even ones that look like placeholders or $ patterns", () => {
    const tricky = { ...VALUES, customer: "{link} $& $1" };
    expect(renderShareTemplate("Hi {customer}", tricky)).toBe("Hi {link} $& $1");
  });
});

describe("templateProblems", () => {
  it("accepts a template with the link and known placeholders", () => {
    expect(templateProblems("Hi {customer}, pay here: {link}")).toEqual([]);
  });

  it.each([
    ["", ["templateRequired"]],
    ["   ", ["templateRequired"]],
    ["Hi {customer}", ["templateNeedsLink"]],
    ["Hi {name}: {link}", ["templateUnknownPlaceholder"]],
    ["Hi {Customer} {}", ["templateUnknownPlaceholder", "templateNeedsLink"]],
    [`{link}${"x".repeat(MAX_TEMPLATE_LENGTH)}`, ["templateTooLong"]],
  ])("%j → %j", (template, problems) => {
    expect(templateProblems(template)).toEqual(problems);
  });
});
