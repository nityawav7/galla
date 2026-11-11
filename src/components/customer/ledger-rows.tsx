import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { formatIndianDate } from "@/server/domain/fy";
import { type LedgerRow } from "@/server/domain/ledger/ledger";
import { formatINR } from "@/server/domain/money";
import { type CustomerLedger } from "@/server/services/ledger.service";

/*
 * The customer's account history (SPEC §4.9): one list that reads as cards on a phone and as a
 * table from `md` up. Debits add to what the customer owes, credits take away; the balance after
 * each row runs down the right. Rows link to their invoice, credit note or payment.
 */

interface LedgerRowsProps {
  businessSlug: string;
  customerId: string;
  /** The balance before the first row shown, or null when the history starts there. */
  broughtForward: { date: string; balancePaise: bigint } | null;
  rows: readonly LedgerRow[];
  payments: CustomerLedger["payments"];
}

const GRID = "md:grid md:grid-cols-[7rem_1fr_8rem_8rem_9rem] md:items-baseline md:gap-3";

export async function LedgerRows({
  businessSlug,
  customerId,
  broughtForward,
  rows,
  payments,
}: LedgerRowsProps) {
  const t = await getTranslations("customers.ledger");
  const tModes = await getTranslations("payments.modes");
  const balance = (paise: bigint) =>
    paise < 0n ? t("advanceBalance", { amount: formatINR(-paise) }) : formatINR(paise);

  const href = (row: LedgerRow): string | null => {
    if (row.id === null) return null;
    if (row.kind === "INVOICE") return `/b/${businessSlug}/invoices/${row.id}`;
    if (row.kind === "CREDIT_NOTE") return `/b/${businessSlug}/credit-notes/${row.id}`;
    if (row.kind === "PAYMENT") return `/b/${businessSlug}/payments?customer=${customerId}`;
    return null;
  };
  const particulars = (row: LedgerRow): string => {
    if (row.kind === "PAYMENT" || row.kind === "REFUND") {
      const payment = payments[String(row.id)];
      const text = t(`kinds.${row.kind}`, { mode: payment ? tModes(payment.mode) : "" });
      return payment?.reference ? `${text} · ${payment.reference}` : text;
    }
    if (row.kind === "OPENING") return t("kinds.OPENING");
    return t(`kinds.${row.kind}`, { number: row.number ?? "" });
  };

  if (rows.length === 0 && broughtForward === null) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ol className="flex flex-col divide-y rounded-lg border" data-testid="ledger">
      <li
        aria-hidden
        className={`hidden px-3 py-2 text-xs font-medium text-muted-foreground ${GRID}`}
      >
        <span>{t("columns.date")}</span>
        <span>{t("columns.particulars")}</span>
        <span className="text-right">{t("columns.debit")}</span>
        <span className="text-right">{t("columns.credit")}</span>
        <span className="text-right">{t("columns.balance")}</span>
      </li>
      {broughtForward ? (
        <li className={`flex flex-col gap-0.5 p-3 ${GRID}`}>
          <span className="text-sm text-muted-foreground">
            {formatIndianDate(broughtForward.date)}
          </span>
          <span className="font-medium">{t("kinds.BROUGHT_FORWARD")}</span>
          <span className="hidden md:block" />
          <span className="hidden md:block" />
          <span className="text-sm tabular-nums md:text-right md:text-base">
            <span className="md:sr-only">{t("columns.balance")}: </span>
            {balance(broughtForward.balancePaise)}
          </span>
        </li>
      ) : null}
      {rows.map((row) => {
        const link = href(row);
        const label = particulars(row);
        return (
          <li
            key={`${row.kind}-${row.id ?? "opening"}`}
            className={`flex flex-col gap-0.5 p-3 ${GRID}`}
          >
            <span className="text-sm text-muted-foreground">{formatIndianDate(row.date)}</span>
            <span className="font-medium">
              {link ? (
                <Link href={link} className="underline underline-offset-4">
                  {label}
                </Link>
              ) : (
                label
              )}
            </span>
            <span className="flex justify-between gap-3 tabular-nums md:contents">
              <span className={row.debitPaise > 0n ? "md:text-right" : "hidden md:block"}>
                {row.debitPaise > 0n ? (
                  <>
                    <span className="sr-only">{t("columns.debit")}: </span>+
                    {formatINR(row.debitPaise)}
                  </>
                ) : null}
              </span>
              <span className={row.creditPaise > 0n ? "md:text-right" : "hidden md:block"}>
                {row.creditPaise > 0n ? (
                  <>
                    <span className="sr-only">{t("columns.credit")}: </span>−
                    {formatINR(row.creditPaise)}
                  </>
                ) : null}
              </span>
              <span className="text-muted-foreground md:text-right md:text-foreground">
                <span className="sr-only">{t("columns.balance")}: </span>
                {balance(row.balancePaise)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
