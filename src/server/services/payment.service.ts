import { ConflictError, type FieldIssue, NotFoundError, ValidationError } from "@/lib/errors";
import {
  type AllocationInput,
  applyCreditSchema,
  OPENING_BALANCE,
  paymentDateProblem,
  paymentListQuerySchema,
  paymentOptionsQuerySchema,
  type RecordPaymentInput,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/lib/validation/payments";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { decodeDateCursor, encodeDateCursor } from "@/server/db/repos/cursor";
import { type Customer, findCustomerById, lockCustomer } from "@/server/db/repos/customers.repo";
import {
  findInvoiceById,
  findOpenInvoicesForCustomer,
  type Invoice,
  lockInvoice,
  lockInvoices,
  lockOpenInvoicesForCustomer,
  setPaid,
} from "@/server/db/repos/invoices.repo";
import {
  type AllocationRow,
  customerCreditSums,
  findAllocationsForPayments,
  findPaymentById,
  insertAllocations,
  insertPayment,
  listPayments as listPaymentRows,
  lockPayment,
  markVoided,
  type Payment,
  type PaymentListRow,
  unallocatedPayments,
} from "@/server/db/repos/payments.repo";
import { type Executor, type Transaction, withTransaction } from "@/server/db/transaction";
import { istDateFromInstant } from "@/server/domain/fy";
import { balancePaise, type SettledStatus, settledStatus } from "@/server/domain/invoice/status";
import { type CustomerCredit, customerCredit } from "@/server/domain/ledger/customer-credit";
import {
  type Allocation,
  type AllocationResult,
  autoAllocate,
  checkManualAllocation,
  type OpenItem,
  pairWithSources,
  type SourcedAllocation,
} from "@/server/domain/payment/allocation";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * Payments (SPEC F7, §4.9, ADR 0010). Everyone records payments; only the owner voids one.
 * Every write takes row locks in one order, customer → payment → invoices (by id), so payments,
 * voids, "Apply advance" and credit notes on the same customer run one after the other and never
 * deadlock. Nothing is ever allocated beyond an invoice's balance; the rest stays on account.
 * A deferred trigger checks the allocations against the invoices at commit (migration 0009).
 */

export type { AllocationRow, Payment, PaymentListRow };

export const PAYMENTS_PAGE_SIZE = 50;

export interface OpenItemView {
  /** Null for the opening balance owed. */
  invoiceId: string | null;
  number: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  balancePaise: bigint;
}

export interface PaymentOptions {
  /** Null when paying a walk-in invoice. */
  customer: { id: string; name: string } | null;
  /** The invoice the form was opened from, if any. */
  invoiceId: string | null;
  /** Oldest first: the opening balance owed (if any), then open invoices. */
  openItems: OpenItemView[];
  credit: CustomerCredit;
  /** Today in Asia/Kolkata, the default payment date. */
  today: string;
}

export interface InvoiceAfterPayment {
  id: string;
  number: string | null;
  status: SettledStatus;
  balancePaise: bigint;
}

export interface RecordPaymentResult {
  payment: Payment;
  allocations: Allocation[];
  onAccountPaise: bigint;
  invoices: InvoiceAfterPayment[];
}

export interface ApplyCreditResult {
  allocations: SourcedAllocation[];
  onAccountPaise: bigint;
  invoices: InvoiceAfterPayment[];
}

export interface PaymentDetail {
  payment: Payment;
  allocations: AllocationRow[];
  customerName: string | null;
}

export interface PaymentPage {
  items: PaymentListRow[];
  nextCursor: string | null;
}

function invalid(issues: FieldIssue[]): ValidationError {
  return new ValidationError("Some fields need attention", issues);
}

/** Domain issue paths (`items.0.amount`) are relative to the allocation field. */
function prefixIssues<T>(prefix: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    throw invalid(error.issues.map((issue) => ({ ...issue, path: `${prefix}.${issue.path}` })));
  }
}

