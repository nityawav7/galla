import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { cancelInvoice } from "@/server/services/credit-note.service";
import { createDraft, type Invoice, issueInvoice } from "@/server/services/invoice.service";
import {
  getSharedInvoice,
  isLiveInvoiceLink,
  renderSharedInvoicePdf,
} from "@/server/services/public-invoice.service";
import {
  getPublicLink,
  regeneratePublicLink,
  revokePublicLink,
} from "@/server/services/public-link.service";

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

const shop = () => createTenant({ tradeName: "Sharma Hardware", upiVpa: "shop@oksbi" });
const as = (tenant: Tenant, role: Role) => ({ ...tenant.ctx, role });

/** 3 × ₹100 + 18% = ₹354.00, with its public token. */
async function issued(tenant: Tenant, description = "PVC pipe"): Promise<Invoice> {
  const draft = await createDraft(tenant.ctx, { lines: [line({ description })] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

function tokenOf(invoice: Pick<Invoice, "publicToken">): string {
  if (!invoice.publicToken) throw new Error("no token");
  return invoice.publicToken;
}

function tokenIn(url: string | null): string {
  const token = url?.split("/i/")[1];
  if (!token) throw new Error(`no token in ${String(url)}`);
  return token;
}

describe("getSharedInvoice", () => {
  it("shows the invoice, its lines and the UPI payment for the balance", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const shared = await getSharedInvoice(tokenOf(invoice));
    expect(shared.invoice.id).toBe(invoice.id);
    expect(shared.lines.map((row) => row.description)).toEqual(["PVC pipe"]);
    expect(shared.shopName).toBe("Sharma Hardware");
    expect(shared.balancePaise).toBe(35400n);
    expect(shared.status).toBe("ISSUED");
    expect(shared.payment).toMatchObject({ vpa: "shop@oksbi", amount: "₹354.00" });
    expect(shared.payment?.upiLink).toContain("am=354.00");
    expect(await isLiveInvoiceLink(tokenOf(invoice))).toBe(true);
  });

  it("returns only that invoice's lines, even with other businesses' invoices around", async () => {
    const first = await shop();
    const second = await shop();
    const mine = await issued(first, "Mine");
    await issued(second, "Theirs");
    const shared = await getSharedInvoice(tokenOf(mine));
    expect(shared.lines.map((row) => row.description)).toEqual(["Mine"]);
  });

  it("is NotFound for unknown, malformed and empty tokens", async () => {
    for (const token of [
      "AAAAAAAAAAAAAAAAAAAAAA",
      "short",
      "",
      "x".repeat(22) + "/",
      "' or 1=1 --",
    ]) {
      await expect(getSharedInvoice(token)).rejects.toBeInstanceOf(NotFoundError);
      expect(await isLiveInvoiceLink(token)).toBe(false);
    }
  });

  it("shows a cancelled invoice without a way to pay", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    const shared = await getSharedInvoice(tokenOf(invoice));
    expect(shared.status).toBe("CANCELLED");
    expect(shared.payment).toBeNull();
  });

  it("renders the shared invoice as a PDF", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const pdf = await renderSharedInvoicePdf(tokenOf(invoice), "80mm");
    expect(pdf.filename).toMatch(/-80mm\.pdf$/);
    const { text } = await extractText(await getDocumentProxy(pdf.bytes), { mergePages: true });
    expect(text).toContain(invoice.number ?? "");
  });
});

