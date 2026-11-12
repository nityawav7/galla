"use client";

import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { type ShareLocale } from "@/lib/share-templates";
import { type BusinessFormValues } from "@/lib/validation/business";
import { renderShareTemplate, SHARE_PLACEHOLDERS } from "@/server/domain/share/whatsapp";

import { useFormMessages } from "./use-form-messages";

type TemplateName = "whatsappTemplateEn" | "whatsappTemplateHi";

/**
 * One WhatsApp message template in settings (SPEC F6): the text, buttons that insert a
 * placeholder at the cursor, "Use the default", and a preview with sample values.
 */
export function WhatsAppTemplateField({
  name,
  locale,
  defaultTemplate,
}: {
  name: TemplateName;
  locale: ShareLocale;
  defaultTemplate: string;
}) {
  const t = useTranslations("settings");
  const sheet = useTranslations("invoices.shareSheet");
  const sample = useTranslations("share.sample");
  const { fieldError } = useFormMessages();
  const { register, setValue, control, formState } = useFormContext<BusinessFormValues>();
  const value = useWatch({ control, name }) ?? "";
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const { ref: registerRef, ...field } = register(name);
  const id = useId();
  const error = fieldError(formState.errors[name]);
  const language = locale === "en" ? sheet("english") : sheet("hindi");

  const update = (next: string) => {
    setValue(name, next, { shouldDirty: true, shouldValidate: true });
  };

  const insert = (placeholder: string) => {
    const element = textarea.current;
    const token = `{${placeholder}}`;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    update(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const preview = renderShareTemplate(value, {
    customer: sample("customer"),
    shop: sample("shop"),
    number: sample("number"),
    amount: sample("amount"),
    dueDate: sample("dueDate"),
    link: sample("link"),
  });

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-text`} className="text-sm font-medium">
        {locale === "en" ? t("templateEn") : t("templateHi")}
      </label>
      <textarea
        id={`${id}-text`}
        rows={5}
        lang={locale}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
        {...field}
        ref={(element) => {
          registerRef(element);
          textarea.current = element;
        }}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div
        role="group"
        aria-label={t("placeholdersLabel", { language })}
        className="flex flex-wrap gap-1.5"
      >
        {SHARE_PLACEHOLDERS.map((placeholder) => (
          <Button
            key={placeholder}
            type="button"
            size="sm"
            variant="outline"
            title={t(`placeholders.${placeholder}`)}
            aria-label={`{${placeholder}}: ${t(`placeholders.${placeholder}`)}`}
            onClick={() => {
              insert(placeholder);
            }}
          >
            {`{${placeholder}}`}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            update(defaultTemplate);
          }}
        >
          {t("resetTemplate")}
        </Button>
      </div>
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">{t("templatePreview")}</p>
        <p lang={locale} className="break-words whitespace-pre-line">
          {preview}
        </p>
      </div>
    </div>
  );
}
