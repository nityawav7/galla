"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { updateBusinessAction } from "@/app/(app)/b/[businessSlug]/settings/actions";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type BusinessFormValues,
  type BusinessInput,
  businessSchema,
} from "@/lib/validation/business";

import { DetailsFields, EmailField, GstFields, InvoicingFields } from "./business-fields";
import { applyServerErrors } from "./server-errors";

interface SettingsFormProps {
  businessSlug: string;
  defaultValues: BusinessFormValues;
}

type Status = "idle" | "saved" | "error";

export function SettingsForm({ businessSlug, defaultValues }: SettingsFormProps) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const form = useForm<BusinessFormValues, unknown, BusinessInput>({
    resolver: zodResolver(businessSchema),
    defaultValues,
    mode: "onTouched",
  });
  const values = useWatch({ control: form.control }) as BusinessFormValues;

  const submit = form.handleSubmit(async () => {
    setStatus("idle");
    const result = await updateBusinessAction(businessSlug, form.getValues());
    if (result.ok) {
      setStatus("saved");
      form.reset(form.getValues());
      router.refresh();
      return;
    }
    if (applyServerErrors(form, result.error) === undefined) setStatus("error");
  });

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <FormProvider {...form}>
        <form noValidate className="flex flex-col gap-8" onSubmit={(event) => void submit(event)}>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("profile")}</h2>
            <DetailsFields />
            <EmailField />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("gst")}</h2>
            <GstFields />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("invoicing")}</h2>
            <InvoicingFields showCreditNotePrefix />
          </section>
          <div className="flex flex-col gap-3" aria-live="polite">
            {status === "saved" ? <p className="text-sm">{t("saved")}</p> : null}
            {status === "error" ? (
              <Alert variant="destructive">
                <AlertDescription>{errors("generic")}</AlertDescription>
              </Alert>
            ) : null}
            <div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? common("pleaseWait") : t("save")}
              </Button>
            </div>
          </div>
        </form>
      </FormProvider>
      <InvoicePreview values={values} />
    </div>
  );
}
