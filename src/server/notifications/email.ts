import { Resend } from "resend";

import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where replies go, e.g. the shop's own email (decision 5 of the Phase 10 plan). */
  replyTo?: string;
}

/**
 * On whose behalf an email goes: a business, or the app itself (sign-in codes). Every caller
 * must say, so demo businesses can never send email (SPEC F12), whoever calls.
 */
export type EmailSender = { readonly isDemo: boolean } | "app";

export class DemoEmailError extends ForbiddenError {
  constructor() {
    super("The demo business does not send emails");
  }
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
 * Whether an email would reach anyone (or the test outbox / the local dev log): false only on
 * Vercel without RESEND_API_KEY, where it would be dropped. Features that email customers hide
 * themselves then, rather than say "sent" for an email that never left.
 */
export function canSendEmail(): boolean {
  return Boolean(env.RESEND_API_KEY) || !env.VERCEL_ENV;
}

/**
 * Sends through Resend when RESEND_API_KEY is set. Without it: tests keep the email in an
 * outbox, local dev prints the text (never the address), and deployed environments drop it
 * with a warning. Until a domain is verified in Resend, its shared sender only reaches the
 * Resend account owner (ADR 0004). A demo business's email is refused before anything else.
 */
export async function sendEmail(email: Email, sender: EmailSender): Promise<void> {
  if (sender !== "app" && sender.isDemo) throw new DemoEmailError();
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
  // No subject: it can name the shop or the customer (CLAUDE.md rule 9).
  logger.warn("email dropped: RESEND_API_KEY is not set");
}