function toOpenItem(invoice: Invoice): OpenItem {
  return {
    invoiceId: invoice.id,
    invoiceDate: invoice.invoiceDate,
    number: invoice.number,
    balancePaise: balancePaise(invoice),
  };
}

function openingItem(credit: CustomerCredit): OpenItem {
  return {
    invoiceId: null,
    invoiceDate: null,
    number: null,
    balancePaise: credit.openingOwedPaise,
  };
}

function today(): string {
  return istDateFromInstant(now());
}

async function creditOf(db: Executor, ctx: TenantContext, customer: Customer) {
  const sums = await customerCreditSums(db, ctx, customer.id);
  return customerCredit({ openingBalancePaise: customer.openingBalancePaise, ...sums });
}

/**
 * The allocations typed in the form. An invoice id that isn't open for this customer is a field
 * error, but one that isn't this business's at all is NotFound, like any other foreign id.
 */
async function manualAllocations(
  db: Executor,
  ctx: TenantContext,
  allocation: Extract<AllocationInput, { kind: "MANUAL" }>,
  open: readonly OpenItem[],
): Promise<Allocation[]> {
  const known = new Set(open.map((item) => item.invoiceId));
  for (const item of allocation.items) {
    if (item.invoiceId === OPENING_BALANCE || known.has(item.invoiceId)) continue;
    if (!(await findInvoiceById(db, ctx, item.invoiceId))) throw new NotFoundError("Invoice");
  }
  return allocation.items.map((item) => ({
    invoiceId: item.invoiceId === OPENING_BALANCE ? null : item.invoiceId,
    amountPaise: item.amount,
  }));
}

async function allocate(
  db: Executor,
  ctx: TenantContext,
  amountPaise: bigint,
  allocation: AllocationInput,
  open: readonly OpenItem[],
): Promise<AllocationResult> {
  if (allocation.kind === "AUTO") return autoAllocate(amountPaise, open);
  const requested = await manualAllocations(db, ctx, allocation, open);
  return prefixIssues("allocation", () => checkManualAllocation(amountPaise, requested, open));
}

/** Adds each allocation to its (locked) invoice and sets the status that goes with the money. */
async function addToInvoices(
  tx: Transaction,
  ctx: TenantContext,
  locked: readonly Invoice[],
  allocations: readonly { invoiceId: string | null; amountPaise: bigint }[],
): Promise<InvoiceAfterPayment[]> {
  const byId = new Map(locked.map((invoice) => [invoice.id, invoice]));
  const added = new Map<string, bigint>();
  for (const { invoiceId, amountPaise } of allocations) {
    if (invoiceId !== null) added.set(invoiceId, (added.get(invoiceId) ?? 0n) + amountPaise);
  }
  const updated: InvoiceAfterPayment[] = [];
  for (const [invoiceId, amountPaise] of added) {
    const invoice = byId.get(invoiceId);
    if (!invoice) throw new Error("allocated an invoice that wasn't locked");
    updated.push(await movePaid(tx, ctx, invoice, invoice.amountPaidPaise + amountPaise));
  }
  return updated;
}

async function movePaid(
  tx: Transaction,
  ctx: TenantContext,
  invoice: Invoice,
  amountPaidPaise: bigint,
): Promise<InvoiceAfterPayment> {
  const money = { ...invoice, amountPaidPaise };
  const status = settledStatus(money);
  const row = await setPaid(tx, ctx, invoice.id, amountPaidPaise, status);
  if (!row) throw new Error("locked invoice changed while paying");
  return { id: row.id, number: row.number, status, balancePaise: balancePaise(money) };
}

function auditAllocations(allocations: readonly Allocation[]) {
  return allocations.map((allocation) => ({
    invoiceId: allocation.invoiceId,
    amountPaise: allocation.amountPaise.toString(),
  }));
}

// --- reads -------------------------------------------------------------------------------

/**
 * What the record-payment form needs: the customer's open items oldest first and their money on
 * account; from a walk-in invoice, just that invoice.
 */
