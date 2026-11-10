"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { type ShareLocale } from "@/lib/share-templates";
import { renderShareTemplate, waMeLink } from "@/server/domain/share/whatsapp";
import { type ShareInfo } from "@/server/services/share.service";

/**
 * "Share on WhatsApp" (SPEC F6): pick English or Hindi, see the message, and open WhatsApp with it
 * typed to the customer. `url` is the invoice's current public link.
 */
export function WhatsAppShare({ share, url }: { share: ShareInfo; url: string }) {
  const t = useTranslations("invoices.shareSheet");
  const id = useId();
  const [locale, setLocale] = useState<ShareLocale>(share.defaultLocale);
  const { template, values } = share.messages[locale];
  const text = renderShareTemplate(template, { ...values, link: url });

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <legend className="mb-1 text-sm font-medium">{t("language")}</legend>
        {(["en", "hi"] as const).map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={`${id}-language`}
              value={option}
              checked={locale === option}
              onChange={() => {
                setLocale(option);
              }}
              className="size-4 accent-primary"
            />
            <span lang={option}>{option === "en" ? t("english") : t("hindi")}</span>
          </label>
        ))}
      </fieldset>
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">{t("message")}</p>
        <p lang={locale} aria-live="polite" className="break-words whitespace-pre-line">
          {text}
        </p>
      </div>
      {share.phone ? null : <p className="text-xs text-muted-foreground">{t("noPhone")}</p>}
      <div>
        <Button asChild size="lg">
          <a href={waMeLink(share.phone, text)} target="_blank" rel="noopener noreferrer">
            {t("button")}
            <span className="sr-only"> {t("opensWhatsApp")}</span>
          </a>
        </Button>
      </div>
    </div>
  );
}
