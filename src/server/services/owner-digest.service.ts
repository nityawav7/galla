import { appOrigin } from "@/lib/app-url";
import { OWNER_DIGEST_TOP } from "@/lib/config";
import { logger } from "@/lib/logger";
import { type TenantContext } from "@/server/authz/context";
import { assertJob } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { listMembersWithUsers } from "@/server/db/repos/members.repo";
import {
  claimOwnerDigest,
  findOverdueByCustomer,
  releaseOwnerDigest,
} from "@/server/db/repos/reminders.repo";
import { formatINR } from "@/server/domain/money";
import { waMeLink } from "@/server/domain/share/whatsapp";
import { type DigestCustomer, ownerDigestEmail } from "@/server/emails/owner-digest-email";
import { canSendEmail, sendEmail } from "@/server/notifications/email";

import { getReminderInfo } from "./reminder.service";

/*
 * The owner digest in one business (SPEC F9, decision 10 of the Phase 10 plan): once a day, only
 * when something is overdue, to each owner. The day is claimed in `owner_digests_sent` first, so
 * a second run sends nothing; if no owner could be emailed, the claim is given back.
 */

export interface OwnerDigestResult {
  /** Owners emailed. */
  emails: number;
  failed: number;
}

const NOTHING: OwnerDigestResult = { emails: 0, failed: 0 };

export async function sendOwnerDigest(
  ctx: TenantContext,
  today: string,
): Promise<OwnerDigestResult> {
  assertJob(ctx);
  const db = getDb();
  const business = await getCurrentBusiness(db, ctx);
  if (!business || business.isDemo || !business.ownerDigest || !canSendEmail()) return NOTHING;

  const overdue = await findOverdueByCustomer(db, ctx, today);
  if (overdue.length === 0) return NOTHING;
  const owners = (await listMembersWithUsers(db, ctx)).filter((member) => member.role === "OWNER");
  if (owners.length === 0) return NOTHING;
  if (!(await claimOwnerDigest(db, ctx, today))) return NOTHING;

  const origin = appOrigin().replace(/\/$/, "");
  const base = `${origin}/b/${business.slug}`;
  const locale = business.locale;
  const customers: DigestCustomer[] = [];
  for (const customer of overdue.slice(0, OWNER_DIGEST_TOP)) {
    // The same message as "Send reminder" on the customer page (Phase 8c).
    const reminder = await getReminderInfo(ctx, customer.customerId);
    customers.push({
      name: customer.name,
      amount: formatINR(customer.overduePaise),
      url: `${base}/customers/${customer.customerId}`,
      whatsapp: reminder ? waMeLink(reminder.phone, reminder.messages[locale]) : null,
    });
  }
  const total = formatINR(overdue.reduce((sum, customer) => sum + customer.overduePaise, 0n));

  const result = { ...NOTHING };
  for (const owner of owners) {
    try {
      await sendEmail(
        ownerDigestEmail({
          locale,
          to: owner.email,
          shop: business.tradeName ?? business.legalName,
          total,
          count: overdue.length,
          customers,
          dashboardUrl: `${base}/dashboard`,
        }),
        business,
      );
      result.emails += 1;
    } catch (error) {
      result.failed += 1;
      logger.error(
        {
          businessId: ctx.businessId,
          userId: owner.userId,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "owner digest failed",
      );
    }
  }
  // Nobody got it: let the next run try today's digest again.
  if (result.emails === 0) await releaseOwnerDigest(db, ctx, today);
  return result;
}
