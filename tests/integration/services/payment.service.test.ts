import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { type DraftLine } from "@/lib/validation/invoices";
import { type RecordPaymentValues } from "@/lib/validation/payments";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { invoices, paymentAllocations, payments } from "@/server/db/schema";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import { updateCustomer } from "@/server/services/customer.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  applyCredit,
  getPayment,
  getPaymentOptions,
  listPayments,
  PAYMENTS_PAGE_SIZE,
  recordPayment,
  voidPayment,
} from "@/server/services/payment.service";

import { expectViolation } from "../support/db-errors";
import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

const db = () => getDb();

/** Sets "now" for the services (Date only; the DB driver keeps real time). */
function setNow(iso: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

/** 06:00 UTC is 11:30 IST, safely inside the day. */
const onDay = (date: string) => {
  setNow(`${date}T06:00:00Z`);
};

async function tenantAs(role: Role = "OWNER") {
  const tenant = await createTenant();
  return { ...tenant, ctx: { ...tenant.ctx, role } };
}

const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

async function addCustomer(tenant: Tenant, openingBalancePaise = 0n): Promise<Customer> {
  return insertCustomer(db(), tenant.ctx, { name: "Mehta Traders", openingBalancePaise });
}

/** A zero-rated one-off line, so the invoice total is exactly the price. */
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

/** Issues an invoice for `rupees` (today, or on `date`) to the customer, or a walk-in. */
async function invoiceFor(
  tenant: Tenant,
  customer: Customer | null,
  rupees: string,
  date?: string,
): Promise<Invoice> {
  if (date) onDay(date);
  const draft = await createDraft(tenant.ctx, {
    customerId: customer?.id ?? null,
    lines: [line(rupees)],
  });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

function payment(overrides: Partial<RecordPaymentValues> = {}): RecordPaymentValues {
  return {
    customerId: null,
    amount: "100",
    paymentDate: "2026-11-06",
    mode: "CASH",
    allocation: { kind: "AUTO" },
    ...overrides,
  };
}

async function invoiceRow(tenant: Tenant, invoice: Invoice) {
  const row = await findInvoiceById(db(), tenant.ctx, invoice.id);
  if (!row) throw new Error("invoice vanished");
  return row;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function issuesOf(promise: Promise<unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
}

async function conflictOf(promise: Promise<unknown>): Promise<string> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ConflictError);
  return (error as ConflictError).message;
}

/** The Postgres message behind Drizzle's "Failed query" wrapper. */
async function dbMessage(promise: Promise<unknown>): Promise<string> {
  let current = await rejection(promise);
  const messages: string[] = [];
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" | ");
}

async function paymentCount(tenant: Tenant): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.businessId, tenant.business.id));
  return row?.count ?? 0;
}

// --- recording ---------------------------------------------------------------------------

