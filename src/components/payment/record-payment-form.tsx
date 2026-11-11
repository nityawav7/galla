"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { type FieldErrors, type Resolver, useForm, useWatch } from "react-hook-form";

import { recordPaymentAction } from "@/app/(app)/b/[businessSlug]/payments/actions";
import { TextField } from "@/components/forms/text-field";
import { useFormMessages } from "@/components/forms/use-form-messages";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type FieldIssue } from "@/lib/errors";
import {
  type AllocationChoice,
  defaultPaymentValues,
  isWalkIn,
  paymentFormIssues,
  type PaymentFormValues,
  paymentPreview,
  rupees,
  toFormPath,
  toPaymentInput,
} from "@/lib/payment-form";
import { type PaymentFormOptions, type RecordedPayment } from "@/lib/payment-view";
import { cn } from "@/lib/utils";
import { isValidationKey } from "@/lib/validation/messages";
import { isPaymentErrorKey, OPENING_BALANCE, PAYMENT_MODES } from "@/lib/validation/payments";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";

interface RecordPaymentFormProps {
  businessSlug: string;
  options: PaymentFormOptions;
  /** Where "Done" goes: the invoice, or the customer's payments. */
  returnHref: string;
}

/** Puts `{ path: "manual.2.amount" }` style issues into react-hook-form's nested error object. */
function toFieldErrors(issues: readonly FieldIssue[]): FieldErrors<PaymentFormValues> {
  const errors: Record<string, unknown> = {};
  for (const issue of issues) {
    const keys = issue.path.split(".");
    let node = errors;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        node[key] ??= { type: "validation", message: issue.message };
        return;
      }
      node[key] ??= {};
      node = node[key] as Record<string, unknown>;
    });
  }
  return errors;
}

const REFERENCE_LABEL = {
  CASH: "referenceOther",
  UPI: "referenceUtr",
  BANK_TRANSFER: "referenceUtr",
  CHEQUE: "referenceCheque",
  CARD: "referenceCard",
  OTHER: "referenceOther",
} as const;

