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
