import { createTranslator } from "next-intl";

import { APP_NAME } from "@/lib/config";
import messages from "@/messages/en.json";
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
