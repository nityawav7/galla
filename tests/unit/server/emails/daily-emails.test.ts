import { describe, expect, it } from "vitest";

import { ownerDigestEmail, type OwnerDigestInput } from "@/server/emails/owner-digest-email";
import { reminderEmail, type ReminderEmailInput } from "@/server/emails/reminder-email";

const reminder = (overrides: Partial<ReminderEmailInput> = {}): ReminderEmailInput => ({
  locale: "en",
  to: "ramesh@example.com",
  replyTo: "shop@example.com",
  customer: "Ramesh Traders",
  shop: "Sharma Hardware",
  shopPhone: "+91 98765 43210",
  invoices: [
    { number: "SH/26-27/0001", amount: "₹354.00", daysOverdue: 0, link: "https://g.test/i/a" },
    { number: "SH/26-27/0002", amount: "₹708.00", daysOverdue: 7, link: null },
  ],
  total: "₹1,062.00",
  ...overrides,
});

describe("reminderEmail", () => {
  it("lists every invoice with its status and link, the total and the shop", () => {
    const email = reminderEmail(reminder());
    expect(email.subject).toBe("Payment reminder from Sharma Hardware");
    expect(email.replyTo).toBe("shop@example.com");
    expect(email.text).toContain("SH/26-27/0001 · ₹354.00 · due today");
    expect(email.text).toContain("View or pay by UPI: https://g.test/i/a");
    expect(email.text).toContain("SH/26-27/0002 · ₹708.00 · 7 days overdue");
    expect(email.text).toContain("Total: ₹1,062.00");
    expect(email.text).toContain("Phone: +91 98765 43210");
    expect(email.text).toContain("Reply to this email");
    expect(email.html).toContain('href="https://g.test/i/a"');
    expect(email.text).not.toContain("ramesh@example.com");
  });

  it("says 1 day, has no Reply-To or phone when the shop has none, and escapes names", () => {
    const email = reminderEmail(
      reminder({
        replyTo: null,
        shopPhone: null,
        customer: "<b>Ramesh</b>",
        invoices: [{ number: "A/1", amount: "₹1.00", daysOverdue: 1, link: null }],
      }),
    );
    expect(email.text).toContain("A/1 · ₹1.00 · 1 day overdue");
    expect(email).not.toHaveProperty("replyTo");
    expect(email.text).not.toContain("Phone:");
    expect(email.text).toContain("Already paid? Please ignore this email.");
    expect(email.html).not.toContain("<b>Ramesh</b>");
    expect(email.html).toContain("&#60;b&#62;Ramesh");
  });

  it("is written in Hindi for a Hindi business", () => {
    const email = reminderEmail(reminder({ locale: "hi" }));
    expect(email.subject).toBe("Sharma Hardware से भुगतान रिमाइंडर");
    expect(email.text).toContain("SH/26-27/0002 · ₹708.00 · 7 दिन से बकाया");
    expect(email.text).toContain("आज देय");
  });
});

const digest = (overrides: Partial<OwnerDigestInput> = {}): OwnerDigestInput => ({
  locale: "en",
  to: "owner@example.com",
  shop: "Sharma Hardware",
  total: "₹1,062.00",
  count: 3,
  customers: [
    {
      name: "Ramesh Traders",
      amount: "₹708.00",
      url: "https://g.test/b/sh/customers/1",
      whatsapp: "https://wa.me/919876543210?text=Hi",
    },
    {
      name: "Asha <Stores>",
      amount: "₹354.00",
      url: "https://g.test/b/sh/customers/2",
      whatsapp: null,
    },
  ],
  dashboardUrl: "https://g.test/b/sh/dashboard",
  ...overrides,
});

describe("ownerDigestEmail", () => {
  it("has the total, the biggest customers with WhatsApp links, the rest counted, and the dashboard", () => {
    const email = ownerDigestEmail(digest());
    expect(email.subject).toBe("₹1,062.00 overdue from 3 customers · Sharma Hardware");
    expect(email.text).toContain("Ramesh Traders · ₹708.00");
    expect(email.text).toContain("Remind on WhatsApp: https://wa.me/919876543210?text=Hi");
    expect(email.text).toContain("…and 1 more customer.");
    expect(email.text).toContain("Open the dashboard: https://g.test/b/sh/dashboard");
    expect(email.html).toContain("Asha &#60;Stores&#62;");
    expect(email.html).toContain('href="https://g.test/b/sh/customers/1"');
    expect(email).not.toHaveProperty("replyTo");
  });

  it("says 1 customer and lists nobody extra when all are shown, in English and Hindi", () => {
    const one = digest({ count: 1, customers: digest().customers.slice(0, 1) });
    expect(ownerDigestEmail(one).subject).toBe(
      "₹1,062.00 overdue from 1 customer · Sharma Hardware",
    );
    expect(ownerDigestEmail(one).text).not.toContain("more");
    expect(ownerDigestEmail({ ...one, locale: "hi" }).subject).toBe(
      "1 ग्राहक से ₹1,062.00 बकाया · Sharma Hardware",
    );
  });
});
