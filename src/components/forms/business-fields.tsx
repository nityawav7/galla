"use client";

import { useTranslations } from "next-intl";
import { useFormContext, useWatch } from "react-hook-form";

import { type BusinessFormValues } from "@/lib/validation/business";
import { fyForDate, istDateFromInstant } from "@/server/domain/fy";
import { GST_SCHEMES } from "@/server/domain/gst/place-of-supply";
import { formatDocumentNumber } from "@/server/domain/numbering";
import { GST_STATES } from "@/server/domain/states";

import { SelectField } from "./select-field";
import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";

const ACTIVE_STATES = GST_STATES.filter((state) => state.active);

/** "INV/26-27/0001" for a valid prefix, otherwise undefined. */
export function firstInvoiceNumber(prefix: string, today = new Date()): string | undefined {
  try {
    return formatDocumentNumber(prefix, fyForDate(istDateFromInstant(today)), 1);
  } catch {
    return undefined;
  }
}

export function DetailsFields() {
  const t = useTranslations("business");
  const { fieldError } = useFormMessages();
  const { register, formState } = useFormContext<BusinessFormValues>();
  const { errors } = formState;
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t("fields.legalName")}
        hint={t("hints.legalName")}
        autoComplete="organization"
        error={fieldError(errors.legalName)}
        {...register("legalName")}
      />
      <TextField
        label={t("fields.tradeName")}
        hint={t("hints.tradeName")}
        error={fieldError(errors.tradeName)}
        {...register("tradeName")}
      />
      <TextField
        label={t("fields.addressLine1")}
        autoComplete="address-line1"
        error={fieldError(errors.addressLine1)}
        {...register("addressLine1")}
      />
      <TextField
        label={t("fields.addressLine2")}
        autoComplete="address-line2"
        error={fieldError(errors.addressLine2)}
        {...register("addressLine2")}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t("fields.city")}
          autoComplete="address-level2"
          error={fieldError(errors.city)}
          {...register("city")}
        />
        <TextField
          label={t("fields.pincode")}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          error={fieldError(errors.pincode)}
          {...register("pincode")}
        />
      </div>
      <SelectField
        label={t("fields.state")}
        error={fieldError(errors.stateCode)}
        {...register("stateCode")}
      >
        <option value="">{t("chooseState")}</option>
        {ACTIVE_STATES.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name} ({state.code})
          </option>
        ))}
      </SelectField>
      <TextField
        label={t("fields.phone")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        error={fieldError(errors.phone)}
        {...register("phone")}
      />
    </div>
  );
}

export function GstFields() {
  const t = useTranslations("business");
  const { fieldError } = useFormMessages();
  const { register, control, formState } = useFormContext<BusinessFormValues>();
  const scheme = useWatch({ control, name: "gstScheme" });
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t("fields.gstScheme")}</legend>
        {GST_SCHEMES.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-foreground"
          >
            <input type="radio" value={value} className="mt-1" {...register("gstScheme")} />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t(`schemes.${value}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`schemeHints.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {scheme === "UNREGISTERED" ? null : (
        <TextField
          label={t("fields.gstin")}
          hint={t("hints.gstin")}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={15}
          className="uppercase"
          error={fieldError(formState.errors.gstin)}
          {...register("gstin")}
        />
      )}
    </div>
  );
}

export function InvoicingFields({
  showCreditNotePrefix = false,
}: {
  showCreditNotePrefix?: boolean;
}) {
  const t = useTranslations("business");
  const { fieldError } = useFormMessages();
  const { register, control, formState } = useFormContext<BusinessFormValues>();
  const { errors } = formState;
  const prefix = useWatch({ control, name: "invoicePrefix" });
  const example = firstInvoiceNumber(prefix);
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t("fields.invoicePrefix")}
        hint={example ? t("hints.invoicePrefix", { example }) : undefined}
        autoCapitalize="characters"
        maxLength={5}
        error={fieldError(errors.invoicePrefix)}
        {...register("invoicePrefix")}
      />
      {showCreditNotePrefix ? (
        <TextField
          label={t("fields.creditNotePrefix")}
          autoCapitalize="characters"
          maxLength={5}
          error={fieldError(errors.creditNotePrefix)}
          {...register("creditNotePrefix")}
        />
      ) : null}
      <TextField
        label={t("fields.upiVpa")}
        hint={t("hints.upiVpa")}
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        error={fieldError(errors.upiVpa)}
        {...register("upiVpa")}
      />
    </div>
  );
}

export function EmailField() {
  const t = useTranslations("business");
  const { fieldError } = useFormMessages();
  const { register, formState } = useFormContext<BusinessFormValues>();
  return (
    <TextField
      label={t("fields.email")}
      type="email"
      inputMode="email"
      autoComplete="email"
      error={fieldError(formState.errors.email)}
      {...register("email")}
    />
  );
}
