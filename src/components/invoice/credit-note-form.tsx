"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { createCreditNoteAction } from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isInvoiceErrorKey } from "@/lib/validation/invoices";
import { isValidationKey } from "@/lib/validation/messages";
import { PAYMENT_MODES, type PaymentMode } from "@/lib/validation/payments";
import { parseScaled } from "@/server/domain/decimal";
import {
  type CreditableLine,
  creditForReturn,
  creditNoteTotals,
  type LineCredit,
} from "@/server/domain/invoice/credit";
import { formatINR } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";

/** One invoice line as the form needs it; amounts are strings because they cross to the client. */
export interface ReturnableLine {
  id: string;
  description: string;
  unit: string;
  qtyMilli: string;
  returnedMilli: string;
  discountPaise: string;
  taxablePaise: string;
  cgstPaise: string;
  sgstPaise: string;
  utgstPaise: string;
  igstPaise: string;
  lineTotalPaise: string;
}

const REASONS = ["returned", "discount", "correction"] as const;

function toCreditable(line: ReturnableLine): CreditableLine {
  return {
    qtyMilli: BigInt(line.qtyMilli),
    discountPaise: BigInt(line.discountPaise),
    taxablePaise: BigInt(line.taxablePaise),
    cgstPaise: BigInt(line.cgstPaise),
    sgstPaise: BigInt(line.sgstPaise),
    utgstPaise: BigInt(line.utgstPaise),
    igstPaise: BigInt(line.igstPaise),
    lineTotalPaise: BigInt(line.lineTotalPaise),
  };
}

/**
 * A credit note by returned quantity (ADR 0007). Live totals use the same domain functions the
 * server runs; the server checks quantities again when issuing. On a paid invoice, what the note
 * releases goes to the customer's advance, or for a walk-in is given back now (ADR 0011).
 */
