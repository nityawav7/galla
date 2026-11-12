import { createTranslator } from "next-intl";

import { APP_NAME } from "@/lib/config";
import { type ShareLocale } from "@/lib/share-templates";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { type Email } from "@/server/notifications/email";

import { html } from "./html";
import { button, emailDocument, facts, muted, paragraph, plainLink } from "./layout";

/*
 * "Email invoice" (SPEC F9, decision 3 of the Phase 10 plan): the amount due, the due date and a
 * button to the invoice's public page, where the customer views, downloads or pays by UPI. A link
 * instead of an attachment, so the customer always sees the invoice as it is now (payments
 * included). Written in the business's language.
 */

export interface InvoiceEmailInput {
  locale: ShareLocale;
  to: string;
  /** The shop's own email, so replies reach the shop; null sends without Reply-To. */
  replyTo: string | null;
  /** The customer's name, or the fallback ("Customer") for a walk-in. */
  customer: string;
  shop: string;
  /** Formatted for display, e.g. "+91 98765 43210". */
  shopPhone: string | null;
  shopGstin: string | null;
  number: string;
  /** Formatted. What is still due; when nothing is, the invoice total. */
  amount: string;
  /** Nothing is due any more. */
  paid: boolean;
  /** Formatted, or null when the invoice is due on receipt. */
  dueDate: string | null;
  link: string;
}

const MESSAGES = { en, hi } as const;

function translator(locale: ShareLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "emails.invoice" });
}

export function invoiceEmail(input: InvoiceEmailInput): Email {
  const t = translator(input.locale);
  const { shop, number, customer, amount } = input;
  const subject = t("subject", { number, shop });
  const greeting = t("greeting", { customer });
  const intro = t("intro", { shop, number });
  const dueDate = input.dueDate ?? t("onReceipt");
  const rows: [string, string][] = input.paid
    ? [
        [t("number"), number],
        [t("total"), amount],
      ]
    : [
        [t("number"), number],
        [t("amountDue"), amount],
        [t("dueDate"), dueDate],
      ];
  const status = input.paid ? t("paid") : null;
  const action = t("button");
  const contact = [
    shop,
    input.shopPhone ? t("phone", { phone: input.shopPhone }) : null,
    input.shopGstin ? t("gstin", { gstin: input.shopGstin }) : null,
  ].filter((part): part is string => part !== null);
  const reply = input.replyTo ? t("reply", { shop }) : null;
  const footer = t("footer", { app: APP_NAME, shop });

  const text = [
    greeting,
    "",
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(status ? ["", status] : []),
    "",
    `${action}: ${input.link}`,
    "",
    ...contact,
    ...(reply ? ["", reply] : []),
    "",
    footer,
  ].join("\n");

  const body = html`${paragraph(greeting)}${paragraph(intro)}${facts(rows)}${
    status ? paragraph(status) : null
  }${button(input.link, action)}${muted(html`${t("linkHint")} ${plainLink(input.link)}`)}`;
  const footerHtml = html`${contact.map((line) => muted(line))}${
    reply ? muted(reply) : null
  }${muted(footer)}`;

  return {
    to: input.to,
    subject,
    text,
    html: emailDocument({
      lang: input.locale,
      title: subject,
      preheader: input.paid ? intro : `${t("amountDue")}: ${amount} · ${dueDate}`,
      body,
      footer: footerHtml,
    }),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}
