import { createTranslator } from "next-intl";

import { APP_NAME } from "@/lib/config";
import messages from "@/messages/en.json";
import { type Role } from "@/server/authz/context";
import { escapeHtml } from "@/server/emails/html";
import { type Email } from "@/server/notifications/email";

export type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

/** Emails go out in English until the recipient's language is known (Phase 10). */
const t = createTranslator({ locale: "en", messages, namespace: "emails.otp" });

const SUBJECT_KEYS = {
  "sign-in": "subject.signIn",
  "email-verification": "subject.verify",
  "forget-password": "subject.reset",
  "change-email": "subject.verify",
} as const;

export function otpEmail(to: string, otp: string, purpose: OtpPurpose): Email {
  const subject = t(SUBJECT_KEYS[purpose], { app: APP_NAME });
  const intro = t("intro", { app: APP_NAME });
  const expiry = t("expiry", { minutes: 5 });
  const ignore = t("ignore");
  return {
    to,
    subject,
    text: `${intro}\n\n${otp}\n\n${expiry}\n${ignore}`,
    html: `<p>${intro}</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${otp}</p><p>${expiry}<br>${ignore}</p>`,
  };
}

const tInvite = createTranslator({ locale: "en", messages, namespace: "emails.invite" });
const tRoles = createTranslator({ locale: "en", messages, namespace: "roles" });

export interface InviteEmailInput {
  inviterName: string;
  businessName: string;
  role: Role;
  link: string;
}

/** Shop and inviter names are typed by users, so they are escaped before going into HTML. */
export function inviteEmail(to: string, input: InviteEmailInput): Email {
  const values = {
    app: APP_NAME,
    inviter: input.inviterName,
    business: input.businessName,
    role: tRoles(input.role),
  };
  const subject = tInvite("subject", values);
  const intro = tInvite("intro", values);
  const action = tInvite("action");
  const expiry = tInvite("expiry");
  const ignore = tInvite("ignore");
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${input.link}\n\n${expiry}\n${ignore}`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(input.link)}">${escapeHtml(action)}</a></p><p>${escapeHtml(expiry)}<br>${escapeHtml(ignore)}</p>`,
  };
}