describe("recordPayment", () => {
  it.each<Role>(["OWNER", "ACCOUNTANT", "STAFF"])(
    "lets %s record a part payment, then the rest makes the invoice PAID",
    async (role) => {
      const owner = await tenantAs();
      const customer = await addCustomer(owner);
      const invoice = await invoiceFor(owner, customer, "1000", "2026-11-01");
      const tenant = as(owner, role);
      onDay("2026-11-06");

      const first = await recordPayment(
        tenant.ctx,
        payment({ customerId: customer.id, amount: "400", mode: "UPI", reference: "UTR123" }),
      );
      expect(first.invoices).toEqual([
        { id: invoice.id, number: invoice.number, status: "PARTIALLY_PAID", balancePaise: 60_000n },
      ]);
      expect(first.payment).toMatchObject({
        amountPaise: 40_000n,
        mode: "UPI",
        reference: "UTR123",
        customerId: customer.id,
      });
      expect(await invoiceRow(owner, invoice)).toMatchObject({
        status: "PARTIALLY_PAID",
        amountPaidPaise: 40_000n,
      });

      const rest = await recordPayment(
        tenant.ctx,
        payment({ customerId: customer.id, amount: "600" }),
      );
      expect(rest.onAccountPaise).toBe(0n);
      expect(await invoiceRow(owner, invoice)).toMatchObject({
        status: "PAID",
        amountPaidPaise: 100_000n,
      });

      const audit = await listAuditLogs(db(), owner.ctx, { entityId: first.payment.id });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "payment.recorded",
        diff: {
          after: {
            amountPaise: "40000",
            mode: "UPI",
            allocations: [{ invoiceId: invoice.id, amountPaise: "40000" }],
            onAccountPaise: "0",
          },
        },
      });
      // No reference text or customer details in the audit row.
      expect(JSON.stringify(audit[0]?.diff)).not.toContain("UTR123");
    },
  );

  it("pays the opening balance, then invoices oldest first, and keeps the rest on account", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, 5_000n);
    const newer = await invoiceFor(tenant, customer, "300", "2026-11-03");
    const older = await invoiceFor(tenant, customer, "200", "2026-11-01");
    const newest = await invoiceFor(tenant, customer, "100", "2026-11-05");
    onDay("2026-11-06");

    const result = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "650" }),
    );
    expect(result.allocations).toEqual([
      { invoiceId: null, amountPaise: 5_000n },
      { invoiceId: older.id, amountPaise: 20_000n },
      { invoiceId: newer.id, amountPaise: 30_000n },
      { invoiceId: newest.id, amountPaise: 10_000n },
    ]);
    expect(result.onAccountPaise).toBe(0n);

    const extra = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "75.50" }),
    );
    expect(extra).toMatchObject({ allocations: [], onAccountPaise: 7_550n, invoices: [] });
    const options = await getPaymentOptions(tenant.ctx, { customerId: customer.id });
    expect(options).toMatchObject({
      customer: { id: customer.id, name: "Mehta Traders" },
      openItems: [],
      credit: { openingOwedPaise: 0n, advanceLeftPaise: 0n, onAccountPaise: 7_550n },
      today: "2026-11-06",
    });
  });

  it("applies chosen amounts; over a balance or the payment is refused and nothing is written", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, 1_000n);
    const a = await invoiceFor(tenant, customer, "100", "2026-11-01");
    const b = await invoiceFor(tenant, customer, "200", "2026-11-02");
    onDay("2026-11-06");
    const manual = (items: { invoiceId: string; amount: string }[], amount = "500") =>
      payment({ customerId: customer.id, amount, allocation: { kind: "MANUAL", items } });

    expect(
      await issuesOf(recordPayment(tenant.ctx, manual([{ invoiceId: a.id, amount: "100.01" }]))),
    ).toEqual([{ path: "allocation.items.0.amount", message: "allocationExceedsBalance" }]);
    expect(
      await issuesOf(
        recordPayment(
          tenant.ctx,
          manual(
            [
              { invoiceId: a.id, amount: "100" },
              { invoiceId: b.id, amount: "150" },
            ],
            "200",
          ),
        ),
      ),
    ).toEqual([{ path: "allocation.amount", message: "allocationExceedsPayment" }]);
    expect(await paymentCount(tenant)).toBe(0);

    const result = await recordPayment(
      tenant.ctx,
      manual([
        { invoiceId: b.id, amount: "150" },
        { invoiceId: "OPENING", amount: "10" },
      ]),
    );
    expect(result).toMatchObject({
      allocations: [
        { invoiceId: b.id, amountPaise: 15_000n },
        { invoiceId: null, amountPaise: 1_000n },
      ],
      onAccountPaise: 34_000n,
    });
    expect(await invoiceRow(tenant, a)).toMatchObject({ status: "ISSUED", amountPaidPaise: 0n });
    expect(await invoiceRow(tenant, b)).toMatchObject({ status: "PARTIALLY_PAID" });
  });

  it("refuses another customer's invoice and a cancelled one; a foreign id is not found", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const other = await addCustomer(tenant);
    const theirs = await invoiceFor(tenant, other, "100", "2026-11-01");
    const cancelled = await invoiceFor(tenant, customer, "100", "2026-11-01");
    await cancelInvoice(tenant.ctx, cancelled.id, { reason: "Wrong customer" });
    const stranger = await tenantAs();
    const foreign = await invoiceFor(stranger, await addCustomer(stranger), "100", "2026-11-01");
    onDay("2026-11-06");
    const pay = (invoiceId: string) =>
      recordPayment(
        tenant.ctx,
        payment({
          customerId: customer.id,
          allocation: { kind: "MANUAL", items: [{ invoiceId, amount: "100" }] },
        }),
      );

    for (const invoice of [theirs, cancelled]) {
      expect(await issuesOf(pay(invoice.id))).toEqual([
        { path: "allocation.items.0.invoiceId", message: "invoiceNotOpen" },
      ]);
    }
    expect(await rejection(pay(foreign.id))).toBeInstanceOf(NotFoundError);
    expect(await paymentCount(tenant)).toBe(0);
  });

  it.each([
    ["2026-11-07", "paymentDateFuture"],
    ["2025-11-05", "paymentDateTooOld"],
  ])("refuses a payment dated %s", async (paymentDate, message) => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    onDay("2026-11-06");
    expect(
      await issuesOf(recordPayment(tenant.ctx, payment({ customerId: customer.id, paymentDate }))),
    ).toEqual([{ path: "paymentDate", message }]);
  });

  it("accepts a payment a year back to the day", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    onDay("2026-11-06");
    const result = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, paymentDate: "2025-11-06" }),
    );
    expect(result.payment.paymentDate).toBe("2025-11-06");
  });

  it("refuses bad input with validation keys", async () => {
    const tenant = await tenantAs();
    const issues = await issuesOf(
      recordPayment(tenant.ctx, {
        customerId: "nope",
        amount: "0",
        paymentDate: "2026-02-30",
        mode: "GOLD",
        allocation: { kind: "AUTO" },
      }),
    );
    expect(issues.map((issue) => issue.message).sort()).toEqual(
      [
        "customerRequired",
        "paymentAmountPositive",
        "paymentDateInvalid",
        "paymentModeRequired",
      ].sort(),
    );
  });

  it("is not found for an unknown customer", async () => {
    const tenant = await tenantAs();
    onDay("2026-11-06");
    expect(
      await rejection(
        recordPayment(tenant.ctx, payment({ customerId: "019a0000-0000-7000-8000-000000000000" })),
      ),
    ).toBeInstanceOf(NotFoundError);
  });
});

