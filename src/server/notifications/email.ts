import { Resend } from "resend";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Emails "sent" under NODE_ENV=test, so integration tests can read codes and links. */
const testOutbox: Email[] = [];

export function readTestOutbox(): readonly Email[] {
  return testOutbox;
}

export function clearTestOutbox(): void {
  testOutbox.length = 0;
}

let resend: Resend | undefined;

/**
 * Sends through Resend when RESEND_API_KEY is set. Without it: tests keep the email in an
 * outbox, local dev prints the text (never the address), and deployed environments drop it
 * with a warning. Until a domain is verified in Resend, its shared sender only reaches the
 * Resend account owner (ADR 0004).
 */
export async function sendEmail(email: Email): Promise<void> {
  if (env.RESEND_API_KEY) {
    resend ??= new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, ...email });
    if (error) {
      logger.error({ errorName: error.name }, "email send failed");
      throw new Error(`Email send failed: ${error.name}`);
    }
    return;
  }
  if (env.NODE_ENV === "test") {
    testOutbox.push(email);
    return;
  }
  if (env.NODE_ENV === "development" && !env.VERCEL_ENV) {
    logger.info({ subject: email.subject, text: email.text }, "email (dev, not sent)");
    return;
  }
  logger.warn({ subject: email.subject }, "email dropped: RESEND_API_KEY is not set");
}
