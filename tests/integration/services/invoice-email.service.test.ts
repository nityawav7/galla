import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, RateLimitError } from "@/lib/errors";
import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { now } from "@/server/clock";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { updateCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { istDateFromInstant } from "@/server/domain/fy";
import { DemoEmailError, clearTestOutbox, readTestOutbox } from "@/server/notifications/email";
import { cancelInvoice } from "@/server/services/credit-note.service";
import { createCustomer, updateCustomer } from "@/server/services/customer.service";
import { canEmailInvoice, emailInvoice } from "@/server/services/invoice-email.service";
import { createDraft, type Invoice, issueInvoice } from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";
import { revokePublicLink } from "@/server/services/public-link.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  clearTestOutbox();
});

const line = (): Partial<DraftLine> => ({
  productId: null,
  description: "PVC pipe",
  hsnSac: "3917",
  unit: "NOS",
  qty: "3",
  unitPrice: "100",
  discount: "",
  rateBp: 1800,
  priceIncludesTax: false,
});

const as = (tenant: Tenant, role: Role) => ({ ...tenant.ctx, role });

interface Sale {
  invoice: Invoice;
  customerId: string | null;
}

/** ₹354.00 to a customer (with or without an email), or to a walk-in. */
async function sale(tenant: Tenant, email: string | null = "ramesh@example.com"): Promise<Sale> {
  const customer = await createCustomer(tenant.ctx, {
    ...EMPTY_CUSTOMER_FORM,
    name: "Ramesh Traders",
    phone: "98765 43210",
    email: email ?? "",
    creditDays: "15",
    confirmDuplicatePhone: true,
  });
  if (customer.status !== "saved") throw new Error("customer not saved");
  const draft = await createDraft(tenant.ctx, {
    customerId: customer.customer.id,
    lines: [line()],
  });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return { invoice: result.invoice, customerId: customer.customer.id };
}