describe("recordPayment for a walk-in sale", () => {
  it("pays the walk-in invoice, in part or in full", async () => {
    const tenant = await tenantAs();
    const invoice = await invoiceFor(tenant, null, "250", "2026-11-06");
    const pay = (amount: string) =>
      recordPayment(
        tenant.ctx,
        payment({
          amount,
          allocation: { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount }] },
        }),
      );
    expect((await pay("50")).invoices[0]?.status).toBe("PARTIALLY_PAID");
    const rest = await pay("200");
    expect(rest).toMatchObject({ onAccountPaise: 0n, payment: { customerId: null } });
    expect(rest.invoices[0]).toMatchObject({ status: "PAID", balancePaise: 0n });
    expect(await getPaymentOptions(tenant.ctx, { invoiceId: invoice.id })).toMatchObject({
      customer: null,
      invoiceId: invoice.id,
      openItems: [],
    });
  });

  it("refuses more than the balance, money left over, or a customer's invoice", async () => {
    const tenant = await tenantAs();
    const walkIn = await invoiceFor(tenant, null, "100", "2026-11-06");
    const customers = await invoiceFor(tenant, await addCustomer(tenant), "100");
    const pay = (invoiceId: string, amount: string, allocated = amount) =>
      recordPayment(
        tenant.ctx,
        payment({
          amount,
          allocation: { kind: "MANUAL", items: [{ invoiceId, amount: allocated }] },
        }),
      );
    expect(await issuesOf(pay(walkIn.id, "100.01"))).toEqual([
      { path: "allocation.items.0.amount", message: "allocationExceedsBalance" },
    ]);
    expect(await issuesOf(pay(walkIn.id, "100", "60"))).toEqual([
      { path: "amount", message: "walkInPaymentInvalid" },
    ]);
    expect(await issuesOf(pay(customers.id, "100"))).toEqual([
      { path: "customerId", message: "customerRequired" },
    ]);
    expect(
      await issuesOf(recordPayment(tenant.ctx, payment({ allocation: { kind: "AUTO" } }))),
    ).toEqual([{ path: "allocation", message: "walkInPaymentInvalid" }]);
    expect(
      await issuesOf(
        recordPayment(
          tenant.ctx,
          payment({
            allocation: { kind: "MANUAL", items: [{ invoiceId: "OPENING", amount: "1" }] },
          }),
        ),
      ),
    ).toEqual([{ path: "allocation", message: "walkInPaymentInvalid" }]);
    expect(await paymentCount(tenant)).toBe(0);
  });

  it("is not found for a draft or an unknown invoice", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, { lines: [line("10")] });
    onDay("2026-11-06");
    for (const invoiceId of [draft.id, "019a0000-0000-7000-8000-000000000000"]) {
      expect(
        await rejection(
          recordPayment(
            tenant.ctx,
            payment({ allocation: { kind: "MANUAL", items: [{ invoiceId, amount: "10" }] } }),
          ),
        ),
      ).toBeInstanceOf(NotFoundError);
    }
  });
});

