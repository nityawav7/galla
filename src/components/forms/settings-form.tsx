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
import { type ShareLocale } from "@/lib/share-templates";
import {
  type BusinessFormValues,
  type BusinessInput,
  businessSchema,
} from "@/lib/validation/business";

import { DetailsFields, EmailField, GstFields, InvoicingFields } from "./business-fields";
import { CheckboxField } from "./checkbox-field";
import { SelectField } from "./select-field";
import { applyServerErrors } from "./server-errors";
import { useFormMessages } from "./use-form-messages";
import { WhatsAppTemplateField } from "./whatsapp-template-field";

interface SettingsFormProps {
  businessSlug: string;
  defaultValues: BusinessFormValues;
  /** The built-in WhatsApp messages, for "Use the default". */
  defaultTemplates: Record<ShareLocale, string>;
  /** Whether emails can go out at all (on Vercel, RESEND_API_KEY is set). */
  emailReady: boolean;
}

type Status = "idle" | "saved" | "error";

export function SettingsForm({
  businessSlug,
  defaultValues,
  defaultTemplates,
  emailReady,
}: SettingsFormProps) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const router = useRouter();
  const { fieldError } = useFormMessages();
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
            <SelectField
              label={t("hsnDigits")}
              hint={t("hsnDigitsHint")}
              error={fieldError(form.formState.errors.hsnDigitsRequired)}
              {...form.register("hsnDigitsRequired")}
            >
              <option value="4">{t("hsnDigits4")}</option>
              <option value="6">{t("hsnDigits6")}</option>
            </SelectField>
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("invoicing")}</h2>
            <InvoicingFields showCreditNotePrefix />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("whatsapp")}</h2>
            <p className="text-sm text-muted-foreground">{t("whatsappHint")}</p>
            <WhatsAppTemplateField
              name="whatsappTemplateEn"
              locale="en"
              defaultTemplate={defaultTemplates.en}
            />
            <WhatsAppTemplateField
              name="whatsappTemplateHi"
              locale="hi"
              defaultTemplate={defaultTemplates.hi}
            />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("dailyEmails")}</h2>
            <p className="text-sm text-muted-foreground">{t("dailyEmailsHint")}</p>
            {emailReady ? null : <p className="text-sm">{t("emailNotSetUp")}</p>}
            <CheckboxField
              label={t("emailReminders")}
              hint={t("emailRemindersHint")}
              {...form.register("emailReminders")}
            />
            <CheckboxField
              label={t("ownerDigest")}
              hint={t("ownerDigestHint")}
              {...form.register("ownerDigest")}
            />
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
