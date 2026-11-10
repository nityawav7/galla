import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/*
 * The built-in WhatsApp messages (SPEC F6), kept with the other strings in src/messages. They are
 * read raw, not through next-intl: `{customer}` and friends are our placeholders, not ICU ones.
 */

export const SHARE_LOCALES = ["en", "hi"] as const;
export type ShareLocale = (typeof SHARE_LOCALES)[number];

const MESSAGES = { en, hi } as const;

export function defaultShareTemplate(locale: ShareLocale): string {
  return MESSAGES[locale].share.defaultTemplate;
}

/** The words that fill a template when the invoice has no value for them. */
export function shareFallbacks(locale: ShareLocale): { customer: string; dueDate: string } {
  const { customerFallback, onReceipt } = MESSAGES[locale].share;
  return { customer: customerFallback, dueDate: onReceipt };
}

/**
 * What the database keeps: null for "the default" (also when the default was saved unchanged),
 * so a business that never edited its message gets improvements to the default.
 */
export function storedTemplate(value: string | null, locale: ShareLocale): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized === "" || normalized === defaultShareTemplate(locale) ? null : normalized;
}
