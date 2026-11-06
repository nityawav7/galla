/**
 * Invoice balance and the status shown to people (SPEC §4.8). OVERDUE and CREDITED are worked
 * out when shown, never stored.
 */

export const STORED_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];

export type DisplayStatus = StoredStatus | "OVERDUE" | "CREDITED";

export interface InvoiceMoney {
  grandTotalPaise: bigint;
  amountPaidPaise: bigint;
  amountCreditedPaise: bigint;
}

/** balance = grand total − payments allocated − credit notes. */
export function balancePaise(invoice: InvoiceMoney): bigint {
  return invoice.grandTotalPaise - invoice.amountPaidPaise - invoice.amountCreditedPaise;
}

export interface DisplayStatusInput extends InvoiceMoney {
  status: StoredStatus;
  /** ISO date, or null when there is no due date (a walk-in cash sale). */
  dueDate: string | null;
  /** Today in Asia/Kolkata, as an ISO date. */
  today: string;
}

export function displayStatus(input: DisplayStatusInput): DisplayStatus {
  if (input.status === "DRAFT" || input.status === "CANCELLED") return input.status;
  const balance = balancePaise(input);
  if (balance <= 0n) {
    if (input.amountPaidPaise > 0n) return "PAID";
    if (input.amountCreditedPaise > 0n) return "CREDITED";
    return input.status;
  }
  // ISO dates compare correctly as strings.
  if (input.dueDate !== null && input.dueDate < input.today) return "OVERDUE";
  return input.status;
}
