/**
 * How a payment is split over what a customer owes (SPEC F7, §4.9, ADR 0010). Pure: the payment
 * service loads the open items under row locks and writes what these functions return.
 *
 * An open item is an issued invoice with a balance, or the customer's opening balance still owed
 * (`invoiceId: null`). Nothing is ever allocated beyond an item's balance; what is left of the
 * payment stays "on account" with the customer.
 */

import { ValidationError, type FieldIssue } from "@/lib/errors";

import { sumPaise } from "../money";

export interface OpenItem {
  /** Null for the customer's opening balance owed. */
  invoiceId: string | null;
  /** The invoice date; ignored for the opening balance, which is always the oldest. */
  invoiceDate: string | null;
  number: string | null;
  balancePaise: bigint;
}

export interface Allocation {
  /** Null = towards the opening balance owed. */
  invoiceId: string | null;
  amountPaise: bigint;
}

export interface AllocationResult {
  allocations: Allocation[];
  onAccountPaise: bigint;
}

/** Validation keys (under `validation` in src/messages). */
export type AllocationProblem =
  | "allocationAmountPositive"
  | "allocationExceedsBalance"
  | "allocationExceedsPayment"
  | "invoiceNotOpen"
  | "duplicateInvoice";

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", "en");
}

/**
 * Oldest first (decision 2 of the Phase 8 plan): the opening balance, then invoices by invoice
 * date, then number, then id. Items with nothing due are left out.
 */
export function oldestFirst(items: readonly OpenItem[]): OpenItem[] {
  return items
    .filter((item) => item.balancePaise > 0n)
    .sort((a, b) => {
      if (a.invoiceId === null || b.invoiceId === null) {
        return (a.invoiceId === null ? 0 : 1) - (b.invoiceId === null ? 0 : 1);
      }
      return (
        compareText(a.invoiceDate, b.invoiceDate) ||
        compareText(a.number, b.number) ||
        compareText(a.invoiceId, b.invoiceId)
      );
    });
}

/** Pays the oldest items first; the rest of the amount stays on account. */
export function autoAllocate(amountPaise: bigint, items: readonly OpenItem[]): AllocationResult {
  if (amountPaise < 0n) throw new RangeError("Amount must not be negative");
  let left = amountPaise;
  const allocations: Allocation[] = [];
  for (const item of oldestFirst(items)) {
    if (left === 0n) break;
    const share = item.balancePaise < left ? item.balancePaise : left;
    allocations.push({ invoiceId: item.invoiceId, amountPaise: share });
    left -= share;
  }
  return { allocations, onAccountPaise: left };
}

/**
 * Checks allocations chosen by hand: each target must be open, each amount above zero and within
 * that item's balance, no target twice, and together within the payment. Throws every problem at
 * once, with paths `items.{i}.amount` / `items.{i}.invoiceId` / `amount`.
 */
export function checkManualAllocation(
  amountPaise: bigint,
  requested: readonly Allocation[],
  items: readonly OpenItem[],
): AllocationResult {
  const open = new Map(oldestFirst(items).map((item) => [item.invoiceId, item]));
  const seen = new Set<string | null>();
  const issues: FieldIssue[] = [];
  const problem = (path: string, message: AllocationProblem) => issues.push({ path, message });

  requested.forEach((allocation, index) => {
    const path = `items.${String(index)}`;
    const item = open.get(allocation.invoiceId);
    if (seen.has(allocation.invoiceId)) {
      problem(`${path}.invoiceId`, "duplicateInvoice");
      return;
    }
    seen.add(allocation.invoiceId);
    if (!item) {
      problem(`${path}.invoiceId`, "invoiceNotOpen");
      return;
    }
    if (allocation.amountPaise <= 0n) problem(`${path}.amount`, "allocationAmountPositive");
    else if (allocation.amountPaise > item.balancePaise) {
      problem(`${path}.amount`, "allocationExceedsBalance");
    }
  });

  const allocated = sumPaise(requested.map((allocation) => allocation.amountPaise));
  if (issues.length === 0 && allocated > amountPaise) problem("amount", "allocationExceedsPayment");
  if (issues.length > 0) throw new ValidationError("Check how the payment is applied", issues);

  return {
    allocations: requested.map(({ invoiceId, amountPaise: share }) => ({
      invoiceId,
      amountPaise: share,
    })),
    onAccountPaise: amountPaise - allocated,
  };
}

/** Money on account, from a payment's unallocated part (`paymentId`) or the opening advance (null). */
export interface CreditSource {
  paymentId: string | null;
  availablePaise: bigint;
}

export interface SourcedAllocation {
  paymentId: string | null;
  invoiceId: string | null;
  amountPaise: bigint;
}

/**
 * Pairs money on account with the allocations it pays ("Apply advance"): sources in the order
 * given (the service passes the opening advance, then payments oldest first), each allocation
 * taking from as many sources as it needs. The allocations must not add up to more than the
 * sources; an opening advance can't pay the opening balance (one signed number can't be both).
 */
export function pairWithSources(
  sources: readonly CreditSource[],
  allocations: readonly Allocation[],
): SourcedAllocation[] {
  const left = sources.map((source) => ({ ...source }));
  const pairs: SourcedAllocation[] = [];
  for (const allocation of allocations) {
    let needed = allocation.amountPaise;
    for (const source of left) {
      if (needed === 0n) break;
      const openingPaysItself = allocation.invoiceId === null && source.paymentId === null;
      if (source.availablePaise === 0n || openingPaysItself) continue;
      const take = source.availablePaise < needed ? source.availablePaise : needed;
      pairs.push({
        paymentId: source.paymentId,
        invoiceId: allocation.invoiceId,
        amountPaise: take,
      });
      source.availablePaise -= take;
      needed -= take;
    }
    if (needed > 0n) throw new RangeError("Allocations exceed the money on account");
  }
  return pairs;
}
