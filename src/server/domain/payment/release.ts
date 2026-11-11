/**
 * A credit note on a paid invoice (ADR 0011, decision 12 of the Phase 8 plan): what was paid
 * beyond the invoice's new total is released from its allocations and becomes money on account
 * (or, for a walk-in sale, is refunded at once). Newest payment first, so the oldest money stays
 * where it was put; the opening advance, the oldest money of all, goes last.
 */

export interface PaidAllocation {
  /** Null = paid from the customer's opening advance. */
  paymentId: string | null;
  /** The payment's date; null for the opening advance. */
  paymentDate: string | null;
  amountPaise: bigint;
}

export interface Release {
  paymentId: string | null;
  amountPaise: bigint;
}

function newestFirst(a: PaidAllocation, b: PaidAllocation): number {
  if (a.paymentId === null || b.paymentId === null) {
    return (a.paymentId === null ? 1 : 0) - (b.paymentId === null ? 1 : 0);
  }
  // Ids are UUIDv7, so on the same date a later id is a later payment.
  return (
    (b.paymentDate ?? "").localeCompare(a.paymentDate ?? "") ||
    b.paymentId.localeCompare(a.paymentId)
  );
}

/**
 * Which allocations give back how much so that exactly `excessPaise` is released. RangeError when
 * the invoice's live allocations hold less than that (the service locked them, so it never does).
 */
export function releaseAllocations(
  excessPaise: bigint,
  allocations: readonly PaidAllocation[],
): Release[] {
  if (excessPaise < 0n) throw new RangeError("Nothing negative can be released");
  const released: Release[] = [];
  let left = excessPaise;
  for (const row of [...allocations].sort(newestFirst)) {
    if (left === 0n) break;
    const take = row.amountPaise < left ? row.amountPaise : left;
    released.push({ paymentId: row.paymentId, amountPaise: take });
    left -= take;
  }
  if (left > 0n) throw new RangeError("The invoice's payments hold less than the excess");
  return released;
}
