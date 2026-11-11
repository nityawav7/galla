import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { createDraft, type Invoice, issueInvoice } from "@/server/services/invoice.service";
import { getCustomerLedger } from "@/server/services/ledger.service";
import { recordPayment } from "@/server/services/payment.service";
import { type RenderedPdf, renderStatementPdf } from "@/server/services/pdf.service";
import { refundCredit } from "@/server/services/refund.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

function onDay(date: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:00:00Z`));
}

function shop(overrides: Parameters<typeof createTenant>[0] = {}): Promise<Tenant> {
  return createTenant({ tradeName: "Sharma Hardware", upiVpa: "shop@oksbi", ...overrides });
}

function addCustomer(tenant: Tenant, name = "Mehta Traders", openingBalancePaise = 50_000n) {
  return insertCustomer(getDb(), tenant.ctx, {
    name,
    openingBalancePaise,
    creditDays: 0,
    gstin: "29AABCU9603R1ZM",
    billingAddressLine1: "12 MG Road",
    billingCity: "Bengaluru",
    billingStateCode: "29",
  });
}

function line(rupees: string): Partial<DraftLine> {
  return {
    productId: null,
    description: "Goods",
    hsnSac: "3917",
    unit: "NOS",
    qty: "1",
    unitPrice: rupees,
    discount: "",
    rateBp: 0,
    priceIncludesTax: false,
  };
}

async function invoiceFor(
  tenant: Tenant,
  customer: Customer,
  rupees: string,
  date: string,
): Promise<Invoice> {
  onDay(date);
  const draft = await createDraft(tenant.ctx, { customerId: customer.id, lines: [line(rupees)] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

async function payCash(tenant: Tenant, customer: Customer, amount: string, date: string) {
  onDay(date);
  await recordPayment(tenant.ctx, {
    customerId: customer.id,
    amount,
    paymentDate: date,
    mode: "UPI",
    reference: "UTR998877",
    allocation: { kind: "AUTO" },
  });
}

async function text(pdf: RenderedPdf): Promise<string> {
  expect(Buffer.from(pdf.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const { text: content } = await extractText(await getDocumentProxy(pdf.bytes), {
    mergePages: true,
  });
  return content.replace(/\s+/g, " ");
}

describe("renderStatementPdf", () => {
  it("prints every row with a running balance, the aging and a UPI QR for the balance", async () => {
    const tenant = await shop();
    // The opening balance is dated the day the customer was added, moved back before the
    // earliest entry when needed, so it is always the first row.
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "1000", "2026-03-25");
    await payCash(tenant, customer, "300", "2026-04-10");
    await invoiceFor(tenant, customer, "200", "2026-11-05");
    onDay("2026-11-11");

    const pdf = await renderStatementPdf(tenant.ctx, customer.id, { period: "all" });
    expect(pdf.filename).toBe(`statement-${customer.id.slice(-12)}-2026-11-11.pdf`);
    expect(pdf.filename).not.toContain("Mehta");
    const content = await text(pdf);
    for (const value of [
      "Sharma Hardware",
      "Statement of Account",
      "Mehta Traders",
      "12 MG Road",
      "GSTIN: 29AABCU9603R1ZM",
      "Up to 11-11-2026",
      "Opening balance",
      `Invoice ${invoice.number ?? ""}`,
      "Payment received · UPI · UTR998877",
      "₹1,400.00 Dr",
      "Closing balance",
      "0–30 days",
      "Over 90 days",
      "Scan with any UPI app to pay ₹1,400.00",
      "UPI ID: shop@oksbi",
    ]) {
      expect(content).toContain(value);
    }
    expect(content).not.toContain("Balance brought forward");
  });

  it("this FY brings the earlier balance forward; the totals match the ledger", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant);
    await invoiceFor(tenant, customer, "1000", "2026-03-25");
    await payCash(tenant, customer, "300", "2026-04-10");
    onDay("2026-11-11");

    const view = await getCustomerLedger(tenant.ctx, customer.id, { period: "fy" });
    expect(view.from).toBe("2026-04-01");
    expect(view.ledger.broughtForwardPaise).toBe(150_000n);
    expect(view.ledger.closingPaise).toBe(120_000n);

    const content = await text(await renderStatementPdf(tenant.ctx, customer.id, { period: "fy" }));
    expect(content).toContain("01-04-2026 to 11-11-2026");
    expect(content).toContain("Balance brought forward");
    expect(content).toContain("₹1,500.00 Dr");
    expect(content).toContain("₹1,200.00 Dr");
  });

  it("an advance prints as Cr with no payment QR; Hindi names print", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant, "रमेश ट्रेडर्स", -19_800n);
    onDay("2026-11-11");
    await refundCredit(tenant.ctx, customer.id, {
      amount: "100",
      refundDate: "2026-11-11",
      mode: "CASH",
    });
    const content = await text(
      await renderStatementPdf(tenant.ctx, customer.id, { period: "all" }),
    );
    expect(content).toContain("₹98.00 Cr");
    expect(content).toContain("Refund paid · Cash");
    expect(content).toContain("रमेश");
    expect(content).not.toContain("UPI ID:");
    // Nothing before this FY: no "brought forward ₹0.00" row.
    const thisFy = await text(await renderStatementPdf(tenant.ctx, customer.id, { period: "fy" }));
    expect(thisFy).not.toContain("Balance brought forward");
  });

  it("refuses bad input and roles without records:view", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant);
    await expect(
      renderStatementPdf({ ...tenant.ctx, role: "NOBODY" as Role }, customer.id, { period: "all" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(renderStatementPdf(tenant.ctx, "not-an-id", { period: "all" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("renderStatementPdf tenant isolation", () => {
  itIsolatesTenants({
    renderStatementPdf: isolationCase({
      arrange: (owner) => addCustomer(owner),
      act: (intruder, customer) => renderStatementPdf(intruder.ctx, customer.id, {}),
    }),
  });
});
