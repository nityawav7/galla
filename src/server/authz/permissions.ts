import { ForbiddenError } from "@/lib/errors";

import { type Role, type TenantContext } from "./context";

/**
 * The SPEC §2.1 permission matrix, defined once. Services call `assertCan` before doing
 * anything; the UI may call `can` to hide controls, but that is never the check.
 */
const MATRIX = {
  /** Business settings, members and invites, deleting the business. */
  "business:manage": ["OWNER"],
  /** Create and edit products and customers. */
  "catalog:write": ["OWNER", "STAFF"],
  /** Create drafts and issue invoices. */
  "invoice:issue": ["OWNER", "STAFF"],
  /** Cancel an invoice or issue a credit note. */
  "invoice:cancel": ["OWNER"],
  /** Copy an invoice's public link or share it on WhatsApp (Phase 7). */
  "invoice:share": ["OWNER", "STAFF"],
  /** Turn an invoice's public link off or replace it with a new one (SPEC F5). */
  "invoice:manageLink": ["OWNER"],
  "payment:record": ["OWNER", "ACCOUNTANT", "STAFF"],
  /** View invoices, the ledger and the dashboard. */
  "records:view": ["OWNER", "ACCOUNTANT", "STAFF"],
  /** Money totals on the dashboard (hidden from staff). */
  "dashboard:viewTotals": ["OWNER", "ACCOUNTANT"],
  /** GST exports and reports. */
  "reports:export": ["OWNER", "ACCOUNTANT"],
  "audit:view": ["OWNER", "ACCOUNTANT"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof MATRIX;

export const ACTIONS = Object.keys(MATRIX) as Action[];

export function can(ctx: Pick<TenantContext, "role">, action: Action): boolean {
  const allowed: readonly Role[] = MATRIX[action];
  return allowed.includes(ctx.role);
}

export function assertCan(ctx: Pick<TenantContext, "role">, action: Action): void {
  if (!can(ctx, action)) throw new ForbiddenError();
}
