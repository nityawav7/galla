/**
 * Receivables aging (SPEC §4.9): what is still due on each open invoice, by days past its due date,
 * in "not due yet" and the buckets 0–30, 31–60, 61–90 and 90+ days (decision 8 of the Phase 8
 * plan). An invoice without a due date is due on its invoice date. The opening balance still owed
 * and money on account are kept beside the buckets, so everything adds up to the ledger balance.
 */

import { daysBetween } from "../fy";

export interface AgingInvoice {
  invoiceDate: string;
  dueDate: string | null;
  balancePaise: bigint;
}

export interface AgingInput {
  openInvoices: readonly AgingInvoice[];
  /** The opening balance not yet paid (≥ 0). */
  openingOwedPaise: bigint;
  /** Money on account not yet applied to anything (≥ 0); it reduces the total. */
  onAccountPaise: bigint;
  /** Today in Asia/Kolkata. */
  today: string;
}

/** The last day of each bucket: [30, 60, 90] makes 0–30, 31–60, 61–90 and 90+. */
export type AgingLimits = readonly [number, number, number];

export interface Aging {
  notDuePaise: bigint;
  /** Amounts 0–30, 31–60, 61–90 and over 90 days past due (with the default limits). */
  pastDuePaise: [bigint, bigint, bigint, bigint];
  openingPaise: bigint;
  onAccountPaise: bigint;
  /** notDue + past due + opening − on account: the ledger balance. */
  totalPaise: bigint;
  /** Due before today (the invoices shown as OVERDUE); an invoice due today isn't overdue yet. */
  overduePaise: bigint;
}

function bucketFor(daysPastDue: number, limits: AgingLimits): 0 | 1 | 2 | 3 {
  if (daysPastDue <= limits[0]) return 0;
  if (daysPastDue <= limits[1]) return 1;
  if (daysPastDue <= limits[2]) return 2;
  return 3;
}

export function ageReceivables(input: AgingInput, limits: AgingLimits): Aging {
  let notDue = 0n;
  let overdue = 0n;
  const pastDue: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  for (const invoice of input.openInvoices) {
    if (invoice.balancePaise <= 0n) continue;
    const days = daysBetween(invoice.dueDate ?? invoice.invoiceDate, input.today);
    if (days < 0) notDue += invoice.balancePaise;
    else pastDue[bucketFor(days, limits)] += invoice.balancePaise;
    if (days > 0) overdue += invoice.balancePaise;
  }
  const due = notDue + pastDue[0] + pastDue[1] + pastDue[2] + pastDue[3];
  return {
    notDuePaise: notDue,
    pastDuePaise: pastDue,
    openingPaise: input.openingOwedPaise,
    onAccountPaise: input.onAccountPaise,
    totalPaise: due + input.openingOwedPaise - input.onAccountPaise,
    overduePaise: overdue,
  };
}
