import { and, eq, isNull, ne, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { creditNotes, invoices, payments } from "@/server/db/schema";
import { settledStatus } from "@/server/domain/invoice/status";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import { getCustomerBalances, getCustomerLedger } from "@/server/services/ledger.service";
import { applyCredit, recordPayment, voidPayment } from "@/server/services/payment.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

const db = () => getDb();

function onDay(date: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:00:00Z`));
}

async function tenantAs(role: Role = "OWNER") {
  const tenant = await createTenant();
  return { ...tenant, ctx: { ...tenant.ctx, role } };
}

async function addCustomer(
  tenant: Tenant,
  openingBalancePaise = 0n,
  creditDays = 0,
): Promise<Customer> {
  return insertCustomer(db(), tenant.ctx, {
    name: "Mehta Traders",
    openingBalancePaise,
    creditDays,
  });
}

function line(rupees: string, qty = "1"): Partial<DraftLine> {
  return {
    productId: null,
    description: "Goods",
    hsnSac: "",
    unit: "NOS",
    qty,
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
  qty = "1",
): Promise<Invoice> {
  onDay(date);
  const draft = await createDraft(tenant.ctx, {
    customerId: customer.id,
    lines: [line(rupees, qty)],
  });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

async function pay(tenant: Tenant, customer: Customer, amount: string, date: string) {
  onDay(date);
  return recordPayment(tenant.ctx, {
    customerId: customer.id,
    amount,
    paymentDate: date,
    mode: "CASH",
    allocation: { kind: "AUTO" },
  });
}

describe("getCustomerLedger", () => {
  it("lists opening balance, invoices, credit notes and payments with a running balance and aging", async () => {
    const tenant = await tenantAs("ACCOUNTANT");
    const owner = { ...tenant, ctx: { ...tenant.ctx, role: "OWNER" as const } };
    const customer = await addCustomer(owner, 50_000n, 15);
    const first = await invoiceFor(owner, customer, "100", "2026-08-01", "2");
    const second = await invoiceFor(owner, customer, "300", "2026-10-20");
    const cancelled = await invoiceFor(owner, customer, "999", "2026-10-21");
    await cancelInvoice(owner.ctx, cancelled.id, { reason: "Wrong customer" });
    const [lineRow] = (await getInvoice(owner.ctx, first.id)).lines;
    onDay("2026-09-01");
    await createCreditNote(owner.ctx, first.id, {
      reason: "Goods returned",
      lines: [{ invoiceLineId: lineRow?.id ?? "", qty: "1" }],
    });
    const paid = await pay(owner, customer, "600", "2026-09-10");
    const voided = await pay(owner, customer, "50", "2026-10-25");
    onDay("2026-11-10");
    await voidPayment(owner.ctx, voided.payment.id, { reason: "Cheque bounced" });

    const result = await getCustomerLedger(tenant.ctx, customer.id);
    expect(result.today).toBe("2026-11-10");
    expect(
      result.ledger.rows.map((row) => [
        row.kind,
        row.number,
        row.debitPaise,
        row.creditPaise,
        row.balancePaise,
      ]),
    ).toEqual([
      ["OPENING", null, 50_000n, 0n, 50_000n],
      ["INVOICE", first.number, 20_000n, 0n, 70_000n],
      ["CREDIT_NOTE", expect.stringMatching(/^CN\//), 0n, 10_000n, 60_000n],
      ["PAYMENT", null, 0n, 60_000n, 0n],
      ["INVOICE", second.number, 30_000n, 0n, 30_000n],
    ]);
    expect(result.ledger.closingPaise).toBe(30_000n);
    expect(result.payments[paid.payment.id]).toEqual({ mode: "CASH", reference: null });
    // ₹600 paid the opening ₹500 and the rest of the first invoice (₹100); the second is open.
    expect(result.credit).toEqual({
      openingOwedPaise: 0n,
      advanceLeftPaise: 0n,
      onAccountPaise: 0n,
    });
    expect(result.openInvoices).toEqual([
      {
        id: second.id,
        number: second.number,
        invoiceDate: "2026-10-20",
        dueDate: "2026-11-04",
        balancePaise: 30_000n,
      },
    ]);
    expect(result.aging).toEqual({
      notDuePaise: 0n,
      pastDuePaise: [30_000n, 0n, 0n, 0n],
      openingPaise: 0n,
      onAccountPaise: 0n,
      totalPaise: 30_000n,
      overduePaise: 30_000n,
    });

    const period = await getCustomerLedger(tenant.ctx, customer.id, { from: "2026-09-05" });
    expect(period.ledger.broughtForwardPaise).toBe(60_000n);
    expect(period.ledger.rows.map((row) => row.kind)).toEqual(["PAYMENT", "INVOICE"]);
    expect(period.ledger.closingPaise).toBe(30_000n);
  });

  it("shows money on account against the aging total", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, -2_000n);
    await invoiceFor(tenant, customer, "10", "2026-11-09");
    const result = await getCustomerLedger(tenant.ctx, customer.id);
    expect(result.aging).toMatchObject({
      pastDuePaise: [1_000n, 0n, 0n, 0n],
      onAccountPaise: 2_000n,
    });
    expect(result.aging.totalPaise).toBe(result.ledger.closingPaise);
    expect(result.ledger.closingPaise).toBe(-1_000n);
  });

  it("is not found for an unknown customer and refuses a bad date", async () => {
    const tenant = await tenantAs();
    expect(
      await getCustomerLedger(tenant.ctx, "nope").catch((error: unknown) => error),
    ).toBeInstanceOf(NotFoundError);
    const customer = await addCustomer(tenant);
    await expect(
      getCustomerLedger(tenant.ctx, customer.id, { from: "2026-13-01" }),
    ).rejects.toThrow();
  });
});

describe("getCustomerBalances", () => {
  it("gives each customer's balance and skips ids that aren't customers", async () => {
    const tenant = await tenantAs("STAFF");
    const owner = { ...tenant, ctx: { ...tenant.ctx, role: "OWNER" as const } };
    const owes = await addCustomer(owner, 1_000n);
    const advance = await addCustomer(owner, -500n);
    await invoiceFor(owner, owes, "40", "2026-11-01");
    await pay(owner, owes, "15", "2026-11-02");
    const balances = await getCustomerBalances(tenant.ctx, [owes.id, advance.id, "nope"]);
    expect(balances).toEqual(
      new Map([
        [owes.id, 3_500n],
        [advance.id, -500n],
      ]),
    );
    expect(await getCustomerBalances(tenant.ctx, [])).toEqual(new Map());
  });
});

// --- SPEC F7 acceptance: ledger balance = invoices − payments − credit notes ---------------

type Op =
  | { kind: "invoice"; rupees: number; qty: number }
  | { kind: "pay"; rupees: number }
  | { kind: "credit"; pick: number }
  | { kind: "void"; pick: number }
  | { kind: "apply" };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("invoice" as const),
    rupees: fc.integer({ min: 1, max: 900 }),
    qty: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({ kind: fc.constant("pay" as const), rupees: fc.integer({ min: 1, max: 1500 }) }),
  fc.record({ kind: fc.constant("credit" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("void" as const), pick: fc.nat() }),
  fc.constant({ kind: "apply" as const }),
);

async function sumOf(query: Promise<{ total: string | null }[]>): Promise<bigint> {
  const [row] = await query;
  return BigInt(row?.total ?? "0");
}

describe("SPEC F7 acceptance on random data through the services", () => {
  it("ledger balance = opening + invoices − payments − credit notes; aging and statuses agree", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -500, max: 500 }),
        fc.array(op, { minLength: 1, maxLength: 12 }),
        async (openingRupees, ops) => {
          const tenant = await tenantAs();
          const customers = [
            await addCustomer(tenant, BigInt(openingRupees) * 100n, 10),
            await addCustomer(tenant, 0n, 0),
          ];
          const issued: Invoice[] = [];
          const paymentIds: string[] = [];
          for (const [index, step] of ops.entries()) {
            const customer = customers[index % 2] ?? customers[0];
            if (!customer) throw new Error("no customer");
            const date = `2026-10-${String(1 + index).padStart(2, "0")}`;
            if (step.kind === "invoice") {
              issued.push(
                await invoiceFor(tenant, customer, String(step.rupees), date, String(step.qty)),
              );
            } else if (step.kind === "pay") {
              paymentIds.push((await pay(tenant, customer, String(step.rupees), date)).payment.id);
            } else if (step.kind === "credit") {
              const invoice = issued[step.pick % Math.max(issued.length, 1)];
              if (!invoice) continue;
              const detail = await getInvoice(tenant.ctx, invoice.id);
              const lineRow = detail.lines[0];
              const returned = lineRow ? (detail.returnedMilli.get(lineRow.id) ?? 0n) : 0n;
              if (!lineRow || returned >= lineRow.qtyMilli) continue;
              onDay(date);
              // Refused when it would credit more than is owed; that is fine here.
              await createCreditNote(tenant.ctx, invoice.id, {
                reason: "Goods returned",
                lines: [{ invoiceLineId: lineRow.id, qty: "1" }],
              }).catch(() => undefined);
            } else if (step.kind === "void") {
              const id = paymentIds[step.pick % Math.max(paymentIds.length, 1)];
              if (!id) continue;
              onDay(date);
              await voidPayment(tenant.ctx, id, { reason: "Entered by mistake" }).catch(
                () => undefined,
              );
            } else {
              onDay(date);
              await applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } }).catch(
                () => undefined,
              );
            }
          }

          onDay("2026-11-10");
          for (const customer of customers) {
            const scope = (table: typeof invoices | typeof creditNotes | typeof payments) =>
              and(eq(table.businessId, tenant.business.id), eq(table.customerId, customer.id));
            const invoiced = await sumOf(
              db()
                .select({ total: sql<string>`sum(${invoices.grandTotalPaise})` })
                .from(invoices)
                .where(and(scope(invoices), ne(invoices.status, "CANCELLED"))),
            );
            const paid = await sumOf(
              db()
                .select({ total: sql<string>`sum(${payments.amountPaise})` })
                .from(payments)
                .where(and(scope(payments), isNull(payments.voidedAt))),
            );
            const credited = await sumOf(
              db()
                .select({ total: sql<string>`sum(${creditNotes.grandTotalPaise})` })
                .from(creditNotes)
                .where(scope(creditNotes)),
            );
            const result = await getCustomerLedger(tenant.ctx, customer.id);
            expect(result.ledger.closingPaise).toBe(
              customer.openingBalancePaise + invoiced - paid - credited,
            );
            expect(result.aging.totalPaise).toBe(result.ledger.closingPaise);
            const balances = await getCustomerBalances(tenant.ctx, [customer.id]);
            expect(balances.get(customer.id)).toBe(result.ledger.closingPaise);
          }
          for (const invoice of issued) {
            const fresh = (await getInvoice(tenant.ctx, invoice.id)).invoice;
            expect(fresh.status).toBe(settledStatus(fresh));
          }
        },
      ),
      { numRuns: 15, seed: 20261110 },
    );
  }, 180_000);
});

// --- isolation ---------------------------------------------------------------------------

describe("ledger.service tenant isolation", () => {
  itIsolatesTenants({
    getCustomerLedger: isolationCase({
      arrange: async (owner) => {
        const customer = await addCustomer(owner, 1_000n);
        await invoiceFor(owner, customer, "10", "2026-11-01");
        return customer;
      },
      act: (intruder, customer) => getCustomerLedger(intruder.ctx, customer.id),
    }),
    getCustomerBalances: isolationCase({
      arrange: (owner) => addCustomer(owner, 1_000n),
      act: async (intruder, customer) => [
        ...(await getCustomerBalances(intruder.ctx, [customer.id])).entries(),
      ],
    }),
  });
});