// --- voiding -----------------------------------------------------------------------------

describe("voidPayment", () => {
  it("puts the money back on each invoice it paid, once, with an audit row", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, 1_000n);
    const a = await invoiceFor(tenant, customer, "100", "2026-11-01");
    const b = await invoiceFor(tenant, customer, "100", "2026-11-02");
    onDay("2026-11-06");
    await recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "50" }));
    const big = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "200" }),
    );
    expect(await invoiceRow(tenant, a)).toMatchObject({ status: "PAID" });
    expect(await invoiceRow(tenant, b)).toMatchObject({ status: "PAID" });

    const voided = await voidPayment(tenant.ctx, big.payment.id, { reason: "Cheque bounced" });
    expect(voided).toMatchObject({ voidReason: "Cheque bounced", voidedBy: tenant.ctx.userId });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(await invoiceRow(tenant, a)).toMatchObject({
      status: "PARTIALLY_PAID",
      amountPaidPaise: 4_000n,
    });
    expect(await invoiceRow(tenant, b)).toMatchObject({ status: "ISSUED", amountPaidPaise: 0n });
    expect((await getPaymentOptions(tenant.ctx, { customerId: customer.id })).credit).toEqual({
      openingOwedPaise: 0n,
      advanceLeftPaise: 0n,
      onAccountPaise: 0n,
    });

    expect(
      await conflictOf(voidPayment(tenant.ctx, big.payment.id, { reason: "Again please" })),
    ).toBe("paymentAlreadyVoided");
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: big.payment.id });
    expect(audit.map((row) => row.action).sort()).toEqual(["payment.recorded", "payment.voided"]);
    // The invoice keeps its voided payment in its history.
    const detail = await getInvoice(tenant.ctx, b.id);
    expect(detail.payments).toEqual([
      expect.objectContaining({ paymentId: big.payment.id, amountPaise: 10_000n }),
    ]);
    expect(detail.payments[0]?.voidedAt).toBeInstanceOf(Date);
  });

  it("lets the invoice be cancelled again once its only payment is voided", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "100", "2026-11-01");
    onDay("2026-11-06");
    const paid = await recordPayment(tenant.ctx, payment({ customerId: customer.id }));
    expect(await conflictOf(cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong" }))).toBe(
      "invoiceHasPayments",
    );
    await voidPayment(tenant.ctx, paid.payment.id, { reason: "Entered by mistake" });
    const cancelled = await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("voids a walk-in payment", async () => {
    const tenant = await tenantAs();
    const invoice = await invoiceFor(tenant, null, "40", "2026-11-06");
    const paid = await recordPayment(
      tenant.ctx,
      payment({
        amount: "40",
        allocation: { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount: "40" }] },
      }),
    );
    await voidPayment(tenant.ctx, paid.payment.id, { reason: "Entered by mistake" });
    expect(await invoiceRow(tenant, invoice)).toMatchObject({
      status: "ISSUED",
      amountPaidPaise: 0n,
    });
  });

  it.each<Role>(["ACCOUNTANT", "STAFF"])("is owner-only (%s is forbidden)", async (role) => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    onDay("2026-11-06");
    const paid = await recordPayment(tenant.ctx, payment({ customerId: customer.id }));
    expect(
      await rejection(voidPayment(as(tenant, role).ctx, paid.payment.id, { reason: "Mistake" })),
    ).toBeInstanceOf(ForbiddenError);
  });

  it("needs a reason, and an unknown payment is not found", async () => {
    const tenant = await tenantAs();
    expect(
      await issuesOf(
        voidPayment(tenant.ctx, "019a0000-0000-7000-8000-000000000000", { reason: " " }),
      ),
    ).toEqual([{ path: "reason", message: "voidReasonRequired" }]);
    expect(
      await rejection(
        voidPayment(tenant.ctx, "019a0000-0000-7000-8000-000000000000", { reason: "Mistake" }),
      ),
    ).toBeInstanceOf(NotFoundError);
    expect(await rejection(voidPayment(tenant.ctx, "nope", { reason: "Mistake" }))).toBeInstanceOf(
      NotFoundError,
    );
  });
});

