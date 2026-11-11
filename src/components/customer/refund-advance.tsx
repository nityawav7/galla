"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { refundAdvanceAction } from "@/app/(app)/b/[businessSlug]/customers/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rupees } from "@/lib/payment-form";
import { isValidationKey } from "@/lib/validation/messages";
import { isPaymentErrorKey, PAYMENT_MODES, type PaymentMode } from "@/lib/validation/payments";
import { formatINR } from "@/server/domain/money";

/**
 * "Refund advance" (owner only, ADR 0011): pays back some or all of what the customer has on
 * account. The server checks the amount against what is on account under the customer's lock.
 */
export function RefundAdvance({
  businessSlug,
  customerId,
  onAccountPaise,
  today,
}: {
  businessSlug: string;
  customerId: string;
  /** As a string: bigint doesn't cross to the browser. */
  onAccountPaise: string;
  today: string;
}) {
  const t = useTranslations("customers.ledger.refund");
  const tModes = useTranslations("payments.modes");
  const validation = useTranslations("validation");
  const paymentErrors = useTranslations("payments.errors");
  const errors = useTranslations("errors");
  const router = useRouter();
  const id = useId();
  const onAccount = BigInt(onAccountPaise);
  const [amount, setAmount] = useState(rupees(onAccount));
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    field: "amount" | "refundDate" | null;
    text: string;
  } | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await refundAdvanceAction(businessSlug, customerId, {
      amount,
      refundDate: date,
      mode,
      reference,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    const issue = result.error.issues?.[0];
    if (issue && isValidationKey(issue.message)) {
      setError({
        field: issue.path === "refundDate" ? "refundDate" : "amount",
        text: validation(issue.message),
      });
    } else if (isPaymentErrorKey(result.error.message)) {
      setError({ field: null, text: paymentErrors(result.error.message) });
    } else {
      setError({ field: null, text: errors("generic") });
    }
  };

  return (
    <details className="rounded-lg border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {t("title")}
      </summary>
      <form
        className="flex flex-col gap-3 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-sm">{t("hint", { amount: formatINR(onAccount) })}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-amount`}>{t("amount")}</Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            autoComplete="off"
            className="h-9"
            value={amount}
            aria-invalid={error?.field === "amount"}
            aria-describedby={error?.field === "amount" ? `${id}-error` : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-date`}>{t("date")}</Label>
          <Input
            id={`${id}-date`}
            type="date"
            max={today}
            className="h-9"
            value={date}
            aria-invalid={error?.field === "refundDate"}
            aria-describedby={error?.field === "refundDate" ? `${id}-error` : undefined}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("mode")}</legend>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((option) => (
              <label
                key={option}
                className="cursor-pointer rounded-full border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={option}
                  checked={mode === option}
                  onChange={() => {
                    setMode(option);
                  }}
                  className="sr-only"
                />
                {tModes(option)}
              </label>
            ))}
          </div>
        </fieldset>
        {mode !== "CASH" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reference`}>{t("reference")}</Label>
            <Input
              id={`${id}-reference`}
              autoComplete="off"
              maxLength={50}
              className="h-9"
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </div>
        ) : null}
        <div aria-live="polite" id={`${id}-error`}>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error.text}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <div>
          <Button type="submit" size="lg" variant="secondary" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </details>
  );
}