export function CreditNoteForm({
  businessSlug,
  invoiceId,
  lines,
  roundOffPaise,
  balancePaise,
  walkIn,
}: {
  businessSlug: string;
  invoiceId: string;
  lines: ReturnableLine[];
  roundOffPaise: string;
  balancePaise: string;
  /** No customer: released money is given back at the counter, not kept on account. */
  walkIn: boolean;
}) {
  const t = useTranslations("creditNotes.form");
  const tModes = useTranslations("payments.modes");
  const validation = useTranslations("validation");
  const invoiceErrors = useTranslations("invoices.errors");
  const errors = useTranslations("errors");
  const router = useRouter();
  const id = useId();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refundMode, setRefundMode] = useState<PaymentMode | null>(null);
  const [refundReference, setRefundReference] = useState("");

  const remaining = (line: ReturnableLine) => BigInt(line.qtyMilli) - BigInt(line.returnedMilli);
  interface Typed {
    line: ReturnableLine;
    qtyMilli: bigint;
    /** Null when the typed quantity is not a valid return. */
    credit: LineCredit | null;
  }
  const credits: Typed[] = lines.flatMap((line): Typed[] => {
    const typed = (quantities[line.id] ?? "").trim();
    if (!typed) return [];
    const qtyMilli = parseScaled(typed, 3);
    if (qtyMilli === null || qtyMilli <= 0n || qtyMilli > remaining(line)) {
      return [{ line, qtyMilli: qtyMilli ?? 0n, credit: null }];
    }
    return [
      {
        line,
        qtyMilli,
        credit: creditForReturn(toCreditable(line), BigInt(line.returnedMilli), qtyMilli),
      },
    ];
  });
  const valid = credits.flatMap((item) => (item.credit ? [item.credit] : []));
  const completes = lines.every((line) => {
    const item = credits.find((candidate) => candidate.line.id === line.id);
    return (item?.credit ? item.qtyMilli : 0n) === remaining(line);
  });
  const totals = creditNoteTotals(valid, completes ? BigInt(roundOffPaise) : null);
  // Already paid beyond what the invoice will now cost: released (ADR 0011).
  const releasedPaise = totals.grandTotalPaise - BigInt(balancePaise);
  const releases = releasedPaise > 0n;
  const needsRefundMode = releases && walkIn && refundMode === null;
  const hasBadLine = credits.some((item) => item.credit === null);

  const returnAll = () => {
    setQuantities(
      Object.fromEntries(
        lines
          .filter((line) => remaining(line) > 0n)
          .map((line) => [line.id, formatQuantity(remaining(line))]),
      ),
    );
  };

  const submit = async () => {
    setProblem(null);
    setBusy(true);
    const result = await createCreditNoteAction(businessSlug, invoiceId, {
      reason,
      lines: credits.map((item) => ({
        invoiceLineId: item.line.id,
        qty: quantities[item.line.id] ?? "",
      })),
      ...(releases && walkIn && refundMode
        ? { refund: { mode: refundMode, reference: refundReference } }
        : {}),
    });
    setBusy(false);
    if (result.ok) {
      router.push(`/b/${businessSlug}/credit-notes/${result.data.id}`);
      return;
    }
    const issue = result.error.issues?.[0]?.message;
    if (issue && isValidationKey(issue)) setProblem(validation(issue));
    else if (isInvoiceErrorKey(result.error.message))
      setProblem(invoiceErrors(result.error.message));
    else setProblem(errors("generic"));
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${id}-lines`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-lines`} className="text-lg font-semibold">
            {t("items")}
          </h2>
          <Button type="button" variant="outline" size="lg" onClick={returnAll}>
            {t("returnAll")}
          </Button>
        </div>
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const left = remaining(line);
            const item = credits.find((candidate) => candidate.line.id === line.id);
            const inputId = `${id}-qty-${String(index)}`;
            return (
              <li key={line.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="font-medium">{line.description}</p>
                <p className="text-xs text-muted-foreground">
                  {t("sold", {
                    qty: formatQuantity(BigInt(line.qtyMilli)),
                    unit: line.unit,
                    left: formatQuantity(left),
                  })}
                </p>
                {left > 0n ? (
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={inputId}>
                        {t("qtyReturned", { item: line.description })}
                      </Label>
                      <Input
                        id={inputId}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={20}
                        placeholder="0"
                        className="h-9 w-28"
                        aria-invalid={item?.credit === null}
                        value={quantities[line.id] ?? ""}
                        onChange={(event) => {
                          setQuantities((current) => ({
                            ...current,
                            [line.id]: event.target.value,
                          }));
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium">
                      {item?.credit ? formatINR(item.credit.totalPaise) : "—"}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("allReturned")}</p>
                )}
                {item?.credit === null ? (
                  <p className="text-sm text-destructive">{validation("returnTooMany")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby={`${id}-reason`} className="flex flex-col gap-2">
        <h2 id={`${id}-reason`} className="text-lg font-semibold">
          {t("reason")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((key) => (
            <Button
              key={key}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setReason(t(`reasons.${key}`));
              }}
            >
              {t(`reasons.${key}`)}
            </Button>
          ))}
        </div>
        <Label htmlFor={`${id}-reason-text`} className="sr-only">
          {t("reason")}
        </Label>
        <textarea
          id={`${id}-reason-text`}
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <dl className="grid grid-cols-2 gap-y-1">
          <dt>{t("taxable")}</dt>
          <dd className="text-right">{formatINR(totals.taxablePaise)}</dd>
          <dt>{t("tax")}</dt>
          <dd className="text-right">
            {formatINR(totals.cgstPaise + totals.sgstPaise + totals.utgstPaise + totals.igstPaise)}
          </dd>
          {totals.roundOffPaise !== 0n ? (
            <>
              <dt>{t("roundOff")}</dt>
              <dd className="text-right">{formatINR(totals.roundOffPaise)}</dd>
            </>
          ) : null}
          <dt className="font-semibold">{t("total")}</dt>
          <dd className="text-right font-semibold" aria-live="polite" data-testid="credit-total">
            {formatINR(totals.grandTotalPaise)}
          </dd>
        </dl>
        <p className="text-muted-foreground">
          {t("balance", { amount: formatINR(BigInt(balancePaise)) })}
        </p>
        {releases && !walkIn ? (
          <p className="font-medium" data-testid="credit-released">
            {t("toAdvance", { amount: formatINR(releasedPaise) })}
          </p>
        ) : null}
      </section>

      {releases && walkIn ? (
        <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">
            {t("refundTitle", { amount: formatINR(releasedPaise) })}
          </legend>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((mode) => (
              <label
                key={mode}
                className="cursor-pointer rounded-full border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name={`${id}-refund-mode`}
                  value={mode}
                  checked={refundMode === mode}
                  onChange={() => {
                    setRefundMode(mode);
                  }}
                  className="sr-only"
                />
                {tModes(mode)}
              </label>
            ))}
          </div>
          {refundMode !== null && refundMode !== "CASH" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-refund-reference`}>{t("refundReference")}</Label>
              <Input
                id={`${id}-refund-reference`}
                autoComplete="off"
                maxLength={50}
                className="h-9"
                value={refundReference}
                onChange={(event) => {
                  setRefundReference(event.target.value);
                }}
              />
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          size="lg"
          disabled={busy || valid.length === 0 || hasBadLine || needsRefundMode}
          onClick={() => void submit()}
        >
          {busy ? t("issuing") : t("issue")}
        </Button>
      </div>
    </div>
  );
}