// --- apply advance -----------------------------------------------------------------------

describe("applyCredit", () => {
  it("applies an earlier overpayment to a new invoice, oldest first", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    onDay("2026-11-01");
    const early = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "150", paymentDate: "2026-11-01" }),
    );
    const invoice = await invoiceFor(tenant, customer, "100", "2026-11-03");
    const later = await invoiceFor(tenant, customer, "100", "2026-11-04");

    const result = await applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } });
    expect(result.allocations).toEqual([
      { paymentId: early.payment.id, invoiceId: invoice.id, amountPaise: 10_000n },
      { paymentId: early.payment.id, invoiceId: later.id, amountPaise: 5_000n },
    ]);
    expect(result.onAccountPaise).toBe(0n);
    expect(await invoiceRow(tenant, invoice)).toMatchObject({ status: "PAID" });
    expect(await invoiceRow(tenant, later)).toMatchObject({ status: "PARTIALLY_PAID" });
    expect(
      await conflictOf(applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } })),
    ).toBe("nothingOnAccount");
    const [audit] = await listAuditLogs(db(), tenant.ctx, { entityId: customer.id });
    expect(audit).toMatchObject({ action: "payment.applied", entity: "customer" });
  });

  it("applies the opening advance first, and may be chosen by hand", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, -6_000n);
    onDay("2026-11-01");
    await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "20", paymentDate: "2026-11-01" }),
    );
    const a = await invoiceFor(tenant, customer, "50", "2026-11-02");
    const b = await invoiceFor(tenant, customer, "50", "2026-11-03");

    const result = await applyCredit(tenant.ctx, customer.id, {
      allocation: { kind: "MANUAL", items: [{ invoiceId: b.id, amount: "50" }] },
    });
    expect(result.allocations).toEqual([
      expect.objectContaining({ paymentId: null, invoiceId: b.id, amountPaise: 5_000n }),
    ]);
    expect(result.onAccountPaise).toBe(3_000n);
    expect(
      await issuesOf(
        applyCredit(tenant.ctx, customer.id, {
          allocation: { kind: "MANUAL", items: [{ invoiceId: a.id, amount: "31" }] },
        }),
      ),
    ).toEqual([{ path: "allocation.amount", message: "allocationExceedsPayment" }]);

    const rest = await applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } });
    expect(rest.allocations.map((row) => row.amountPaise)).toEqual([1_000n, 2_000n]);
    expect(rest.allocations.map((row) => row.paymentId === null)).toEqual([true, false]);
    expect(await invoiceRow(tenant, a)).toMatchObject({
      status: "PARTIALLY_PAID",
      amountPaidPaise: 3_000n,
    });
    // The opening advance is used, so it can no longer be lowered below what it paid.
    expect(
      await issuesOf(
        updateCustomer(tenant.ctx, customer.id, {
          ...EMPTY_CUSTOMER_FORM,
          name: "Mehta Traders",
          balanceType: "ADVANCE",
          openingBalance: "50",
        }),
      ),
    ).toEqual([{ path: "openingBalance", message: "openingBalanceApplied" }]);
  });

  it("is refused when nothing is open", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, -1_000n);
    expect(
      await conflictOf(applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } })),
    ).toBe("invoiceNotOpen");
  });

  it("keeps an opening balance that payments have paid from going below it", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, 10_000n);
    onDay("2026-11-06");
    await recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "60" }));
    const edit = (openingBalance: string) =>
      updateCustomer(tenant.ctx, customer.id, {
        ...EMPTY_CUSTOMER_FORM,
        name: "Mehta Traders",
        balanceType: "OWES",
        openingBalance,
      });
    expect(await issuesOf(edit("59.99"))).toEqual([
      { path: "openingBalance", message: "openingBalanceApplied" },
    ]);
    expect(await edit("60")).toMatchObject({ status: "saved" });
  });
});