describe("revokePublicLink", () => {
  it("turns the link off: the page and the PDF are NotFound (SPEC F5 AC)", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const token = tokenOf(invoice);
    expect(await revokePublicLink(tenant.ctx, invoice.id)).toEqual({ url: null });
    await expect(getSharedInvoice(token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(renderSharedInvoicePdf(token, "a4")).rejects.toBeInstanceOf(NotFoundError);
    expect(await isLiveInvoiceLink(token)).toBe(false);
    expect(await getPublicLink(tenant.ctx, invoice.id)).toEqual({ url: null });
  });

  it("audits once, without the token, and does nothing the second time", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await revokePublicLink(tenant.ctx, invoice.id);
    await revokePublicLink(tenant.ctx, invoice.id);
    const rows = (await listAuditLogs(getDb(), tenant.ctx, { entityId: invoice.id })).filter(
      (row) => row.action === "invoice.linkRevoked",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.diff).toEqual({ before: { linkOn: true }, after: { linkOn: false } });
    expect(JSON.stringify(rows[0])).not.toContain(tokenOf(invoice));
  });

  it.each<Role>(["STAFF", "ACCOUNTANT"])("refuses %s", async (role) => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await expect(revokePublicLink(as(tenant, role), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await isLiveInvoiceLink(tokenOf(invoice))).toBe(true);
  });
});

describe("regeneratePublicLink", () => {
  it("replaces the token: the old link is NotFound, the new one works", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const old = tokenOf(invoice);
    const { url } = await regeneratePublicLink(tenant.ctx, invoice.id);
    const fresh = tokenIn(url);
    expect(fresh).not.toBe(old);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await expect(getSharedInvoice(old)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getSharedInvoice(fresh)).invoice.id).toBe(invoice.id);
  });

  it("turns a revoked link back on with a new token, and audits it", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await revokePublicLink(tenant.ctx, invoice.id);
    const { url } = await regeneratePublicLink(tenant.ctx, invoice.id);
    expect(tokenIn(url)).not.toBe(tokenOf(invoice));
    const [latest] = await listAuditLogs(getDb(), tenant.ctx, { entityId: invoice.id });
    expect(latest).toMatchObject({
      action: "invoice.linkRegenerated",
      diff: { before: { linkOn: false }, after: { linkOn: true } },
    });
  });

  it("works on a cancelled invoice (the trigger allows only link columns to change)", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    const { url } = await regeneratePublicLink(tenant.ctx, invoice.id);
    const after = await findInvoiceById(getDb(), tenant.ctx, invoice.id);
    expect(after).toMatchObject({ status: "CANCELLED", publicToken: tokenIn(url) });
  });

  it.each<Role>(["STAFF", "ACCOUNTANT"])("refuses %s", async (role) => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await expect(regeneratePublicLink(as(tenant, role), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("getPublicLink", () => {
  it.each<Role>(["OWNER", "STAFF"])("gives %s the link to share", async (role) => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const { url } = await getPublicLink(as(tenant, role), invoice.id);
    expect(url).toMatch(new RegExp(`/i/${tokenOf(invoice)}$`));
  });

  it("refuses ACCOUNTANT", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await expect(getPublicLink(as(tenant, "ACCOUNTANT"), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("has no link for a draft", async () => {
    const tenant = await shop();
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    await expect(getPublicLink(tenant.ctx, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokePublicLink(tenant.ctx, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(regeneratePublicLink(tenant.ctx, draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

async function unchanged(owner: Tenant, invoice: Invoice): Promise<void> {
  const after = await findInvoiceById(getDb(), owner.ctx, invoice.id);
  expect(after?.publicToken).toBe(invoice.publicToken);
  expect(after?.tokenRevokedAt).toBeNull();
  expect(await isLiveInvoiceLink(tokenOf(invoice))).toBe(true);
}

describe("tenant isolation", () => {
  itIsolatesTenants({
    getPublicLink: isolationCase({
      arrange: (owner) => issued(owner),
      act: (intruder, invoice) => getPublicLink(intruder.ctx, invoice.id),
    }),
    revokePublicLink: isolationCase({
      arrange: (owner) => issued(owner),
      act: (intruder, invoice) => revokePublicLink(intruder.ctx, invoice.id),
      verify: unchanged,
    }),
    regeneratePublicLink: isolationCase({
      arrange: (owner) => issued(owner),
      act: (intruder, invoice) => regeneratePublicLink(intruder.ctx, invoice.id),
      verify: unchanged,
    }),
  });
});
