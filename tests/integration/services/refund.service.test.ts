import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { liveAllocationsForInvoice } from "@/server/db/repos/payments.repo";
import { insertRefund } from "@/server/db/repos/refunds.repo";
import { withTransaction } from "@/server/db/transaction";
import { createCreditNote, getCreditNote } from "@/server/services/credit-note.service";
import { updateCustomer } from "@/server/services/customer.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import { getCustomerBalances, getCustomerLedger } from "@/server/services/ledger.service";
import { recordPayment, voidPayment } from "@/server/services/payment.service";
import { listRefunds, refundCredit, voidRefund } from "@/server/services/refund.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

const TODAY = "2026-11-11";

function onDay(date: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:00:00Z`));
}

const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

function addCustomer(tenant: Tenant, openingBalancePaise = 0n): Promise<Customer> {
  return insertCustomer(getDb(), tenant.ctx, {
    name: "Mehta Traders",
    openingBalancePaise,
    creditDays: 0,
  });
}

function line(qty = "2", rupees = "100"): Partial<DraftLine> {
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

/** 2 × ₹100, no tax: ₹200. */
async function invoiceFor(tenant: Tenant, customer: Customer | null): Promise<Invoice> {
  onDay(TODAY);
  const draft = await createDraft(tenant.ctx, {
    customerId: customer?.id ?? null,
    ...(customer ? {} : { walkInName: "Counter sale" }),
    lines: [line()],
  });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

function pay(
  tenant: Tenant,
  customer: Customer | null,
  invoice: Invoice | null,
  amount: string,
  date = TODAY,
) {
  onDay(TODAY);
  return recordPayment(tenant.ctx, {
    customerId: customer?.id ?? null,
    amount,
    paymentDate: date,
    mode: "CASH",
    allocation: invoice
      ? { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount }] }
      : { kind: "AUTO" },
  });
}

async function creditOne(tenant: Tenant, invoice: Invoice, extra: Record<string, unknown> = {}) {
  const [first] = (await getInvoice(tenant.ctx, invoice.id)).lines;
  onDay(TODAY);
  return createCreditNote(tenant.ctx, invoice.id, {
    reason: "Goods returned",
    lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
    ...extra,
  });
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

async function dbMessage(promise: Promise<unknown>): Promise<string> {
  let current = await rejection(promise);
  const messages: string[] = [];
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" | ");
}

async function onAccount(tenant: Tenant, customer: Customer): Promise<bigint> {
  return (await getCustomerLedger(tenant.ctx, customer.id)).credit.onAccountPaise;
}

function refund(tenant: Tenant, customer: Customer, amount: string, date = TODAY) {
  onDay(TODAY);
  return refundCredit(tenant.ctx, customer.id, { amount, refundDate: date, mode: "UPI" });
}

// --- credit notes on paid invoices --------------------------------------------------------

describe("createCreditNote on a paid invoice (ADR 0011)", () => {
  it("releases what was overpaid, newest payment first, onto the customer's account", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer);
    const older = await pay(tenant, customer, invoice, "150", "2026-11-01");
    const newer = await pay(tenant, customer, invoice, "50", "2026-11-05");

    const note = await creditOne(tenant, invoice);
    expect(note.grandTotalPaise).toBe(10_000n);
    const after = await findInvoiceById(getDb(), tenant.ctx, invoice.id);
    expect(after).toMatchObject({
      status: "PAID",
      amountPaidPaise: 10_000n,
      amountCreditedPaise: 10_000n,
    });
    // The ₹50 payment goes back first, then ₹50 of the ₹150 one.
    const left = await liveAllocationsForInvoice(getDb(), tenant.ctx, invoice.id);
    expect(left.map((row) => [row.paymentId, row.amountPaise])).toEqual([
      [older.payment.id, 10_000n],
    ]);
    expect(newer.payment.id).not.toBe(older.payment.id);
    expect(await onAccount(tenant, customer)).toBe(10_000n);
    const ledger = await getCustomerLedger(tenant.ctx, customer.id);
    expect(ledger.ledger.closingPaise).toBe(-10_000n);

    const [audit] = await listAuditLogs(getDb(), tenant.ctx, {
      entity: "creditNote",
      entityId: note.id,
    });
    expect(audit?.diff).toMatchObject({
      after: {
        releasedPaise: "10000",
        released: [
          { paymentId: newer.payment.id, amountPaise: "5000" },
          { paymentId: older.payment.id, amountPaise: "5000" },
        ],
        refundId: null,
      },
    });
  });

  it("on a part-paid invoice releases only what goes beyond the new total", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer);
    await pay(tenant, customer, invoice, "150");
    await creditOne(tenant, invoice);
    expect(await findInvoiceById(getDb(), tenant.ctx, invoice.id)).toMatchObject({
      status: "PAID",
      amountPaidPaise: 10_000n,
      amountCreditedPaise: 10_000n,
    });
    expect(await onAccount(tenant, customer)).toBe(5_000n);
  });

  it("crediting everything back leaves nothing paid and all of it on account", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer);
    await pay(tenant, customer, invoice, "200");
    await creditOne(tenant, invoice);
    await creditOne(tenant, invoice);
    expect(await findInvoiceById(getDb(), tenant.ctx, invoice.id)).toMatchObject({
      status: "ISSUED",
      amountPaidPaise: 0n,
      amountCreditedPaise: 20_000n,
    });
    expect(await onAccount(tenant, customer)).toBe(20_000n);
    // Nothing left to return.
    expect(await issuesOf(creditOne(tenant, invoice))).toEqual([
      { path: "lines.0.qty", message: "returnTooMany" },
    ]);
  });

  it("a walk-in sale asks how the money was given back, and records that refund", async () => {
    const tenant = await createTenant();
    const invoice = await invoiceFor(tenant, null);
    const paid = await pay(tenant, null, invoice, "200");
    expect(await issuesOf(creditOne(tenant, invoice))).toEqual([
      { path: "refund.mode", message: "refundModeRequired" },
    ]);

    const note = await creditOne(tenant, invoice, { refund: { mode: "UPI", reference: "UTR9" } });
    const { refunds } = await getCreditNote(tenant.ctx, note.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      customerId: null,
      creditNoteId: note.id,
      amountPaise: 10_000n,
      mode: "UPI",
      reference: "UTR9",
    });
    const left = await liveAllocationsForInvoice(getDb(), tenant.ctx, invoice.id);
    expect(left).toMatchObject([{ paymentId: paid.payment.id, amountPaise: 10_000n }]);
    expect(await conflictOf(voidRefund(tenant.ctx, refunds[0]?.id ?? "", { reason: "Oops" }))).toBe(
      "walkInRefundFinal",
    );
  });

  it("an unpaid invoice needs no refund, even for a walk-in", async () => {
    const tenant = await createTenant();
    const invoice = await invoiceFor(tenant, null);
    const note = await creditOne(tenant, invoice);
    expect((await getCreditNote(tenant.ctx, note.id)).refunds).toEqual([]);
  });

  it("a credit note and a payment on the same customer at once stay consistent", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant);
    const invoice = await invoiceFor(tenant, customer);
    await pay(tenant, customer, invoice, "200");
    const second = await invoiceFor(tenant, customer);
    const [first] = (await getInvoice(tenant.ctx, invoice.id)).lines;
    onDay(TODAY);
    await Promise.all([
      createCreditNote(tenant.ctx, invoice.id, {
        reason: "Goods returned",
        lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
      }),
      recordPayment(tenant.ctx, {
        customerId: customer.id,
        amount: "80",
        paymentDate: TODAY,
        mode: "CASH",
        allocation: { kind: "MANUAL", items: [{ invoiceId: second.id, amount: "80" }] },
      }),
    ]);
    expect(await onAccount(tenant, customer)).toBe(10_000n);
    const ledger = await getCustomerLedger(tenant.ctx, customer.id);
    // ₹200 + ₹200 − ₹100 credit − ₹200 − ₹80 paid.
    expect(ledger.ledger.closingPaise).toBe(2_000n);
  });
});

// --- refunds -------------------------------------------------------------------------------

describe("refundCredit and voidRefund", () => {
  it("pays back money on account; the ledger shows it as a debit", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -30_000n);
    const made = await refund(tenant, customer, "120");
    expect(made).toMatchObject({ amountPaise: 12_000n, mode: "UPI", customerId: customer.id });
    expect(await onAccount(tenant, customer)).toBe(18_000n);

    const view = await getCustomerLedger(tenant.ctx, customer.id);
    expect(view.ledger.rows.at(-1)).toMatchObject({
      kind: "REFUND",
      id: made.id,
      debitPaise: 12_000n,
      balancePaise: -18_000n,
    });
    expect(view.payments[made.id]).toEqual({ mode: "UPI", reference: null });
    expect(view.aging.totalPaise).toBe(-18_000n);
    expect((await getCustomerBalances(tenant.ctx, [customer.id])).get(customer.id)).toBe(-18_000n);
    expect(await listRefunds(tenant.ctx, customer.id)).toHaveLength(1);

    const [audit] = await listAuditLogs(getDb(), tenant.ctx, {
      entity: "refund",
      entityId: made.id,
    });
    expect(audit).toMatchObject({ action: "refund.recorded" });
  });

  it("never pays back more than is on account, nor dates it in the future", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -10_000n);
    expect(await issuesOf(refund(tenant, customer, "100.01"))).toEqual([
      { path: "amount", message: "refundExceedsOnAccount" },
    ]);
    expect(await issuesOf(refund(tenant, customer, "10", "2026-11-12"))).toEqual([
      { path: "refundDate", message: "paymentDateFuture" },
    ]);
    const owes = await addCustomer(tenant, 5_000n);
    expect(await issuesOf(refund(tenant, owes, "1"))).toEqual([
      { path: "amount", message: "refundExceedsOnAccount" },
    ]);
  });

  it("two refunds of everything at once: only one goes through", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -10_000n);
    const outcomes = await Promise.allSettled([
      refund(tenant, customer, "100"),
      refund(tenant, customer, "100"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await onAccount(tenant, customer)).toBe(0n);
  });

  it("voiding a refund puts the money back on account; only once, owner only", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -10_000n);
    const made = await refund(tenant, customer, "100");
    await expect(
      voidRefund(as(tenant, "STAFF").ctx, made.id, { reason: "Entered by mistake" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      refundCredit(as(tenant, "STAFF").ctx, customer.id, {
        amount: "1",
        refundDate: TODAY,
        mode: "CASH",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const voided = await voidRefund(tenant.ctx, made.id, { reason: "Entered by mistake" });
    expect(voided.voidReason).toBe("Entered by mistake");
    expect(await onAccount(tenant, customer)).toBe(10_000n);
    expect(await conflictOf(voidRefund(tenant.ctx, made.id, { reason: "Again" }))).toBe(
      "refundAlreadyVoided",
    );
    await expect(
      voidRefund(tenant.ctx, "019a0000-0000-7000-8000-000000000000", { reason: "Nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a payment whose money was refunded can't be voided until the refund is", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant);
    const paid = await pay(tenant, customer, null, "100");
    const made = await refund(tenant, customer, "60");
    expect(
      await conflictOf(voidPayment(tenant.ctx, paid.payment.id, { reason: "Cheque bounced" })),
    ).toBe("refundFirst");
    await voidRefund(tenant.ctx, made.id, { reason: "Entered by mistake" });
    await voidPayment(tenant.ctx, paid.payment.id, { reason: "Cheque bounced" });
    expect(await onAccount(tenant, customer)).toBe(0n);
  });

  it("the opening advance can't be cut below what was refunded from it", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -10_000n);
    await refund(tenant, customer, "80");
    expect(
      await issuesOf(
        updateCustomer(tenant.ctx, customer.id, {
          name: "Mehta Traders",
          phone: "",
          email: "",
          gstin: "",
          billingAddressLine1: "",
          billingAddressLine2: "",
          billingCity: "",
          billingPincode: "",
          billingStateCode: "",
          shippingAddressLine1: "",
          shippingAddressLine2: "",
          shippingCity: "",
          shippingPincode: "",
          shippingStateCode: "",
          balanceType: "ADVANCE",
          openingBalance: "50",
          creditDays: "",
          stateOverride: false,
          confirmDuplicatePhone: false,
        }),
      ),
    ).toEqual([{ path: "openingBalance", message: "openingBalanceApplied" }]);
  });

  it("the database refuses a refund beyond what is on account, whatever the code does", async () => {
    const tenant = await createTenant();
    const customer = await addCustomer(tenant, -10_000n);
    const message = await dbMessage(
      withTransaction((tx) =>
        insertRefund(tx, tenant.ctx, {
          customerId: customer.id,
          creditNoteId: null,
          refundDate: TODAY,
          amountPaise: 10_001n,
          mode: "CASH",
          reference: null,
          notes: null,
        }),
      ),
    );
    expect(message).toContain("refunded but 10000 paise on account");
  });
});

// --- isolation ----------------------------------------------------------------------------

describe("refund.service tenant isolation", () => {
  itIsolatesTenants({
    refundCredit: isolationCase({
      arrange: (owner) => addCustomer(owner, -10_000n),
      act: (intruder, customer) =>
        refundCredit(intruder.ctx, customer.id, { amount: "1", refundDate: TODAY, mode: "CASH" }),
      verify: async (owner, customer) => {
        expect(await onAccount(owner, customer)).toBe(10_000n);
      },
    }),
    voidRefund: isolationCase({
      arrange: async (owner) => {
        const customer = await addCustomer(owner, -10_000n);
        const made = await refund(owner, customer, "10");
        return { id: made.id, customer };
      },
      act: (intruder, arranged) => voidRefund(intruder.ctx, arranged.id, { reason: "Mine now" }),
      verify: async (owner, arranged) => {
        expect(await onAccount(owner, arranged.customer)).toBe(9_000n);
      },
    }),
    listRefunds: isolationCase({
      arrange: async (owner) => {
        const customer = await addCustomer(owner, -10_000n);
        await refund(owner, customer, "10");
        return customer;
      },
      act: (intruder, customer) => listRefunds(intruder.ctx, customer.id),
    }),
  });
});
