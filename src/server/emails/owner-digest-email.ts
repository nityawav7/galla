import { createTranslator } from "next-intl";

import { APP_NAME } from "@/lib/config";
import { type ShareLocale } from "@/lib/share-templates";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { type Email } from "@/server/notifications/email";

import { html, safeHref } from "./html";
import { button, emailDocument, muted, paragraph } from "./layout";

/*
 * The owner's daily digest (SPEC F9, decision 10 of the Phase 10 plan): "₹X overdue from N
 * customers", the biggest amounts with a WhatsApp reminder link each, and the dashboard.
 */

export interface DigestCustomer {
  name: string;
  /** Formatted overdue amount. */
  amount: string;
  /** The customer's page in the app. */
  url: string;
  /** wa.me with the payment reminder typed, or null when the ledger shows nothing due. */
  whatsapp: string | null;
}

export interface OwnerDigestInput {
  locale: ShareLocale;
  to: string;
  shop: string;
  /** Formatted total overdue. */
  total: string;
  /** Customers with something overdue (all of them, not only those listed). */
  count: number;
  customers: readonly DigestCustomer[];
  dashboardUrl: string;
}

const MESSAGES = { en, hi } as const;

export function ownerDigestEmail(input: OwnerDigestInput): Email {
  const t = createTranslator({
    locale: input.locale,
    messages: MESSAGES[input.locale],
    namespace: "emails.digest",
  });
  const values = { amount: input.total, count: input.count, shop: input.shop };
  const subject = t("subject", values);
  const intro = t("intro", values);
  const more = input.count - input.customers.length;
  const moreLine = more > 0 ? t("more", { count: more }) : null;
  const remind = t("remind");
  const dashboard = t("dashboard");
  const footer = t("footer", { app: APP_NAME, shop: input.shop });
  const lines = input.customers.map((customer) => ({
    ...customer,
    text: t("line", { name: customer.name, amount: customer.amount }),
  }));

  const text = [
    intro,
    "",
    ...lines.flatMap((line) => [
      line.text,
      ...(line.whatsapp ? [`${remind}: ${line.whatsapp}`] : []),
    ]),
    ...(moreLine ? [moreLine] : []),
    "",
    `${dashboard}: ${input.dashboardUrl}`,
    "",
    footer,
  ].join("\n");

  const body = html`${paragraph(intro)}${lines.map((line) =>
    paragraph(
      html`<a href="${safeHref(line.url)}" style="color:#111827;">${line.text}</a>${
          line.whatsapp
            ? html`<br /><a href="${safeHref(line.whatsapp)}" style="color:#0f766e;">${remind}</a>`
            : null
        }`,
    ),
  )}${moreLine ? paragraph(moreLine) : null}${button(input.dashboardUrl, dashboard)}`;

  return {
    to: input.to,
    subject,
    text,
    html: emailDocument({
      lang: input.locale,
      title: subject,
      preheader: intro,
      body,
      footer: muted(footer),
    }),
  };
}
