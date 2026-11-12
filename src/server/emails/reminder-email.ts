import { createTranslator } from "next-intl";

import { APP_NAME } from "@/lib/config";
import { type ShareLocale } from "@/lib/share-templates";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { type Email } from "@/server/notifications/email";

import { html } from "./html";
import { emailDocument, muted, paragraph, plainLink } from "./layout";

/*
 * The daily payment reminder to one customer (SPEC F9, decision 8 of the Phase 10 plan): every
 * invoice that reached a reminder stage today in one email, each with what is due and its link.
 */

export interface ReminderEmailInvoice {
  number: string;
  /** Formatted balance due. */
  amount: string;
  /** Days past the due date; 0 is "due today". */
  daysOverdue: number;
  /** The public link, or null while it is off. */
  link: string | null;
}

export interface ReminderEmailInput {
  locale: ShareLocale;
  to: string;
  replyTo: string | null;
  customer: string;
  shop: string;
  shopPhone: string | null;
  invoices: readonly ReminderEmailInvoice[];
  /** Formatted sum of the listed balances. */
  total: string;
}

const MESSAGES = { en, hi } as const;

export function reminderEmail(input: ReminderEmailInput): Email {
  const t = createTranslator({
    locale: input.locale,
    messages: MESSAGES[input.locale],
    namespace: "emails.reminder",
  });
  const { shop } = input;
  const subject = t("subject", { shop });
  const greeting = t("greeting", { customer: input.customer });
  const intro = t("intro", { shop });
  const lines = input.invoices.map((invoice) => ({
    text: t("line", {
      number: invoice.number,
      amount: invoice.amount,
      status:
        invoice.daysOverdue <= 0 ? t("dueToday") : t("overdue", { days: invoice.daysOverdue }),
    }),
    link: invoice.link,
  }));
  const total = t("total", { amount: input.total });
  const view = t("view");
  const phone = input.shopPhone ? t("phone", { phone: input.shopPhone }) : null;
  const closing = input.replyTo ? t("reply", { shop }) : t("paidAlready");
  const footer = t("footer", { app: APP_NAME, shop });

  const text = [
    greeting,
    "",
    intro,
    "",
    ...lines.flatMap((line) => (line.link ? [line.text, `${view}: ${line.link}`] : [line.text])),
    "",
    total,
    "",
    closing,
    ...(phone ? [shop, phone] : [shop]),
    "",
    footer,
  ].join("\n");

  const body = html`${paragraph(greeting)}${paragraph(intro)}${lines.map((line) =>
    paragraph(
      html`<strong>${line.text}</strong
        >${line.link ? html`<br />${view}: ${plainLink(line.link)}` : null}`,
    ),
  )}${paragraph(html`<strong>${total}</strong>`)}${paragraph(closing)}`;
  const footerHtml = html`${muted(shop)}${phone ? muted(phone) : null}${muted(footer)}`;

  return {
    to: input.to,
    subject,
    text,
    html: emailDocument({
      lang: input.locale,
      title: subject,
      preheader: total,
      body,
      footer: footerHtml,
    }),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}
