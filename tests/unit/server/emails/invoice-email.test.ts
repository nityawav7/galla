import { describe, expect, it } from "vitest";

import { invoiceEmail, type InvoiceEmailInput } from "@/server/emails/invoice-email";
import {
  canSendEmail,
  clearTestOutbox,
  readTestOutbox,
  sendEmail,
} from "@/server/notifications/email";

const input = (overrides: Partial<InvoiceEmailInput> = {}): InvoiceEmailInput => ({
  locale: "en",
  to: "ramesh@example.com",
  replyTo: "shop@example.com",
  customer: "Ramesh Traders",
  shop: "Sharma Hardware",
  shopPhone: "+91 98765 43210",
  shopGstin: "27AAPFU0939F1ZV",
  number: "SH/26-27/0001",
  amount: "₹1,180.00",
  paid: false,
  dueDate: "24-11-2026",
  link: "https://galla.test/i/abc",
  ...overrides,
});

describe("invoiceEmail", () => {
  it("has the subject, amount, due date, link and the shop's details (decision 3)", () => {
    const email = invoiceEmail(input());
    expect(email.to).toBe("ramesh@example.com");
    expect(email.replyTo).toBe("shop@example.com");
    expect(email.subject).toBe("Invoice SH/26-27/0001 from Sharma Hardware");
    for (const part of [
      "Namaste Ramesh Traders,",
      "Amount due: ₹1,180.00",
      "Due: 24-11-2026",
      "View, download or pay by UPI: https://galla.test/i/abc",
      "Phone: +91 98765 43210",
      "GSTIN: 27AAPFU0939F1ZV",
      "Reply to this email",
    ]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).toContain('href="https://galla.test/i/abc"');
    expect(email.html).toContain("₹1,180.00");
    expect(email.html).toContain("24-11-2026");
  });

  it("is written in Hindi for a Hindi business", () => {
    const email = invoiceEmail(input({ locale: "hi", dueDate: null }));
    expect(email.subject).toBe("Sharma Hardware से बिल SH/26-27/0001");
    expect(email.text).toContain("नमस्ते Ramesh Traders,");
    expect(email.text).toContain("बकाया राशि: ₹1,180.00");
    expect(email.text).toContain("देय तिथि: तुरंत");
    expect(email.html).toContain('<html lang="hi">');
  });

  it("shows the total and a thank-you once paid, and is due on receipt without a date", () => {
    const paid = invoiceEmail(input({ paid: true }));
    expect(paid.text).toContain("Invoice total: ₹1,180.00");
    expect(paid.text).toContain("fully paid");
    expect(paid.text).not.toContain("Amount due");
    const onReceipt = invoiceEmail(input({ dueDate: null }));
    expect(onReceipt.text).toContain("Due: On receipt");
  });

  it("leaves out Reply-To, phone and GSTIN when the shop has none", () => {
    const email = invoiceEmail(input({ replyTo: null, shopPhone: null, shopGstin: null }));
    expect(email).not.toHaveProperty("replyTo");
    expect(email.text).not.toContain("Phone:");
    expect(email.text).not.toContain("GSTIN:");
    expect(email.text).not.toContain("Reply to this email");
  });

  it("escapes names typed by users in the HTML", () => {
    const email = invoiceEmail(
      input({ customer: "<script>alert(1)</script>", shop: `Tom & "Jerry" <b>` }),
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&#60;script&#62;alert(1)&#60;/script&#62;");
    expect(email.html).toContain("Tom &#38; &#34;Jerry&#34; &#60;b&#62;");
    // The plain-text part is text: nothing to escape.
    expect(email.text).toContain("Namaste <script>alert(1)</script>,");
  });

  it("keeps the customer's address out of the body", () => {
    const email = invoiceEmail(input());
    expect(email.text).not.toContain("ramesh@example.com");
    expect(email.html).not.toContain("ramesh@example.com");
  });
});

describe("sendEmail", () => {
  it("refuses a demo business's email and keeps others (SPEC F12)", async () => {
    clearTestOutbox();
    const email = invoiceEmail(input());
    await expect(sendEmail(email, { isDemo: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readTestOutbox()).toEqual([]);
    await sendEmail(email, { isDemo: false });
    await sendEmail(email, "app");
    expect(readTestOutbox()).toHaveLength(2);
  });

  it("can send off Vercel (tests, local dev); on Vercel only with RESEND_API_KEY", () => {
    expect(canSendEmail()).toBe(true);
  });
});
