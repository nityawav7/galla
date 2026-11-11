/**
 * What is left of a customer's opening balance, and the money they have on account (ADR 0010).
 * The opening balance is one signed number: owed (positive) can be paid by payments, an advance
 * (negative) can pay invoices, through allocation rows with a null end.
 */

export interface CustomerCreditInput {
  /** Signed: positive = owed, negative = advance. */
  openingBalancePaise: bigint;
  /** Σ allocations towards the opening balance owed (live payments only). */
  appliedToOpeningPaise: bigint;
  /** Σ allocations paid from the opening advance. */
  appliedFromOpeningPaise: bigint;
  /** Σ of live payments' amounts not allocated to anything. */
  unallocatedPaise: bigint;
}

export interface CustomerCredit {
  /** The opening balance still owed. */
  openingOwedPaise: bigint;
  /** The opening advance not used yet. */
  advanceLeftPaise: bigint;
  /** Advance left + unallocated payments: money that can still pay invoices. */
  onAccountPaise: bigint;
}

export function customerCredit(input: CustomerCreditInput): CustomerCredit {
  const owed = input.openingBalancePaise > 0n ? input.openingBalancePaise : 0n;
  const advance = input.openingBalancePaise < 0n ? -input.openingBalancePaise : 0n;
  const openingOwed = owed - input.appliedToOpeningPaise;
  const advanceLeft = advance - input.appliedFromOpeningPaise;
  if (openingOwed < 0n || advanceLeft < 0n || input.unallocatedPaise < 0n) {
    throw new RangeError("More was applied to or from the opening balance than it holds");
  }
  return {
    openingOwedPaise: openingOwed,
    advanceLeftPaise: advanceLeft,
    onAccountPaise: advanceLeft + input.unallocatedPaise,
  };
}
