import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { auditLogs } from "@/server/db/schema";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import { getDashboard } from "@/server/services/dashboard.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";

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

const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

function addCustomer(tenant: Tenant, name: string, openingBalancePaise = 0n): Promise<Customer> {
  return insertCustomer(getDb(), tenant.ctx, { name, openingBalancePaise, creditDays: 0 });
}

function line(description: string, qty: string, rupees: string, rateBp = 0): Partial<DraftLine> {
  return {
    productId: null,
    description,
    hsnSac: "",
    unit: "NOS",
    qty,
    unitPrice: rupees,
    discount: "",
    rateBp,
    priceIncludesTax: false,
  };
}

async function invoice(
  tenant: Tenant,
  customer: Customer | null,
  date: string,
  item: Partial<DraftLine>,
): Promise<Invoice> {
  onDay(date);
  const draft = await createDraft(tenant.ctx, { customerId: customer?.id ?? null, lines: [item] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

/**
 * Today is 11-11-2026. Mehta: opening ₹10 owed, cement ₹200 on 20-10 (₹100 credited back today),
 * paint ₹100 + 18% today, ₹30 paid today. Shah: ₹5 advance, sand ₹10 on 03-11. Joshi: ₹7 advance.
 * A walk-in buys nails for ₹50 today; ₹999 of glue on 05-11 is cancelled.
 */
async function shop(scheme: "REGULAR" | "COMPOSITION" = "REGULAR") {
  const tenant = await createTenant(scheme === "REGULAR" ? {} : { gstScheme: "COMPOSITION" });
  const mehta = await addCustomer(tenant, "Mehta Traders", 1_000n);
  const shah = await addCustomer(tenant, "Shah Stores", -500n);
  await addCustomer(tenant, "Joshi & Sons", -700n);
  const cement = await invoice(tenant, mehta, "2026-10-20", line("Cement", "2", "100"));
  await invoice(tenant, shah, "2026-11-03", line("Sand", "1", "10"));
  const glue = await invoice(tenant, null, "2026-11-05", line("Glue", "1", "999"));
  onDay("2026-11-05");
  await cancelInvoice(tenant.ctx, glue.id, { reason: "Entered twice" });
  // The reminder went out on 02-11, when ₹200 was overdue.
  await getDb()
    .insert(auditLogs)
    .values({
      businessId: tenant.business.id,
      actorUserId: tenant.ctx.userId,
      entity: "customer",
      entityId: mehta.id,
      action: "customer.reminderShared",
      diff: { after: { balancePaise: "21000", overduePaise: "20000", invoiceIds: [cement.id] } },
      at: new Date("2026-11-02T06:00:00Z"),
    });
  await invoice(
    tenant,
    mehta,
    "2026-11-11",
    line("Paint", "1", "100", scheme === "REGULAR" ? 1800 : 0),
  );
  await invoice(tenant, null, "2026-11-11", line("Nails", "1", "50"));
  const [cementLine] = (await getInvoice(tenant.ctx, cement.id)).lines;
  onDay("2026-11-11");
  await createCreditNote(tenant.ctx, cement.id, {
    reason: "Goods returned",
    lines: [{ invoiceLineId: cementLine?.id ?? "", qty: "1" }],
  });
  await recordPayment(tenant.ctx, {
    customerId: mehta.id,
    amount: "30",
    paymentDate: "2026-11-11",
    mode: "CASH",
    allocation: { kind: "AUTO" },
  });
  onDay("2026-11-11");
  return { tenant, mehta, shah };
}

describe("getDashboard", () => {
  it("adds up sales, GST, receivables, overdue, aging and reminder recovery", async () => {
    const { tenant, mehta, shah } = await shop();
    const { today, counts, money } = await getDashboard(as(tenant, "ACCOUNTANT").ctx);
    expect(today).toBe("2026-11-11");
    expect(counts).toEqual({
      invoicesToday: 2,
      invoicesThisMonth: 3,
      overdueInvoices: 2,
      topProducts: [
        { key: "line:Cement", name: "Cement", unit: "NOS", value: 1_000n },
        { key: "line:Nails", name: "Nails", unit: "NOS", value: 1_000n },
        { key: "line:Paint", name: "Paint", unit: "NOS", value: 1_000n },
        { key: "line:Sand", name: "Sand", unit: "NOS", value: 1_000n },
      ],
    });
    expect(money).toMatchObject({
      // ₹118 + ₹50 − ₹100 credited; the month adds ₹10 of sand; glue was cancelled.
      todaySalesPaise: 6_800n,
      monthSalesPaise: 7_800n,
      monthGstPaise: 1_800n,
      // Mehta ₹198, Shah ₹5, the walk-in ₹50; Joshi's ₹7 advance is apart.
      receivablePaise: 25_300n,
      advancesPaise: 700n,
      // Cement ₹80 still due since 20-10, sand ₹10 since 03-11.
      overduePaise: 9_000n,
      recovery: { reminders: 1, remindedPaise: 20_000n, recoveredPaise: 3_000n },
      topDebtors: [
        { customerId: mehta.id, name: "Mehta Traders", balancePaise: 19_800n },
        { customerId: shah.id, name: "Shah Stores", balancePaise: 500n },
      ],
    });
    expect(money?.topProducts.map((product) => [product.name, product.value])).toEqual([
      ["Cement", 10_000n],
      ["Paint", 10_000n],
      ["Nails", 5_000n],
      ["Sand", 1_000n],
    ]);
    expect(money?.aging).toMatchObject({
      notDuePaise: 0n,
      pastDuePaise: [25_800n, 0n, 0n, 0n],
      openingPaise: 0n,
    });
    const daily = money?.daily ?? [];
    expect(daily).toHaveLength(30);
    expect(daily[0]?.date).toBe("2026-10-13");
    expect(daily.filter((day) => day.valuePaise !== 0n)).toEqual([
      { date: "2026-10-20", valuePaise: 20_000n },
      { date: "2026-11-03", valuePaise: 1_000n },
      { date: "2026-11-11", valuePaise: 6_800n },
    ]);
  });

  it("staff get counts and quantities, never money", async () => {
    const { tenant } = await shop();
    const dashboard = await getDashboard(as(tenant, "STAFF").ctx);
    expect(dashboard.money).toBeNull();
    expect(dashboard.counts.invoicesToday).toBe(2);
    expect(
      JSON.stringify(dashboard, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v)),
    ).not.toMatch(/6800|25300|19800/);
  });

  it("a composition business collects no GST, so that card is empty", async () => {
    const { tenant } = await shop("COMPOSITION");
    expect((await getDashboard(tenant.ctx)).money?.monthGstPaise).toBeNull();
  });

  it("a new business sees zeros, not errors", async () => {
    const tenant = await createTenant();
    onDay("2026-11-11");
    const { counts, money } = await getDashboard(tenant.ctx);
    expect(counts).toMatchObject({ invoicesToday: 0, invoicesThisMonth: 0, overdueInvoices: 0 });
    expect(money).toMatchObject({
      todaySalesPaise: 0n,
      receivablePaise: 0n,
      overduePaise: 0n,
      topProducts: [],
      topDebtors: [],
      recovery: { reminders: 0, recoveredPaise: 0n },
    });
  });

  it("refuses a role without records:view", async () => {
    const tenant = await createTenant();
    await expect(getDashboard(as(tenant, "NOBODY" as Role).ctx)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("dashboard.service tenant isolation", () => {
  itIsolatesTenants({
    getDashboard: isolationCase({
      arrange: async (owner) => {
        const customer = await addCustomer(owner, "Owner's Customer", 5_000n);
        await invoice(owner, customer, "2026-11-11", line("Secret item", "1", "100"));
        return customer;
      },
      act: async (intruder) => {
        const dashboard = await getDashboard(intruder.ctx);
        expect(dashboard.counts.invoicesToday).toBe(0);
        expect(dashboard.money?.receivablePaise).toBe(0n);
        expect(JSON.stringify(dashboard.counts)).not.toContain("Secret item");
        return dashboard;
      },
    }),
  });
});
