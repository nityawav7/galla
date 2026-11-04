"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { createBusinessAction } from "@/app/(app)/onboarding/actions";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type BusinessFormValues,
  type BusinessInput,
  businessSchema,
  EMPTY_BUSINESS_FORM,
  ONBOARDING_STEPS,
} from "@/lib/validation/business";

import { DetailsFields, GstFields, InvoicingFields } from "./business-fields";
import { applyServerErrors } from "./server-errors";

const STEP_KEYS = ["details", "gst", "invoicing"] as const;

/** SPEC F1: details → GST → invoice prefix and UPI, with a live preview beside (or below). */
export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState(false);
  const form = useForm<BusinessFormValues, unknown, BusinessInput>({
    resolver: zodResolver(businessSchema),
    defaultValues: EMPTY_BUSINESS_FORM,
    mode: "onTouched",
  });
  const values = useWatch({ control: form.control }) as BusinessFormValues;
  const isLastStep = step === STEP_KEYS.length - 1;

  async function next() {
    const fields = ONBOARDING_STEPS[step];
    if (fields && (await form.trigger(fields, { shouldFocus: true }))) setStep(step + 1);
  }

  const submit = form.handleSubmit(async () => {
    setFormError(false);
    // Send what was typed; the server parses it with the same schema.
    const result = await createBusinessAction(form.getValues());
    if (result.ok) {
      router.push(`/b/${result.data.slug}/dashboard`);
      return;
    }
    const firstStep = applyServerErrors(form, result.error, ONBOARDING_STEPS);
    if (firstStep === undefined) setFormError(true);
    else setStep(firstStep);
  });

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <FormProvider {...form}>
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (isLastStep) void submit(event);
            else void next();
          }}
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {t("stepOf", { step: step + 1, total: STEP_KEYS.length })}
            </p>
            <h2 className="text-lg font-semibold">{t(`steps.${STEP_KEYS[step] ?? "details"}`)}</h2>
          </div>
          {formError ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription>{errors("generic")}</AlertDescription>
            </Alert>
          ) : null}
          {step === 0 ? <DetailsFields /> : null}
          {step === 1 ? <GstFields /> : null}
          {step === 2 ? <InvoicingFields /> : null}
          <div className="flex gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep(step - 1);
                }}
              >
                {t("back")}
              </Button>
            ) : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? common("pleaseWait")
                : isLastStep
                  ? t("submit")
                  : t("next")}
            </Button>
          </div>
        </form>
      </FormProvider>
      <InvoicePreview values={values} />
    </div>
  );
}
