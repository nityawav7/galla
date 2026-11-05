import { desc, eq } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { auditLogs } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

export type AuditLog = typeof auditLogs.$inferSelect;

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: string;
  /** Changed fields only, as `{ before, after }`. */
  diff?: Record<string, unknown> | null;
  ipHash?: string | null;
}

export interface ListAuditLogsOptions {
  entity?: string;
  entityId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 100;

/**
 * Append-only: there is no update or delete. Pass the same `tx` as the change being recorded
 * so both commit or neither does (CLAUDE.md rule 10).
 */
export async function insertAuditLog(
  db: Executor,
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<AuditLog> {
  const [row] = await db
    .insert(auditLogs)
    .values({ ...entry, businessId: ctx.businessId, actorUserId: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Several entries in one statement (one per imported row), in the same transaction. */
export async function insertAuditLogs(
  db: Executor,
  ctx: TenantContext,
  entries: readonly AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(auditLogs)
    .values(
      entries.map((entry) => ({ ...entry, businessId: ctx.businessId, actorUserId: ctx.userId })),
    );
}

export function listAuditLogs(
  db: Executor,
  ctx: TenantContext,
  { entity, entityId, limit = DEFAULT_LIMIT }: ListAuditLogsOptions = {},
): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(
      tenantScope(
        ctx,
        auditLogs,
        entity === undefined ? undefined : eq(auditLogs.entity, entity),
        entityId === undefined ? undefined : eq(auditLogs.entityId, entityId),
      ),
    )
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(limit);
}
