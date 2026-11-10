/**
 * The customer ledger, udhaar (SPEC §4.9, F7): opening balance + issued invoices − payments −
 * credit notes, in date order with a running balance. A positive balance means the customer owes
 * the shop; a negative one is an advance.
 *
 * The caller passes live documents only: cancelled invoices were never owed and voided payments
 * never happened (decisions 6 and 7 of the Phase 8 plan).
 */

export type LedgerEntryKind = "OPENING" | "INVOICE" | "CREDIT_NOTE" | "PAYMENT";

export interface LedgerDocument {
  id: string;
  number: string;
  date: string;
  grandTotalPaise: bigint;
}

export interface LedgerPayment {
  id: string;
  date: string;
  amountPaise: bigint;
}

export interface LedgerInput {
  /** Signed: positive = the customer owed this when added, negative = an advance. */
  openingBalancePaise: bigint;
  /** The day the opening balance was entered (the customer's creation date in IST). */
  openingDate: string;
  invoices: readonly LedgerDocument[];
  creditNotes: readonly LedgerDocument[];
  payments: readonly LedgerPayment[];
}

export interface LedgerRow {
  kind: LedgerEntryKind;
  /** Null for the opening balance. */
  id: string | null;
  date: string;
  /** Document number; null for payments and the opening balance. */
  number: string | null;
  /** Adds to what the customer owes. */
  debitPaise: bigint;
  /** Takes away from what the customer owes. */
  creditPaise: bigint;
  /** After this row. */
  balancePaise: bigint;
}

export interface Ledger {
  /** Everything before `from`, folded into one amount; null when the whole history is shown. */
  broughtForwardPaise: bigint | null;
  rows: LedgerRow[];
  /** Totals of the rows shown (not of the brought-forward part). */
  debitPaise: bigint;
  creditPaise: bigint;
  closingPaise: bigint;
}

const RANK: Record<LedgerEntryKind, number> = {
  OPENING: 0,
  INVOICE: 1,
  CREDIT_NOTE: 2,
  PAYMENT: 3,
};

type Entry = Omit<LedgerRow, "balancePaise">;
/** Every row but the opening balance has an id. */
type DatedEntry = Entry & { id: string };

function entries(input: LedgerInput): Entry[] {
  const documents = (
    kind: "INVOICE" | "CREDIT_NOTE",
    docs: readonly LedgerDocument[],
  ): DatedEntry[] =>
    docs.map((doc) => ({
      kind,
      id: doc.id,
      date: doc.date,
      number: doc.number,
      debitPaise: kind === "INVOICE" ? doc.grandTotalPaise : 0n,
      creditPaise: kind === "CREDIT_NOTE" ? doc.grandTotalPaise : 0n,
    }));
  const sorted = [
    ...documents("INVOICE", input.invoices),
    ...documents("CREDIT_NOTE", input.creditNotes),
    ...input.payments.map((payment): DatedEntry => ({
      kind: "PAYMENT",
      id: payment.id,
      date: payment.date,
      number: null,
      debitPaise: 0n,
      creditPaise: payment.amountPaise,
    })),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      RANK[a.kind] - RANK[b.kind] ||
      (a.number ?? "").localeCompare(b.number ?? "", "en") ||
      a.id.localeCompare(b.id),
  );
  const opening = input.openingBalancePaise;
  if (opening === 0n) return sorted;
  // The opening balance comes before everything: a payment recorded with a date before the
  // customer was added moves the opening row back to that date, so the rows stay in date order.
  const first = sorted[0]?.date;
  return [
    {
      kind: "OPENING",
      id: null,
      date: first !== undefined && first < input.openingDate ? first : input.openingDate,
      number: null,
      debitPaise: opening > 0n ? opening : 0n,
      creditPaise: opening < 0n ? -opening : 0n,
    },
    ...sorted,
  ];
}

/**
 * The ledger with a running balance. With `from` (an ISO date), rows dated earlier are folded
 * into a "balance brought forward", as on a statement for a period.
 */
export function buildLedger(input: LedgerInput, from: string | null = null): Ledger {
  let balance = 0n;
  let broughtForward: bigint | null = from === null ? null : 0n;
  let debit = 0n;
  let credit = 0n;
  const rows: LedgerRow[] = [];
  for (const entry of entries(input)) {
    balance += entry.debitPaise - entry.creditPaise;
    if (from !== null && entry.date < from) {
      broughtForward = balance;
      continue;
    }
    debit += entry.debitPaise;
    credit += entry.creditPaise;
    rows.push({ ...entry, balancePaise: balance });
  }
  return {
    broughtForwardPaise: broughtForward,
    rows,
    debitPaise: debit,
    creditPaise: credit,
    closingPaise: balance,
  };
}