async function walkIn(tenant: Tenant): Promise<Invoice> {
  const draft = await createDraft(tenant.ctx, { customerId: null, lines: [line()] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

const shop = (overrides: Parameters<typeof createTenant>[0] = {}) =>
  createTenant({ tradeName: "Sharma Hardware", email: "shop@example.com", ...overrides });

describe("emailInvoice", () => {
  it("emails the link to the customer, replies to the shop, and audits without the address", async () => {
    const tenant = await shop();
    const { invoice } = await sale(tenant);
    expect(await canEmailInvoice(tenant.ctx, invoice.id)).toBe(true);
    await emailInvoice(tenant.ctx, invoice.id);

    const [email] = readTestOutbox();
    expect(readTestOutbox()).toHaveLength(1);
    expect(email?.to).toBe("ramesh@example.com");
    expect(email?.replyTo).toBe("shop@example.com");
    expect(email?.subject).toBe(`Invoice ${invoice.number ?? ""} from Sharma Hardware`);
    expect(email?.text).toContain("Amount due: ₹354.00");
    expect(email?.text).toMatch(/\/i\/[A-Za-z0-9_-]+/);

    const [audit] = await listAuditLogs(getDb(), tenant.ctx, { entityId: invoice.id });
    expect(audit?.action).toBe("invoice.emailed");
    expect(audit?.diff).toEqual({ after: { balancePaise: "35400", locale: "en" } });
    expect(JSON.stringify(audit)).not.toContain("example.com");
  });

  it("writes in the business's language and shows the total once paid", async () => {
    const tenant = await shop({ locale: "hi", email: null });
    const { invoice, customerId } = await sale(tenant);
    await recordPayment(tenant.ctx, {
      customerId,
      amount: "354",
      paymentDate: istDateFromInstant(now()),
      mode: "CASH",
      allocation: { kind: "AUTO" },
    });
    await emailInvoice(tenant.ctx, invoice.id);
    const [email] = readTestOutbox();
    expect(email?.subject).toContain("से बिल");
    expect(email?.text).toContain("बिल की कुल राशि: ₹354.00");
    expect(email).not.toHaveProperty("replyTo");
  });

  it("uses the customer's email added after the sale", async () => {
    const tenant = await shop();
    const { invoice, customerId } = await sale(tenant, null);
    expect(await canEmailInvoice(tenant.ctx, invoice.id)).toBe(false);
    await expect(emailInvoice(tenant.ctx, invoice.id)).rejects.toBeInstanceOf(ConflictError);
    await updateCustomer(tenant.ctx, customerId ?? "", {
      ...EMPTY_CUSTOMER_FORM,
      name: "Ramesh Traders",
      phone: "98765 43210",
      email: "later@example.com",
      creditDays: "15",
      confirmDuplicatePhone: true,
    });
    await emailInvoice(tenant.ctx, invoice.id);
    expect(readTestOutbox()[0]?.to).toBe("later@example.com");
  });

  it("refuses a walk-in, a link that is off and a cancelled invoice", async () => {
    const tenant = await shop();
    const counter = await walkIn(tenant);
    await expect(emailInvoice(tenant.ctx, counter.id)).rejects.toBeInstanceOf(ConflictError);

    const linkOff = await sale(tenant);
    await revokePublicLink(tenant.ctx, linkOff.invoice.id);
    expect(await canEmailInvoice(tenant.ctx, linkOff.invoice.id)).toBe(false);
    await expect(emailInvoice(tenant.ctx, linkOff.invoice.id)).rejects.toThrow("turned off");

    const cancelled = await sale(tenant);
    await cancelInvoice(tenant.ctx, cancelled.invoice.id, { reason: "Wrong customer" });
    expect(await canEmailInvoice(tenant.ctx, cancelled.invoice.id)).toBe(false);
    await expect(emailInvoice(tenant.ctx, cancelled.invoice.id)).rejects.toThrow("cancelled");
    expect(readTestOutbox()).toEqual([]);
  });

  it("never sends for a demo business (SPEC F12)", async () => {
    const tenant = await shop({ isDemo: true });
    const { invoice } = await sale(tenant);
    expect(await canEmailInvoice(tenant.ctx, invoice.id)).toBe(false);
    await expect(emailInvoice(tenant.ctx, invoice.id)).rejects.toBeInstanceOf(DemoEmailError);
    expect(readTestOutbox()).toEqual([]);
    const audits = await listAuditLogs(getDb(), tenant.ctx, { entityId: invoice.id });
    expect(audits.map((row) => row.action)).not.toContain("invoice.emailed");
  });

  it("stops after 30 emails an hour per business (decision 4)", async () => {
    const tenant = await shop();
    const other = await shop();
    const { invoice } = await sale(tenant);
    const theirs = await sale(other);
    for (let sent = 0; sent < 30; sent += 1) await emailInvoice(tenant.ctx, invoice.id);
    await expect(emailInvoice(tenant.ctx, invoice.id)).rejects.toBeInstanceOf(RateLimitError);
    // Another business has its own budget.
    await emailInvoice(other.ctx, theirs.invoice.id);
    expect(readTestOutbox()).toHaveLength(31);
  });

  it.each<Role>(["OWNER", "STAFF"])("lets %s send", async (role) => {
    const tenant = await shop();
    const { invoice } = await sale(tenant);
    await emailInvoice(as(tenant, role), invoice.id);
    expect(readTestOutbox()).toHaveLength(1);
  });

  it("refuses ACCOUNTANT, and a draft or a malformed id is not found", async () => {
    const tenant = await shop();
    const { invoice } = await sale(tenant);
    await expect(emailInvoice(as(tenant, "ACCOUNTANT"), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(canEmailInvoice(as(tenant, "ACCOUNTANT"), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    await expect(emailInvoice(tenant.ctx, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(emailInvoice(tenant.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is not found when the business row is gone from the context", async () => {
    const tenant = await shop();
    const { invoice } = await sale(tenant);
    await updateCurrentBusiness(getDb(), tenant.ctx, { email: null });
    await expect(
      emailInvoice(
        { ...tenant.ctx, businessId: "00000000-0000-4000-8000-000000000000" },
        invoice.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  itIsolatesTenants({
    emailInvoice: isolationCase({
      arrange: async (owner) => (await sale(owner)).invoice,
      act: (intruder, invoice) => emailInvoice(intruder.ctx, invoice.id),
      verify: () => {
        expect(readTestOutbox()).toEqual([]);
        return Promise.resolve();
      },
    }),
    canEmailInvoice: isolationCase({
      arrange: async (owner) => (await sale(owner)).invoice,
      act: (intruder, invoice) => canEmailInvoice(intruder.ctx, invoice.id),
    }),
  });
});
