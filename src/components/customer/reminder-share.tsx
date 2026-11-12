"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { reminderSharedAction } from "@/app/(app)/b/[businessSlug]/customers/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/observability/track";
import { type ShareLocale } from "@/lib/share-templates";
import { waMeLink } from "@/server/domain/share/whatsapp";
import { type ReminderInfo } from "@/server/services/reminder.service";

/**
 * "Send reminder" (SPEC F7, decision 11): pick English or Hindi, see the message, and open
 * WhatsApp with it typed to the customer. Opening it is recorded for the recovery metric; the
 * link opens either way.
 */
export function ReminderShare({
  businessSlug,
  customerId,
  reminder,
}: {
  businessSlug: string;
  customerId: string;
  reminder: ReminderInfo;
}) {
  const t = useTranslations("invoices.shareSheet");
  const tReminder = useTranslations("customers.ledger.reminder");
  const id = useId();
  const [locale, setLocale] = useState<ShareLocale>(reminder.defaultLocale);
  const text = reminder.messages[locale];

  return (
    <details className="group rounded-lg border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {tReminder("button")}
      </summary>
      <div className="flex flex-col gap-2 border-t p-3">
        <p className="text-sm font-medium">{tReminder("title")}</p>
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
        {reminder.phone ? null : <p className="text-xs text-muted-foreground">{t("noPhone")}</p>}
        <div>
          <Button asChild size="lg">
            <a
              href={waMeLink(reminder.phone, text)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                track("reminder_shared", { channel: "whatsapp" });
                void reminderSharedAction(businessSlug, customerId);
              }}
            >
              {t("button")}
              <span className="sr-only"> {t("opensWhatsApp")}</span>
            </a>
          </Button>
        </div>
      </div>
    </details>
  );
}
