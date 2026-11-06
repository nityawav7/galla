"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  createCustomerAction,
  type SaveCustomerActionResult,
  updateCustomerAction,
} from "@/app/(app)/b/[businessSlug]/customers/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  BALANCE_TYPES,
  type CustomerFormValues,
  type CustomerInput,
  customerSchema,
} from "@/lib/validation/customers";
import { validateGstin } from "@/server/domain/gstin";
import { GST_STATES } from "@/server/domain/states";

import { CheckboxField } from "./checkbox-field";
import { SelectField } from "./select-field";
import { applyServerErrors } from "./server-errors";
import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";

const ACTIVE_STATES = GST_STATES.filter((state) => state.active);

interface CustomerFormProps {
  businessSlug: string;
  /** Absent when adding a customer. */
  customerId?: string;
  defaultValues: CustomerFormValues;
}

type Status = "idle" | "saved" | "error";
type Match = Extract<SaveCustomerActionResult, { status: "possibleDuplicate" }>["matches"][number];

export function CustomerForm({ businessSlug, customerId, defaultValues }: CustomerFormProps) {
  const t = useTranslations("customers");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const { fieldError } = useFormMessages();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [matches, setMatches] = useState<Match[]>([]);
  const form = useForm<CustomerFormValues, unknown, CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues,
    mode: "onTouched",
  });
  const { register, setValue, formState, control } = form;
  const fieldErrors = formState.errors;
  const gstin = useWatch({ control, name: "gstin" });
  const billingState = useWatch({ control, name: "billingStateCode" });
  const gstinResult = validateGstin(gstin);
  const gstinState = gstinResult.ok ? gstinResult.stateCode : null;
  const mismatch = gstinState !== null && billingState !== "" && billingState !== gstinState;

  // SPEC F3: a valid GSTIN fills the billing state (each time the GSTIN itself changes).
  const lastGstin = useRef(gstin);
  useEffect(() => {
    if (gstin === lastGstin.current) return;
    lastGstin.current = gstin;
    if (gstinState) {
      setValue("billingStateCode", gstinState, { shouldValidate: formState.isSubmitted });
      setValue("stateOverride", false);
    }
  }, [gstin, gstinState, setValue, formState.isSubmitted]);

  const save = async (values: CustomerFormValues) => {
    setStatus("idle");
    const result = customerId
      ? await updateCustomerAction(businessSlug, customerId, values)
      : await createCustomerAction(businessSlug, values);
    if (!result.ok) {
      if (applyServerErrors(form, result.error) === undefined) setStatus("error");
      return;
    }
    if (result.data.status === "possibleDuplicate") {
      setMatches(result.data.matches);
      return;
    }
    setMatches([]);
    if (!customerId) {
      // Next keeps visited pages mounted, so clear the form for the next "Add customer".
      form.reset(defaultValues);
      router.push(`/b/${businessSlug}/customers`);
      return;
    }
    setStatus("saved");
    form.reset({ ...values, confirmDuplicatePhone: false });
    router.refresh();
  };

  const submit = form.handleSubmit(() => save(form.getValues()));
  const saveAnyway = () => {
    setValue("confirmDuplicatePhone", true);
    void form.handleSubmit(() => save(form.getValues()))();
  };

  const stateOptions = (
    <>
      <option value="">{t("chooseState")}</option>
      {ACTIVE_STATES.map((state) => (
        <option key={state.code} value={state.code}>
          {state.name} ({state.code})
        </option>
      ))}
    </>
  );

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-8"
      onSubmit={(event) => void submit(event)}
    >
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("sections.contact")}</h2>
        <TextField
          label={t("fields.name")}
          autoComplete="off"
          error={fieldError(fieldErrors.name)}
          {...register("name")}
        />
        <TextField
          label={t("fields.phone")}
          type="tel"
          inputMode="tel"
          error={fieldError(fieldErrors.phone)}
          {...register("phone")}
        />
        <TextField
          label={t("fields.email")}
          type="email"
          inputMode="email"
          error={fieldError(fieldErrors.email)}
          {...register("email")}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("sections.gst")}</h2>
        <TextField
          label={t("fields.gstin")}
          hint={t("hints.gstin")}
          autoCapitalize="characters"
          maxLength={15}
          error={fieldError(fieldErrors.gstin)}
          {...register("gstin")}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("sections.billing")}</h2>
        <SelectField
          label={t("fields.billingState")}
          error={fieldError(fieldErrors.billingStateCode)}
          {...register("billingStateCode")}
        >
          {stateOptions}
        </SelectField>
        <p className="-mt-2 text-xs text-muted-foreground">{t("hints.billingState")}</p>
        {mismatch ? (
          <CheckboxField
            label={t("fields.stateOverride")}
            hint={t("hints.stateMismatch")}
            error={fieldError(fieldErrors.stateOverride)}
            {...register("stateOverride")}
          />
        ) : null}
        <TextField
          label={t("fields.addressLine1")}
          autoComplete="off"
          error={fieldError(fieldErrors.billingAddressLine1)}
          {...register("billingAddressLine1")}
        />
        <TextField
          label={t("fields.addressLine2")}
          autoComplete="off"
          error={fieldError(fieldErrors.billingAddressLine2)}
          {...register("billingAddressLine2")}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t("fields.city")}
            error={fieldError(fieldErrors.billingCity)}
            {...register("billingCity")}
          />
          <TextField
            label={t("fields.pincode")}
            inputMode="numeric"
            maxLength={6}
            error={fieldError(fieldErrors.billingPincode)}
            {...register("billingPincode")}
          />
        </div>
      </section>

      <details
        className="flex flex-col gap-4 rounded-lg border p-3"
        open={Boolean(defaultValues.shippingAddressLine1 || defaultValues.shippingStateCode)}
      >
        <summary className="cursor-pointer text-base font-semibold">
          {t("sections.shipping")}
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <SelectField
            label={t("fields.shippingState")}
            error={fieldError(fieldErrors.shippingStateCode)}
            {...register("shippingStateCode")}
          >
            {stateOptions}
          </SelectField>
          <TextField
            label={t("fields.shippingAddressLine1")}
            error={fieldError(fieldErrors.shippingAddressLine1)}
            {...register("shippingAddressLine1")}
          />
          <TextField
            label={t("fields.shippingAddressLine2")}
            error={fieldError(fieldErrors.shippingAddressLine2)}
            {...register("shippingAddressLine2")}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label={t("fields.shippingCity")}
              error={fieldError(fieldErrors.shippingCity)}
              {...register("shippingCity")}
            />
            <TextField
              label={t("fields.shippingPincode")}
              inputMode="numeric"
              maxLength={6}
              error={fieldError(fieldErrors.shippingPincode)}
              {...register("shippingPincode")}
            />
          </div>
        </div>
      </details>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("sections.balance")}</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("fields.balanceType")}</legend>
          {BALANCE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value={type}
                className="size-4 accent-primary"
                {...register("balanceType")}
              />
              {t(`balanceTypes.${type}`)}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t("fields.openingBalance")}
            hint={t("hints.openingBalance")}
            inputMode="decimal"
            error={fieldError(fieldErrors.openingBalance)}
            {...register("openingBalance")}
          />
          <TextField
            label={t("fields.creditDays")}
            hint={t("hints.creditDays")}
            inputMode="numeric"
            maxLength={3}
            error={fieldError(fieldErrors.creditDays)}
            {...register("creditDays")}
          />
        </div>
      </section>

      <div className="flex flex-col gap-3" aria-live="polite">
        {matches.length > 0 ? (
          <Alert>
            <AlertTitle>{t("duplicateTitle")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{t("duplicateBody")}</span>
              <ul className="list-disc pl-5">
                {matches.map((match) => (
                  <li key={match.id}>
                    <Link
                      href={`/b/${businessSlug}/customers/${match.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {match.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <div>
                <Button type="button" variant="outline" onClick={saveAnyway}>
                  {t("saveAnyway")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {status === "saved" ? <p className="text-sm">{t("saved")}</p> : null}
        {status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{errors("generic")}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button type="submit" size="lg" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? common("pleaseWait") : customerId ? t("save") : t("create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