export async function getPaymentOptions(
  ctx: TenantContext,
  query: unknown,
): Promise<PaymentOptions> {
  assertCan(ctx, "payment:record");
  const { customerId, invoiceId } = parseInput(paymentOptionsQuerySchema, query);
  const db = getDb();
  const noCredit: CustomerCredit = {
    openingOwedPaise: 0n,
    advanceLeftPaise: 0n,
    onAccountPaise: 0n,
  };

  let id = customerId;
  if (invoiceId !== null) {
    const invoice = await findInvoiceById(db, ctx, invoiceId);
    if (!invoice || invoice.status === "DRAFT") throw new NotFoundError("Invoice");
    if (invoice.customerId === null) {
      const open =
        ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && balancePaise(invoice) > 0n;
      return {
        customer: null,
        invoiceId: invoice.id,
        openItems: open ? [{ ...toOpenItem(invoice), dueDate: invoice.dueDate }] : [],
        credit: noCredit,
        today: today(),
      };
    }
    id = invoice.customerId;
  }
  if (id === null) throw new NotFoundError("Customer");
  const customer = await findCustomerById(db, ctx, id);
  if (!customer) throw new NotFoundError("Customer");
  const [open, credit] = await Promise.all([
    findOpenInvoicesForCustomer(db, ctx, customer.id),
    creditOf(db, ctx, customer),
  ]);
  const openItems: OpenItemView[] = open.map((invoice) => ({
    ...toOpenItem(invoice),
    dueDate: invoice.dueDate,
  }));
  if (credit.openingOwedPaise > 0n) {
    openItems.unshift({ ...openingItem(credit), dueDate: null });
  }
  return {
    customer: { id: customer.id, name: customer.name },
    invoiceId,
    openItems,
    credit,
    today: today(),
  };
}

export async function getPayment(ctx: TenantContext, id: string): Promise<PaymentDetail> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const payment = await findPaymentById(db, ctx, requireId(id, "Payment"));
  if (!payment) throw new NotFoundError("Payment");
  const [allocations, customer] = await Promise.all([
    findAllocationsForPayments(db, ctx, [payment.id]),
    payment.customerId ? findCustomerById(db, ctx, payment.customerId) : undefined,
  ]);
  return { payment, allocations, customerName: customer?.name ?? null };
}

export async function listPayments(ctx: TenantContext, query: unknown): Promise<PaymentPage> {
  assertCan(ctx, "records:view");
  const { customer, from, to, cursor } = paymentListQuerySchema.parse(query);
  const rows = await listPaymentRows(getDb(), ctx, {
    customerId: customer,
    from,
    to,
    limit: PAYMENTS_PAGE_SIZE + 1,
    after: decodeDateCursor(cursor),
  });
  const items = rows.slice(0, PAYMENTS_PAGE_SIZE);
  const last = items.at(-1)?.payment;
  const hasMore = rows.length > PAYMENTS_PAGE_SIZE && last !== undefined;
  return {
    items,
    nextCursor: hasMore ? encodeDateCursor({ date: last.paymentDate, id: last.id }) : null,
  };
}

// --- writes ------------------------------------------------------------------------------

