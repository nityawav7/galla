import { and, asc, eq, gt, or } from "drizzle-orm";

import { businesses } from "../schema";
import { type Executor } from "../transaction";

/*
 * Cross-tenant reads for jobs (CLAUDE.md rule 3, ADR 0014). ESLint lets only src/server/jobs
 * import this folder. It returns ids and switches only; each business's own data is then read
 * through a TenantContext and the usual repos.
 */

export interface JobBusiness {
  id: string;
  emailReminders: boolean;
  ownerDigest: boolean;
}

/**
 * The next page of businesses the daily job has work for: not demo, with email reminders or the
 * owner digest on. Keyset paging by id, so a page is never skipped or repeated.
 */
export async function listBusinessesForDailyJob(
  db: Executor,
  page: { afterId: string | null; limit: number },
): Promise<JobBusiness[]> {
  return db
    .select({
      id: businesses.id,
      emailReminders: businesses.emailReminders,
      ownerDigest: businesses.ownerDigest,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.isDemo, false),
        or(eq(businesses.emailReminders, true), eq(businesses.ownerDigest, true)),
        page.afterId === null ? undefined : gt(businesses.id, page.afterId),
      ),
    )
    .orderBy(asc(businesses.id))
    .limit(page.limit);
}
