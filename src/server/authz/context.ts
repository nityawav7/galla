export const ROLES = ["OWNER", "ACCOUNTANT", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Who is acting, and in which business. Every tenant repo function requires one and filters
 * by `businessId` (SPEC §6.2, ADR 0003). Phase 4 builds it from the session and membership;
 * nothing else should construct one outside tests, seeds and jobs.
 */
export interface TenantContext {
  readonly userId: string;
  readonly businessId: string;
  readonly role: Role;
}

/**
 * The daily job's "user" (ADR 0014). No real user has this id (they are UUIDv7). The job acts
 * with owner rights in one business at a time, and rows it writes have no `created_by`.
 */
export const JOB_USER_ID = "00000000-0000-0000-0000-000000000000";

/** The context the daily job works in for one business. Only src/server/jobs builds one. */
export function jobContext(businessId: string): TenantContext {
  return { userId: JOB_USER_ID, businessId, role: "OWNER" };
}
