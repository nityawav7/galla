import { DAILY_JOB_BATCH_SIZE, DAILY_JOB_BUDGET_MS } from "@/lib/config";
import { logger } from "@/lib/logger";
import { jobContext } from "@/server/authz/context";
import { listBusinessesForDailyJob } from "@/server/db/admin/businesses";
import { getDb } from "@/server/db/client";
import { istDateFromInstant } from "@/server/domain/fy";
import { canSendEmail } from "@/server/notifications/email";
import { sendDueReminders } from "@/server/services/email-reminder.service";
import { sendOwnerDigest } from "@/server/services/owner-digest.service";

/*
 * The daily job (SPEC F9, ADR 0014), run by Vercel Cron at 09:00 IST through /api/cron/daily.
 * It pages through businesses that have work (the only cross-tenant read, in db/admin), then
 * works in each one through a normal TenantContext. It starts no new business after the time
 * budget; the rest wait for tomorrow, which the reminders' catch-up window covers. Every send is
 * idempotent, so a re-run (by hand, or a retried cron) never repeats an email.
 */

export interface DailyJobSummary {
  /** The business date (IST) the job ran for. */
  date: string;
  emailSetUp: boolean;
  businesses: number;
  reminderEmails: number;
  reminders: number;
  digests: number;
  /** Emails that failed (retried next run) plus businesses whose work threw. */
  failed: number;
  stoppedEarly: boolean;
}

export interface DailyJobOptions {
  batchSize?: number;
  budgetMs?: number;
  /** Milliseconds since the job started; injectable for tests. */
  elapsedMs?: () => number;
}

export async function runDailyJob(
  now: Date,
  options: DailyJobOptions = {},
): Promise<DailyJobSummary> {
  const started = Date.now();
  const elapsedMs = options.elapsedMs ?? (() => Date.now() - started);
  const batchSize = options.batchSize ?? DAILY_JOB_BATCH_SIZE;
  const budgetMs = options.budgetMs ?? DAILY_JOB_BUDGET_MS;
  const summary: DailyJobSummary = {
    date: istDateFromInstant(now),
    emailSetUp: canSendEmail(),
    businesses: 0,
    reminderEmails: 0,
    reminders: 0,
    digests: 0,
    failed: 0,
    stoppedEarly: false,
  };

  if (summary.emailSetUp) {
    let afterId: string | null = null;
    paging: for (;;) {
      const page = await listBusinessesForDailyJob(getDb(), { afterId, limit: batchSize });
      for (const business of page) {
        if (elapsedMs() >= budgetMs) {
          summary.stoppedEarly = true;
          break paging;
        }
        summary.businesses += 1;
        const ctx = jobContext(business.id);
        try {
          const reminders = await sendDueReminders(ctx, summary.date);
          const digest = await sendOwnerDigest(ctx, summary.date);
          summary.reminderEmails += reminders.emails;
          summary.reminders += reminders.reminders;
          summary.digests += digest.emails;
          summary.failed += reminders.failed + digest.failed;
        } catch (error) {
          summary.failed += 1;
          logger.error(
            { businessId: business.id, errorName: error instanceof Error ? error.name : "unknown" },
            "daily job failed for a business",
          );
        }
      }
      const last = page.at(-1);
      if (!last || page.length < batchSize) break;
      afterId = last.id;
    }
  }

  // One line, counts only: no names, emails or amounts (CLAUDE.md rule 9).
  logger.info(summary, "daily job finished");
  return summary;
}
