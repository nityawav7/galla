import { publicInvoiceUrl } from "@/lib/app-url";
import { REMINDER_CATCH_UP_DAYS, REMINDER_STAGE_DAYS } from "@/lib/config";
import { logger } from "@/lib/logger";
import { type TenantContext } from "@/server/authz/context";
import { assertJob } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  claimEmailReminders,
  findReminderCandidates,
  type ReminderCandidate,
  releaseEmailReminders,
} from "@/server/db/repos/reminders.repo";
import { addDays, daysBetween } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import {
  type ReminderKind,
  reminderKindDue,
  reminderLookbackDays,
  type ReminderSchedule,
} from "@/server/domain/reminders/schedule";
import { reminderEmail } from "@/server/emails/reminder-email";
import { canSendEmail, sendEmail } from "@/server/notifications/email";

/*
 * The daily job's email reminders in one business (SPEC F9, decisions 6-9 of the Phase 10 plan).
 * Only with the business's switch on (off by default) and never for a demo business. Each
 * customer gets one email listing every invoice that reached a stage today. Reminders are
 * claimed in `reminders_sent` before sending, and only what was claimed goes in the email, so a
 * second run (or two at once) never sends a stage twice; a failed send gives its claims back.
 */

const SCHEDULE: ReminderSchedule = {
  stages: REMINDER_STAGE_DAYS,
  catchUpDays: REMINDER_CATCH_UP_DAYS,
};

export interface EmailReminderResult {
  /** Emails sent (one per customer). */
  emails: number;
  /** Invoice reminders inside them. */
  reminders: number;
  /** Emails that failed; their reminders go out on the next run. */
  failed: number;
}

const NOTHING: EmailReminderResult = { emails: 0, reminders: 0, failed: 0 };

interface Due extends ReminderCandidate {
  kind: ReminderKind;
}

function byCustomer(due: readonly Due[]): Due[][] {
  const groups = new Map<string, Due[]>();
  for (const invoice of due) {
    groups.set(invoice.customerId, [...(groups.get(invoice.customerId) ?? []), invoice]);
  }
  return [...groups.values()];
}

export async function sendDueReminders(
  ctx: TenantContext,
  today: string,
): Promise<EmailReminderResult> {
  assertJob(ctx);
  const db = getDb();
  const business = await getCurrentBusiness(db, ctx);
  if (!business || business.isDemo || !business.emailReminders || !canSendEmail()) return NOTHING;

  const candidates = await findReminderCandidates(db, ctx, {
    from: addDays(today, -reminderLookbackDays(SCHEDULE)),
    today,
  });
  const due = candidates.flatMap((invoice): Due[] => {
    const kind = reminderKindDue(invoice, { ...SCHEDULE, today });
    return kind ? [{ ...invoice, kind }] : [];
  });

  const result = { ...NOTHING };
  for (const invoices of byCustomer(due)) {
    const claims = await claimEmailReminders(
      db,
      ctx,
      invoices.map(({ invoiceId, kind }) => ({ invoiceId, kind })),
    );
    const claimed = invoices.filter((invoice) =>
      claims.some((claim) => claim.invoiceId === invoice.invoiceId && claim.kind === invoice.kind),
    );
    const [first] = claimed;
    if (!first) continue;
    try {
      await sendEmail(
        reminderEmail({
          locale: business.locale,
          to: first.customerEmail,
          replyTo: business.email,
          customer: first.customerName,
          shop: business.tradeName ?? business.legalName,
          shopPhone: business.phoneE164 ? formatIndianPhone(business.phoneE164) : null,
          invoices: claimed.map((invoice) => ({
            number: invoice.number,
            amount: formatINR(invoice.balancePaise),
            daysOverdue: daysBetween(invoice.dueDate ?? invoice.invoiceDate, today),
            link:
              invoice.publicToken !== null && invoice.tokenRevokedAt === null
                ? publicInvoiceUrl(invoice.publicToken)
                : null,
          })),
          total: formatINR(claimed.reduce((sum, invoice) => sum + invoice.balancePaise, 0n)),
        }),
        business,
      );
      result.emails += 1;
      result.reminders += claimed.length;
    } catch (error) {
      await releaseEmailReminders(
        db,
        ctx,
        claims.map((claim) => claim.id),
      );
      result.failed += 1;
      // Ids only (CLAUDE.md rule 9).
      logger.error(
        {
          businessId: ctx.businessId,
          customerId: first.customerId,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "reminder email failed",
      );
    }
  }
  return result;
}