// --- credit notes and payments together --------------------------------------------------

describe("credit notes after payments", () => {
  it("a credit note that clears a part-paid invoice makes it PAID", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const created = await createDraft(tenant.ctx, {
      customerId: customer.id,
      lines: [{ ...line("100"), qty: "2" }],
    });
    onDay("2026-11-01");
    const issued = await issueInvoice(tenant.ctx, created.id, { version: created.version });
    if (issued.status !== "issued") throw new Error("not issued");
    const invoice = issued.invoice;
    const [lineRow] = (await getInvoice(tenant.ctx, invoice.id)).lines;
    onDay("2026-11-06");
    await recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "100" }));
    await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Goods returned",
      lines: [{ invoiceLineId: lineRow?.id ?? "", qty: "1" }],
    });
    expect(await invoiceRow(tenant, invoice)).toMatchObject({
      status: "PAID",
      amountPaidPaise: 10_000n,
      amountCreditedPaise: 10_000n,
    });
  });
});

// --- reads -------------------------------------------------------------------------------

describe("listPayments and getPayment", () => {
  it("lists payments newest first in pages, with filters, and shows one with its allocations", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const other = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "40000", "2026-11-01");
    onDay("2026-11-06");
    for (let index = 0; index < PAYMENTS_PAGE_SIZE + 1; index += 1) {
      await recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "1" }));
    }
    const elsewhere = await recordPayment(
      tenant.ctx,
      payment({ customerId: other.id, amount: "5", paymentDate: "2026-10-01" }),
    );

    const first = await listPayments(as(tenant, "ACCOUNTANT").ctx, {});
    expect(first.items).toHaveLength(PAYMENTS_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPayments(tenant.ctx, { cursor: first.nextCursor });
    expect(second.items.map((row) => row.payment.id)).toHaveLength(2);
    expect(second.items.at(-1)?.payment.id).toBe(elsewhere.payment.id);
    expect(second.nextCursor).toBeNull();
    expect(second.items.at(-1)).toMatchObject({
      customerName: "Mehta Traders",
      allocatedPaise: 0n,
    });

    const filtered = await listPayments(tenant.ctx, {
      customer: other.id,
      from: "2026-09-01",
      to: "2026-10-31",
    });
    expect(filtered.items.map((row) => row.payment.id)).toEqual([elsewhere.payment.id]);

    const detail = await getPayment(tenant.ctx, first.items[0]?.payment.id ?? "");
    expect(detail).toMatchObject({
      customerName: "Mehta Traders",
      allocations: [{ invoiceId: invoice.id, invoiceNumber: invoice.number, amountPaise: 100n }],
    });
    expect(await rejection(getPayment(tenant.ctx, "nope"))).toBeInstanceOf(NotFoundError);
  });

  it("getPaymentOptions lists open items oldest first, opening balance on top", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, 2_500n);
    const newer = await invoiceFor(tenant, customer, "20", "2026-11-02");
    const older = await invoiceFor(tenant, customer, "10", "2026-11-01");
    const options = await getPaymentOptions(as(tenant, "STAFF").ctx, { invoiceId: newer.id });
    expect(options.invoiceId).toBe(newer.id);
    expect(options.openItems.map((item) => [item.invoiceId, item.balancePaise])).toEqual([
      [null, 2_500n],
      [older.id, 1_000n],
      [newer.id, 2_000n],
    ]);
    expect(await rejection(getPaymentOptions(tenant.ctx, {}))).toBeInstanceOf(NotFoundError);
  });
});

// --- concurrency -------------------------------------------------------------------------

