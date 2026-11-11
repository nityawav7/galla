import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { createDraft, type Invoice, issueInvoice } from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";
import { revokePublicLink } from "@/server/services/public-link.service";
import { getReminderInfo, recordReminderShared } from "@/server/services/reminder.service";

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

function shop(): Promise<Tenant> {
  return createTenant({ tradeName: "Sharma Hardware" });
}

function addCustomer(
  tenant: Tenant,
  overrides: { openingBalancePaise?: bigint; creditDays?: number; phoneE164?: string | null } = {},
): Promise<Customer> {
  return insertCustomer(getDb(), tenant.ctx, {
    name: "Mehta Traders",
    openingBalancePaise: 0n,
    creditDays: 0,
    phoneE164: "+919876543210",
    ...overrides,
  });
}

function line(rupees: string): Partial<DraftLine> {
  return {
    productId: null,
    description: "Goods",
    hsnSac: "",
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

const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

describe("getReminderInfo", () => {
  it("builds the message from the ledger: total, overdue, opening balance and each invoice with its link", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant, { openingBalancePaise: 150_000n, creditDays: 10 });
    const late = await invoiceFor(tenant, customer, "500", "2026-10-01");
    const recent = await invoiceFor(tenant, customer, "200", "2026-11-08");
    await revokePublicLink(tenant.ctx, recent.id);
    onDay("2026-11-11");

    const info = await getReminderInfo(as(tenant, "STAFF").ctx, customer.id);
    expect(info?.phone).toBe("919876543210");
    expect(info?.defaultLocale).toBe("en");
    const lines = (info?.messages.en ?? "").split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "Namaste Mehta Traders,",
      "This is a reminder from Sharma Hardware: ₹2,200.00 is due, of which ₹500.00 is overdue.",
      "",
      "Earlier balance · ₹1,500.00",
      `${late.number ?? ""} · ₹500.00 · due 11-10-2026`,
    ]);
    expect(lines[5]).toMatch(/^https?:\/\/.+\/i\/[A-Za-z0-9_-]+$/);
    // The second invoice's link is turned off, so it is listed without one.
    expect(lines.slice(6)).toEqual([
      `${recent.number ?? ""} · ₹200.00 · due 18-11-2026`,
      "",
      "Thank you!",
    ]);
    expect(info?.messages.hi).toMatch(/^नमस्ते Mehta Traders,\nSharma Hardware की ओर से/);
  });

  it("lists the 5 oldest open invoices and counts the rest; no phone means no number", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant, { phoneE164: null });
    for (const day of ["01", "02", "03", "04", "05", "06", "07"]) {
      await invoiceFor(tenant, customer, "10", `2026-11-${day}`);
    }
    onDay("2026-11-11");
    const info = await getReminderInfo(tenant.ctx, customer.id);
    expect(info?.phone).toBeNull();
    expect(info?.messages.en).toContain("…and 2 more.");
    expect(info?.messages.en.match(/ · ₹10\.00 · due /g)).toHaveLength(5);
  });

  it("is null when nothing is due, including an advance", async () => {
    const tenant = await shop();
    const settled = await addCustomer(tenant);
    expect(await getReminderInfo(tenant.ctx, settled.id)).toBeNull();
    const advance = await addCustomer(tenant, { openingBalancePaise: -5_000n });
    expect(await getReminderInfo(tenant.ctx, advance.id)).toBeNull();
    const paid = await addCustomer(tenant);
    await invoiceFor(tenant, paid, "100", "2026-11-01");
    await recordPayment(tenant.ctx, {
      customerId: paid.id,
      amount: "100",
      paymentDate: "2026-11-01",
      mode: "CASH",
      allocation: { kind: "AUTO" },
    });
    expect(await getReminderInfo(tenant.ctx, paid.id)).toBeNull();
  });

  it("is for owners and staff only, and NotFound for an unknown customer", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant, { openingBalancePaise: 1_000n });
    await expect(getReminderInfo(as(tenant, "ACCOUNTANT").ctx, customer.id)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(recordReminderShared(as(tenant, "ACCOUNTANT").ctx, customer.id)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      getReminderInfo(tenant.ctx, "019a0000-0000-7000-8000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("recordReminderShared", () => {
  it("audits amounts and invoice ids, never names or phones", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant, { openingBalancePaise: 1_000n });
    const invoice = await invoiceFor(tenant, customer, "100", "2026-11-01");
    onDay("2026-11-11");
    expect(await recordReminderShared(as(tenant, "STAFF").ctx, customer.id)).toBe(true);

    const [row] = await listAuditLogs(getDb(), tenant.ctx, {
      entity: "customer",
      entityId: customer.id,
    });
    expect(row?.action).toBe("customer.reminderShared");
    expect(row?.diff).toEqual({
      after: { balancePaise: "11000", overduePaise: "10000", invoiceIds: [invoice.id] },
    });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("Mehta");
    expect(stored).not.toContain("9876543210");
  });

  it("writes nothing once nothing is due", async () => {
    const tenant = await shop();
    const customer = await addCustomer(tenant);
    expect(await recordReminderShared(tenant.ctx, customer.id)).toBe(false);
    expect(
      await listAuditLogs(getDb(), tenant.ctx, { entity: "customer", entityId: customer.id }),
    ).toEqual([]);
  });
});

describe("reminder.service tenant isolation", () => {
  itIsolatesTenants({
    getReminderInfo: isolationCase({
      arrange: (owner) => addCustomer(owner, { openingBalancePaise: 1_000n }),
      act: (intruder, customer) => getReminderInfo(intruder.ctx, customer.id),
    }),
    recordReminderShared: isolationCase({
      arrange: (owner) => addCustomer(owner, { openingBalancePaise: 1_000n }),
      act: (intruder, customer) => recordReminderShared(intruder.ctx, customer.id),
      verify: async (owner, customer) => {
        expect(
          await listAuditLogs(getDb(), owner.ctx, { entity: "customer", entityId: customer.id }),
        ).toEqual([]);
      },
    }),
  });
});