/** A walk-in invoice paid at the counter: the whole payment goes to that one invoice. */
async function recordWalkIn(
  tx: Transaction,
  ctx: TenantContext,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  // Exactly one invoice named by hand: there is no customer to pick "oldest first" from.
  const items = input.allocation.kind === "MANUAL" ? input.allocation.items : [];
  const only = items.length === 1 ? items[0] : undefined;
  if (!only || only.invoiceId === OPENING_BALANCE) {
    throw invalid([{ path: "allocation", message: "walkInPaymentInvalid" }]);
  }
  const invoice = await lockInvoice(tx, ctx, only.invoiceId);
  if (!invoice || invoice.status === "DRAFT") throw new NotFoundError("Invoice");
  if (invoice.customerId !== null) {
    throw invalid([{ path: "customerId", message: "customerRequired" }]);
  }
  const open = ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) ? [toOpenItem(invoice)] : [];
  const result = prefixIssues("allocation", () =>
    checkManualAllocation(
      input.amount,
      [{ invoiceId: invoice.id, amountPaise: only.amount }],
      open,
    ),
  );
  if (result.onAccountPaise !== 0n) {
    // No customer, so no account to keep the rest on.
    throw invalid([{ path: "amount", message: "walkInPaymentInvalid" }]);
  }
  const payment = await insertPayment(tx, ctx, {
    customerId: null,
    paymentDate: input.paymentDate,
    amountPaise: input.amount,
    mode: input.mode,
    reference: input.reference,
    notes: input.notes,
  });
  await insertAllocations(tx, ctx, [
    { paymentId: payment.id, invoiceId: invoice.id, customerId: null, amountPaise: input.amount },
  ]);
  const invoices = await addToInvoices(tx, ctx, [invoice], result.allocations);
  await auditRecorded(tx, ctx, payment, result);
  return { payment, allocations: result.allocations, onAccountPaise: 0n, invoices };
}

async function auditRecorded(
  tx: Transaction,
  ctx: TenantContext,
  payment: Payment,
  result: AllocationResult,
): Promise<void> {
  await insertAuditLog(tx, ctx, {
    entity: "payment",
    entityId: payment.id,
    action: "payment.recorded",
    diff: {
      after: {
        customerId: payment.customerId,
        paymentDate: payment.paymentDate,
        amountPaise: payment.amountPaise.toString(),
        mode: payment.mode,
        allocations: auditAllocations(result.allocations),
        onAccountPaise: result.onAccountPaise.toString(),
      },
    },
  });
}

/**
 * Records a payment (SPEC F7) and splits it over the customer's open items: oldest first, or as
 * chosen. An invoice never gets more than its balance; the rest stays on account.
 */
export async function recordPayment(
  ctx: TenantContext,
  input: unknown,
): Promise<RecordPaymentResult> {
  assertCan(ctx, "payment:record");
  const parsed = parseInput(recordPaymentSchema, input);
  const dateProblem = paymentDateProblem(parsed.paymentDate, today());
  if (dateProblem) throw invalid([{ path: "paymentDate", message: dateProblem }]);

  return withTransaction(async (tx) => {
    if (parsed.customerId === null) return recordWalkIn(tx, ctx, parsed);
    const customer = await lockCustomer(tx, ctx, parsed.customerId);
    if (!customer) throw new NotFoundError("Customer");
    const locked = await lockOpenInvoicesForCustomer(tx, ctx, customer.id);
    const credit = await creditOf(tx, ctx, customer);
    const open = [openingItem(credit), ...locked.map(toOpenItem)];
    const result = await allocate(tx, ctx, parsed.amount, parsed.allocation, open);

    const payment = await insertPayment(tx, ctx, {
      customerId: customer.id,
      paymentDate: parsed.paymentDate,
      amountPaise: parsed.amount,
      mode: parsed.mode,
      reference: parsed.reference,
      notes: parsed.notes,
    });
    await insertAllocations(
      tx,
      ctx,
      result.allocations.map((allocation) => ({
        paymentId: payment.id,
        invoiceId: allocation.invoiceId,
        customerId: customer.id,
        amountPaise: allocation.amountPaise,
      })),
    );
    const invoices = await addToInvoices(tx, ctx, locked, result.allocations);
    await auditRecorded(tx, ctx, payment, result);
    return {
      payment,
      allocations: result.allocations,
      onAccountPaise: result.onAccountPaise,
      invoices,
    };
  });
}

/**
 * "Apply advance": money the customer has on account (the opening advance first, then payments
 * oldest first) pays open items, oldest first or as chosen.
 */
