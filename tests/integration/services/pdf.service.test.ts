import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { updateCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { paymentFor } from "@/server/pdf/invoice-pdf";
import {
  cancelInvoice,
  createCreditNote,
  type CreditNote,
} from "@/server/services/credit-note.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  renderCreditNotePdf,
  renderInvoicePdf,
  type RenderedPdf,
} from "@/server/services/pdf.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

const line = (overrides: Partial<DraftLine> = {}): Partial<DraftLine> => ({
  productId: null,
  description: "PVC pipe",
  hsnSac: "3917",
  unit: "NOS",
  qty: "3",
  unitPrice: "100",
  discount: "",
  rateBp: 1800,
  priceIncludesTax: false,
  ...overrides,
});

function shop(overrides: Parameters<typeof createTenant>[0] = {}): Promise<Tenant> {
  return createTenant({
    tradeName: "Sharma Hardware",
    upiVpa: "shop@oksbi",
    terms: "Goods once sold are not taken back.",
    ...overrides,
  });
}

/** 3 × ₹100 + 18% (intra-state) = ₹354.00. */
async function issued(tenant: Tenant): Promise<Invoice> {
  const draft = await createDraft(tenant.ctx, { lines: [line()] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

async function creditFirstLine(tenant: Tenant, invoice: Invoice, qty: string): Promise<CreditNote> {
  const [first] = (await getInvoice(tenant.ctx, invoice.id)).lines;
  return createCreditNote(tenant.ctx, invoice.id, {
    reason: "Goods returned",
    lines: [{ invoiceLineId: first?.id ?? "", qty }],
  });
}

async function text(pdf: RenderedPdf): Promise<string> {
  expect(Buffer.from(pdf.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const { text: content } = await extractText(await getDocumentProxy(pdf.bytes), {
    mergePages: true,
  });
  return content.replace(/\s+/g, " ");
}

describe("renderInvoicePdf", () => {
  it.each<Role>(["OWNER", "STAFF", "ACCOUNTANT"])(
    "renders an issued invoice for %s",
    async (role) => {
      const tenant = await shop();
      const invoice = await issued(tenant);
      const pdf = await renderInvoicePdf({ ...tenant.ctx, role }, invoice.id, "a4");
      expect(pdf.filename).toBe(`${(invoice.number ?? "").replaceAll("/", "-")}.pdf`);
      const content = await text(pdf);
      for (const value of [
        "Tax Invoice",
        invoice.number ?? "",
        "Sharma Hardware",
        "GSTIN: 27AAPFU0939F1ZV",
        "₹354.00",
        "Rupees Three Hundred Fifty Four Only",
        "Scan with any UPI app to pay ₹354.00",
        "UPI ID: shop@oksbi",
        "Goods once sold are not taken back.",
      ]) {
        expect(content).toContain(value);
      }
    },
  );

  it("names the 80 mm file apart from the A4 one", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const pdf = await renderInvoicePdf(tenant.ctx, invoice.id, "80mm");
    expect(pdf.filename).toMatch(/-80mm\.pdf$/);
    expect(await text(pdf)).toContain(invoice.number ?? "");
  });

  it("reads payment details live but keeps the snapshot's terms and name (decision 4)", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await updateCurrentBusiness(getDb(), tenant.ctx, {
      upiVpa: "newshop@ybl",
      tradeName: "Renamed Shop",
      terms: "New terms",
      bankAccountName: "Sharma Hardware",
      bankAccountNumber: "50100012345678",
      bankIfsc: "HDFC0000123",
      bankName: "HDFC Bank",
    });
    const content = await text(await renderInvoicePdf(tenant.ctx, invoice.id, "a4"));
    expect(content).toContain("UPI ID: newshop@ybl");
    expect(content).toContain("50100012345678");
    expect(content).toContain("Goods once sold are not taken back.");
    expect(content).not.toContain("New terms");
    expect(content).not.toContain("Renamed Shop");
  });

  it("asks only for the balance, and leaves out payment once nothing is due", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await creditFirstLine(tenant, invoice, "1");
    expect(await text(await renderInvoicePdf(tenant.ctx, invoice.id, "a4"))).toContain(
      "to pay ₹236.00",
    );
    await creditFirstLine(tenant, invoice, "2");
    const content = await text(await renderInvoicePdf(tenant.ctx, invoice.id, "a4"));
    expect(content).not.toContain("UPI ID:");
    expect(content).toContain("₹354.00");
  });

  it("stamps a cancelled invoice and offers no payment", async () => {
    const tenant = await shop({ bankAccountNumber: "50100012345678" });
    const invoice = await issued(tenant);
    await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    const content = await text(await renderInvoicePdf(tenant.ctx, invoice.id, "a4"));
    expect(content).toContain("CANCELLED");
    expect(content).not.toContain("UPI ID:");
    expect(content).not.toContain("50100012345678");
  });

  it("has no PDF for a draft or an unknown id", async () => {
    const tenant = await shop();
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    await expect(renderInvoicePdf(tenant.ctx, draft.id, "a4")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(renderInvoicePdf(tenant.ctx, "not-a-uuid", "a4")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses a role without records:view", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await expect(
      renderInvoicePdf({ ...tenant.ctx, role: "NOBODY" as Role }, invoice.id, "a4"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("renderCreditNotePdf", () => {
  it("prints the credit note with its invoice and reason", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const note = await creditFirstLine(tenant, invoice, "1");
    const pdf = await renderCreditNotePdf({ ...tenant.ctx, role: "ACCOUNTANT" }, note.id, "a4");
    expect(pdf.filename).toBe(`${note.number.replaceAll("/", "-")}.pdf`);
    const content = await text(pdf);
    for (const value of [
      "Credit Note",
      note.number,
      `${invoice.number ?? ""} dated`,
      "Goods returned",
      "Total credited",
      "₹118.00",
    ]) {
      expect(content).toContain(value);
    }
    expect(content).not.toContain("UPI ID:");
  });

  it("refuses an unknown credit note", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await expect(renderCreditNotePdf(tenant.ctx, invoice.id, "80mm")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("paymentFor", () => {
  const invoice = {
    status: "ISSUED" as const,
    number: "INV/26-27/0001",
    grandTotalPaise: 35400n,
    amountPaidPaise: 0n,
    amountCreditedPaise: 0n,
  };
  const business = { upiVpa: "shop@oksbi", tradeName: null, legalName: "Test Traders" };

  it("links the balance to the shop's UPI ID", () => {
    expect(paymentFor({ ...invoice, amountPaidPaise: 10000n }, business)).toEqual({
      upiLink: "upi://pay?pa=shop@oksbi&pn=Test%20Traders&am=254.00&cu=INR&tn=INV%2F26-27%2F0001",
      vpa: "shop@oksbi",
      amount: "₹254.00",
    });
  });

  it("is null without a UPI ID, a number, or anything due", () => {
    expect(paymentFor(invoice, { ...business, upiVpa: null })).toBeNull();
    expect(paymentFor({ ...invoice, number: null }, business)).toBeNull();
    expect(paymentFor({ ...invoice, amountPaidPaise: 35400n }, business)).toBeNull();
    expect(paymentFor({ ...invoice, status: "CANCELLED" }, business)).toBeNull();
  });
});

describe("tenant isolation", () => {
  itIsolatesTenants({
    renderInvoicePdf: isolationCase({
      arrange: (owner) => issued(owner),
      act: (intruder, invoice) => renderInvoicePdf(intruder.ctx, invoice.id, "a4"),
    }),
    renderCreditNotePdf: isolationCase({
      arrange: async (owner) => creditFirstLine(owner, await issued(owner), "1"),
      act: (intruder, note) => renderCreditNotePdf(intruder.ctx, note.id, "a4"),
    }),
  });
});