describe("concurrent payments", () => {
  it("20 parallel ₹100 payments against a ₹1,000 balance: exactly 10 apply", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "1000", "2026-11-01");
    onDay("2026-11-06");
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        recordPayment(
          tenant.ctx,
          payment({
            customerId: customer.id,
            allocation: { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount: "100" }] },
          }),
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(ValidationError);
    }
    expect(await invoiceRow(tenant, invoice)).toMatchObject({
      status: "PAID",
      amountPaidPaise: 100_000n,
    });
  });

  it("parallel automatic payments never pay more than the total; the rest is on account", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "500", "2026-11-01");
    onDay("2026-11-06");
    await Promise.all(
      Array.from({ length: 12 }, () =>
        recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "70" })),
      ),
    );
    expect(await invoiceRow(tenant, invoice)).toMatchObject({ amountPaidPaise: 50_000n });
    const options = await getPaymentOptions(tenant.ctx, { customerId: customer.id });
    expect(options.credit.onAccountPaise).toBe(12n * 7_000n - 50_000n);
  });

  it("a payment, a credit note, a void and an apply in parallel finish without deadlock", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const created = await createDraft(tenant.ctx, {
      customerId: customer.id,
      lines: [{ ...line("100"), qty: "5" }],
    });
    onDay("2026-11-01");
    const issued = await issueInvoice(tenant.ctx, created.id, { version: created.version });
    if (issued.status !== "issued") throw new Error("not issued");
    const invoice = issued.invoice;
    const second = await invoiceFor(tenant, customer, "100", "2026-11-02");
    const [lineRow] = (await getInvoice(tenant.ctx, invoice.id)).lines;
    onDay("2026-11-06");
    const first = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "300" }),
    );
    await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "50", allocation: { kind: "MANUAL", items: [] } }),
    );

    const results = await Promise.allSettled([
      recordPayment(tenant.ctx, payment({ customerId: customer.id, amount: "250" })),
      createCreditNote(tenant.ctx, invoice.id, {
        reason: "Goods returned",
        lines: [{ invoiceLineId: lineRow?.id ?? "", qty: "1" }],
      }),
      voidPayment(tenant.ctx, first.payment.id, { reason: "Entered by mistake" }),
      applyCredit(tenant.ctx, customer.id, { allocation: { kind: "AUTO" } }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        // Only a business rule may refuse (e.g. the credit note after everything was paid).
        expect(result.reason).toBeInstanceOf(Error);
        expect(String(result.reason)).not.toMatch(/deadlock/i);
      }
    }
    for (const row of [invoice, second]) {
      const fresh = await invoiceRow(tenant, row);
      expect(fresh.amountPaidPaise + fresh.amountCreditedPaise <= fresh.grandTotalPaise).toBe(true);
    }
  });
});

// --- database guards ---------------------------------------------------------------------

describe("database guards (migration 0009)", () => {
  async function paidSetup() {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer, "100", "2026-11-01");
    onDay("2026-11-06");
    const result = await recordPayment(
      tenant.ctx,
      payment({ customerId: customer.id, amount: "60" }),
    );
    return { tenant, customer, invoice, payment: result.payment };
  }

  it("refuses to change or delete a payment, or to change a voided one", async () => {
    const { tenant, payment: row } = await paidSetup();
    const where = and(eq(payments.businessId, tenant.business.id), eq(payments.id, row.id));
    expect(await dbMessage(db().update(payments).set({ amountPaise: 1n }).where(where))).toMatch(
      /cannot be changed/,
    );
    expect(await dbMessage(db().delete(payments).where(where))).toMatch(/cannot be deleted/);
    await voidPayment(tenant.ctx, row.id, { reason: "Entered by mistake" });
    expect(await dbMessage(db().update(payments).set({ notes: "x" }).where(where))).toMatch(
      /is voided/,
    );
  });

  it("refuses allocating more than a payment holds, at commit", async () => {
    const { tenant, customer, payment: row } = await paidSetup();
    const other = await invoiceFor(tenant, customer, "100", "2026-11-06");
    // The ₹60 payment is fully allocated already; one paisa more is refused at commit, even
    // with the invoice's amount paid kept in step.
    expect(
      await dbMessage(
        db().transaction(async (tx) => {
          await tx.insert(paymentAllocations).values({
            businessId: tenant.business.id,
            paymentId: row.id,
            invoiceId: other.id,
            customerId: customer.id,
            amountPaise: 1n,
          });
          await tx
            .update(invoices)
            .set({ amountPaidPaise: 1n, status: "PARTIALLY_PAID" })
            .where(and(eq(invoices.businessId, tenant.business.id), eq(invoices.id, other.id)));
        }),
      ),
    ).toMatch(/more than its/);
  });

  it("refuses an amount paid that doesn't match the allocations", async () => {
    const { tenant, invoice } = await paidSetup();
    expect(
      await dbMessage(
        db()
          .update(invoices)
          .set({ amountPaidPaise: 5_000n })
          .where(and(eq(invoices.businessId, tenant.business.id), eq(invoices.id, invoice.id))),
      ),
    ).toMatch(/paise paid but/);
  });

  it("refuses a status that doesn't match the money", async () => {
    const { tenant, invoice } = await paidSetup();
    await expectViolation(
      db()
        .update(invoices)
        .set({ status: "PAID" })
        .where(and(eq(invoices.businessId, tenant.business.id), eq(invoices.id, invoice.id))),
      "invoices_status_matches_money",
    );
  });

  it("refuses an allocation with neither end, and a void without a reason", async () => {
    const { tenant, customer, payment: row } = await paidSetup();
    await expectViolation(
      db().insert(paymentAllocations).values({
        businessId: tenant.business.id,
        paymentId: null,
        invoiceId: null,
        customerId: customer.id,
        amountPaise: 1n,
      }),
      "payment_allocations_has_an_end",
    );
    await expectViolation(
      db()
        .update(payments)
        .set({ voidedAt: new Date(), voidedBy: tenant.ctx.userId })
        .where(and(eq(payments.businessId, tenant.business.id), eq(payments.id, row.id))),
      "payments_voided_fields",
    );
  });
});