/** SPEC F7: record money received, split oldest first or as chosen; the rest stays on account. */
export function RecordPaymentForm({ businessSlug, options, returnHref }: RecordPaymentFormProps) {
  const t = useTranslations("payments.form");
  const tModes = useTranslations("payments.modes");
  const tStatus = useTranslations("invoices.status");
  const tErrors = useTranslations("payments.errors");
  const validation = useTranslations("validation");
  const errorsT = useTranslations("errors");
  const { fieldError } = useFormMessages();
  const id = useId();
  const walkIn = isWalkIn(options);
  const defaults = useMemo(() => defaultPaymentValues(options), [options]);
  const resolver = useMemo<Resolver<PaymentFormValues>>(
    () => (values) => {
      const issues = paymentFormIssues(values, options);
      return issues.length === 0
        ? { values, errors: {} }
        : { values: {}, errors: toFieldErrors(issues) };
    },
    [options],
  );
  const form = useForm<PaymentFormValues>({ defaultValues: defaults, resolver });
  const { register, handleSubmit, control, setValue, setError, formState, reset } = form;
  const values = useWatch({ control }) as PaymentFormValues;
  const [saved, setSaved] = useState<RecordedPayment | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const preview = paymentPreview({ ...defaults, ...values }, options);
  const labelOf = (key: string | null) => {
    if (key === null || key === OPENING_BALANCE) return t("openingBalance");
    return options.openItems.find((item) => item.key === key)?.number ?? key;
  };
  const from = options.openItems.find((item) => item.key === options.invoiceId);

  const save = async (form: PaymentFormValues) => {
    setFailed(null);
    const result = await recordPaymentAction(businessSlug, toPaymentInput(form, options));
    if (result.ok) {
      setSaved(result.data);
      return;
    }
    const issues = (result.error.issues ?? []).filter((issue) => isValidationKey(issue.message));
    if (issues.length > 0) {
      for (const issue of issues) {
        setError(toFormPath(issue.path, form) as "amount", {
          type: "server",
          message: issue.message,
        });
      }
      return;
    }
    setFailed(
      isPaymentErrorKey(result.error.message) ? tErrors(result.error.message) : errorsT("generic"),
    );
  };

  if (saved) {
    return (
      <section aria-labelledby={`${id}-done`} aria-live="polite" className="flex flex-col gap-4">
        <h2 id={`${id}-done`} className="text-lg font-semibold">
          {t("saved")}
        </h2>
        {saved.invoices.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="payment-result">
            {saved.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 p-3">
                <span className="font-medium">{invoice.number}</span>
                <span className="text-sm">
                  {tStatus(invoice.status as "PAID")} ·{" "}
                  {t("balanceLeft", { amount: formatINR(BigInt(invoice.balancePaise)) })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {BigInt(saved.onAccountPaise) > 0n ? (
          <p className="text-sm">
            {t("keptOnAccount", { amount: formatINR(BigInt(saved.onAccountPaise)) })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href={returnHref}>{t("done")}</Link>
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => {
              setSaved(null);
              reset(defaults);
            }}
          >
            {t("another")}
          </Button>
        </div>
      </section>
    );
  }

  const choice = values.allocationChoice;
  const choices: AllocationChoice[] = from ? ["INVOICE", "AUTO", "MANUAL"] : ["AUTO", "MANUAL"];
  const rootError = formState.errors.root?.allocation?.message;

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(save)(event)}
      className="flex flex-col gap-5"
    >
      <p className="text-sm text-muted-foreground">
        {walkIn
          ? t("forWalkIn", { number: from?.number ?? "" })
          : t("forCustomer", { name: options.customer?.name ?? "" })}
      </p>

      <TextField
        label={t("amount")}
        inputMode="decimal"
        autoComplete="off"
        className="h-11 text-lg"
        error={fieldError(formState.errors.amount)}
        {...register("amount")}
      />
      <TextField
        label={t("date")}
        type="date"
        max={options.today}
        error={fieldError(formState.errors.paymentDate)}
        {...register("paymentDate")}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("mode")}</legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_MODES.map((mode) => (
            <label
              key={mode}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              <input type="radio" value={mode} className="sr-only" {...register("mode")} />
              {tModes(mode)}
            </label>
          ))}
        </div>
      </fieldset>

      {values.mode !== "CASH" ? (
        <TextField
          label={t(REFERENCE_LABEL[values.mode])}
          autoComplete="off"
          error={fieldError(formState.errors.reference)}
          {...register("reference")}
        />
      ) : null}
      <TextField
        label={t("notes")}
        autoComplete="off"
        error={fieldError(formState.errors.notes)}
        {...register("notes")}
      />

      {!walkIn ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t("applyTo")}</legend>
          <div className="flex flex-col gap-2">
            {choices.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input type="radio" value={option} {...register("allocationChoice")} />
                {option === "INVOICE"
                  ? t("choiceInvoice", { number: from?.number ?? "" })
                  : t(option === "AUTO" ? "choiceAuto" : "choiceManual")}
              </label>
            ))}
          </div>
          {choice === "MANUAL" ? (
            options.openItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingDue")}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {options.openItems.map((item, index) => {
                  const inputId = `${id}-manual-${String(index)}`;
                  const error = fieldError(formState.errors.manual?.[index]?.amount);
                  return (
                    <li key={item.key} className="flex flex-col gap-1.5 p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <Label htmlFor={inputId}>{labelOf(item.key)}</Label>
                        <span className="text-sm text-muted-foreground">
                          {item.dueDate
                            ? t("dueOn", { date: formatIndianDate(item.dueDate) }) + " · "
                            : ""}
                          {t("due", { amount: formatINR(BigInt(item.balancePaise)) })}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id={inputId}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? `${inputId}-error` : undefined}
                          className="h-9"
                          {...register(`manual.${index}.amount`)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setValue(`manual.${index}.amount`, rupees(BigInt(item.balancePaise)));
                          }}
                        >
                          {t("full")}
                        </Button>
                      </div>
                      {error ? (
                        <p id={`${inputId}-error`} className="text-sm text-destructive">
                          {error}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </fieldset>
      ) : null}

      <div
        aria-live="polite"
        className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm"
        data-testid="payment-preview"
      >
        {preview && !(preview instanceof Error) ? (
          <>
            {preview.allocations.map((allocation) => (
              <p
                key={allocation.invoiceId ?? OPENING_BALANCE}
                className="flex justify-between gap-3"
              >
                <span>{labelOf(allocation.invoiceId)}</span>
                <span className="tabular-nums">{formatINR(allocation.amountPaise)}</span>
              </p>
            ))}
            <p className="flex justify-between gap-3 font-medium">
              <span>{t("onAccount")}</span>
              <span className="tabular-nums">{formatINR(preview.onAccountPaise)}</span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t("previewEmpty")}</p>
        )}
        {rootError && isValidationKey(rootError) ? (
          <p role="alert" className="text-destructive">
            {validation(rootError)}
          </p>
        ) : null}
      </div>

      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
