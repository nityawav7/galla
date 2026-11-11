import { formatIndianDate } from "../fy";
import { formatINR } from "../money";
import { type Ledger, type LedgerEntryKind } from "./ledger";

/*
 * The customer statement's rows (SPEC F7, decision 10 of the Phase 8 plan), formatted for print.
 * Balances use the accounting sides a shop's books use: Dr while the customer owes, Cr while the
 * shop holds their money.
 */

export interface StatementAmount {
  /** Without a sign: the side says which way. */
  amount: string;
  side: "DR" | "CR" | null;
}

export function balanceAmount(paise: bigint): StatementAmount {
  if (paise === 0n) return { amount: formatINR(0n), side: null };
  return paise > 0n
    ? { amount: formatINR(paise), side: "DR" }
    : { amount: formatINR(-paise), side: "CR" };
}

/** Mode and reference of a payment or a refund, by its id. */
/** Mode and reference of a payment or a refund, by its id. */
export interface PaymentDetails {
  mode: string;
  reference: string | null;
}

export interface StatementRow {
  date: string;
  kind: LedgerEntryKind;
  number: string | null;
  mode: string | null;
  reference: string | null;
  /** Empty when the row adds nothing on that side. */
  debit: string;
  credit: string;
  balance: StatementAmount;
}

const amountOrBlank = (paise: bigint) => (paise === 0n ? "" : formatINR(paise));

export function statementRows(
  ledger: Ledger,
  payments: Readonly<Record<string, PaymentDetails>>,
): StatementRow[] {
  const details = new Map(Object.entries(payments));
  return ledger.rows.map((row) => {
    const payment =
      row.kind === "PAYMENT" || row.kind === "REFUND" ? details.get(String(row.id)) : undefined;
    return {
      date: formatIndianDate(row.date),
      kind: row.kind,
      number: row.number,
      mode: payment?.mode ?? null,
      reference: payment?.reference ?? null,
      debit: amountOrBlank(row.debitPaise),
      credit: amountOrBlank(row.creditPaise),
      balance: balanceAmount(row.balancePaise),
    };
  });
}