export async function applyCredit(
  ctx: TenantContext,
  customerId: string,
  input: unknown,
): Promise<ApplyCreditResult> {
  assertCan(ctx, "payment:record");
  const id = requireId(customerId, "Customer");
  const { allocation } = parseInput(applyCreditSchema, input);

  return withTransaction(async (tx) => {
    const customer = await lockCustomer(tx, ctx, id);
    if (!customer) throw new NotFoundError("Customer");
    const locked = await lockOpenInvoicesForCustomer(tx, ctx, customer.id);
    const [credit, unallocated] = await Promise.all([
      creditOf(tx, ctx, customer),
      unallocatedPayments(tx, ctx, customer.id),
    ]);
    if (credit.onAccountPaise === 0n) throw new ConflictError("nothingOnAccount");
    const open = [openingItem(credit), ...locked.map(toOpenItem)];
    const result = await allocate(tx, ctx, credit.onAccountPaise, allocation, open);
    if (result.allocations.length === 0) throw new ConflictError("invoiceNotOpen");

    const pairs = pairWithSources(
      [
        { paymentId: null, availablePaise: credit.advanceLeftPaise },
        ...unallocated.map((row) => ({
          paymentId: row.paymentId,
          availablePaise: row.availablePaise,
        })),
      ],
      result.allocations,
    );
    await insertAllocations(
      tx,
      ctx,
      pairs.map((pair) => ({ ...pair, customerId: customer.id })),
    );
    const invoices = await addToInvoices(tx, ctx, locked, pairs);
    await insertAuditLog(tx, ctx, {
      entity: "customer",
      entityId: customer.id,
      action: "payment.applied",
      diff: {
        after: {
          allocations: pairs.map((pair) => ({
            paymentId: pair.paymentId,
            invoiceId: pair.invoiceId,
            amountPaise: pair.amountPaise.toString(),
          })),
          onAccountPaise: result.onAccountPaise.toString(),
        },
      },
    });
    return { allocations: pairs, onAccountPaise: result.onAccountPaise, invoices };
  });
}

/**
 * Voids a payment (owner only, decision 6): it stays in the list struck through, its allocations
 * stop counting, and each invoice it paid goes back to the status its money now gives.
 */
export async function voidPayment(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<Payment> {
  assertCan(ctx, "payment:void");
  const paymentId = requireId(id, "Payment");
  const { reason } = parseInput(voidPaymentSchema, input);

  return withTransaction(async (tx) => {
    // Lock order: the customer first, then the payment, then its invoices.
    const found = await findPaymentById(tx, ctx, paymentId);
    if (!found) throw new NotFoundError("Payment");
    if (found.customerId !== null) await lockCustomer(tx, ctx, found.customerId);
    const payment = await lockPayment(tx, ctx, paymentId);
    if (!payment) throw new NotFoundError("Payment");
    if (payment.voidedAt !== null) throw new ConflictError("paymentAlreadyVoided");

    const allocations = await findAllocationsForPayments(tx, ctx, [payment.id]);
    const toInvoices = allocations.filter(
      (row): row is AllocationRow & { invoiceId: string } => row.invoiceId !== null,
    );
    const locked = await lockInvoices(
      tx,
      ctx,
      toInvoices.map((row) => row.invoiceId),
    );
    const byId = new Map(locked.map((invoice) => [invoice.id, invoice]));
    const invoices: InvoiceAfterPayment[] = [];
    for (const row of toInvoices) {
      const invoice = byId.get(row.invoiceId);
      if (!invoice) throw new Error("paid invoice vanished");
      invoices.push(await movePaid(tx, ctx, invoice, invoice.amountPaidPaise - row.amountPaise));
    }
    const voided = await markVoided(tx, ctx, payment.id, { voidedAt: now(), voidReason: reason });
    if (!voided) throw new Error("locked payment changed while voiding");
    await insertAuditLog(tx, ctx, {
      entity: "payment",
      entityId: payment.id,
      action: "payment.voided",
      diff: {
        before: { voided: false },
        after: {
          voided: true,
          reason,
          amountPaise: payment.amountPaise.toString(),
          released: auditAllocations(allocations),
          invoiceStatuses: invoices.map((invoice) => ({ id: invoice.id, status: invoice.status })),
        },
      },
    });
    return voided;
  });
}