// --- isolation ---------------------------------------------------------------------------

async function ownerWithInvoice(owner: Tenant) {
  const customer = await addCustomer(owner, 1_000n);
  const invoice = await invoiceFor(owner, customer, "100", "2026-11-01");
  onDay("2026-11-06");
  const paid = await recordPayment(owner.ctx, payment({ customerId: customer.id, amount: "120" }));
  return { id: paid.payment.id, customer, invoice };
}

async function unchanged(owner: Tenant, arranged: Awaited<ReturnType<typeof ownerWithInvoice>>) {
  expect(await invoiceRow(owner, arranged.invoice)).toMatchObject({
    status: "PAID",
    amountPaidPaise: 10_000n,
  });
  const [row] = await db()
    .select()
    .from(payments)
    .where(and(eq(payments.businessId, owner.business.id), eq(payments.id, arranged.id)));
  expect(row?.voidedAt).toBeNull();
}

describe("payment.service tenant isolation", () => {
  itIsolatesTenants({
    "recordPayment (owner's customer)": isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { customer }) =>
        recordPayment(intruder.ctx, payment({ customerId: customer.id })),
      verify: unchanged,
    }),
    "recordPayment (owner's invoice in a manual allocation)": isolationCase({
      arrange: ownerWithInvoice,
      act: async (intruder, { invoice }) => {
        const mine = await addCustomer(intruder);
        return recordPayment(
          intruder.ctx,
          payment({
            customerId: mine.id,
            allocation: { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount: "1" }] },
          }),
        );
      },
      verify: unchanged,
    }),
    "recordPayment (owner's walk-in invoice)": isolationCase({
      arrange: async (owner) => {
        const invoice = await invoiceFor(owner, null, "10", "2026-11-06");
        return { id: invoice.id };
      },
      act: (intruder, { id }) =>
        recordPayment(
          intruder.ctx,
          payment({
            amount: "10",
            allocation: { kind: "MANUAL", items: [{ invoiceId: id, amount: "10" }] },
          }),
        ),
    }),
    applyCredit: isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { customer }) =>
        applyCredit(intruder.ctx, customer.id, { allocation: { kind: "AUTO" } }),
      verify: unchanged,
    }),
    voidPayment: isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { id }) => voidPayment(intruder.ctx, id, { reason: "Entered by mistake" }),
      verify: unchanged,
    }),
    getPayment: isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { id }) => getPayment(intruder.ctx, id),
    }),
    listPayments: isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { customer }) => listPayments(intruder.ctx, { customer: customer.id }),
    }),
    "getPaymentOptions (customer)": isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { customer }) => getPaymentOptions(intruder.ctx, { customerId: customer.id }),
    }),
    "getPaymentOptions (invoice)": isolationCase({
      arrange: ownerWithInvoice,
      act: (intruder, { invoice }) => getPaymentOptions(intruder.ctx, { invoiceId: invoice.id }),
    }),
  });
});
