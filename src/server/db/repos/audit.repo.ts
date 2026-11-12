import { desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import {
  auditLogs,
  creditNotes,
  customers,
  invoices,
  members,
  payments,
  products,
  refunds,
  users,
} from "../schema";
import { type Executor } from "../transaction";
import { type InstantCursor } from "./cursor";
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

export interface AuditPageOptions {
  /** Only these actions (a category filter); undefined for all. */
  actions?: readonly string[];
  actorUserId?: string;
  /** From this instant (inclusive) to `before` (exclusive). */
  since?: Date;
  before?: Date;
  after?: InstantCursor;
  limit: number;
}

export interface AuditPageRow extends AuditLog {
  /** Postgres's text of `at`, microseconds kept, for the next page's cursor. */
  atText: string;
}

/** The Activity page: newest first, keyset paging on (at, id), served by (business_id, at). */
export function listAuditPage(
  db: Executor,
  ctx: TenantContext,
  options: AuditPageOptions,
): Promise<AuditPageRow[]> {
  const conditions: (SQL | undefined)[] = [
    options.actions ? inArray(auditLogs.action, [...options.actions]) : undefined,
    options.actorUserId ? eq(auditLogs.actorUserId, options.actorUserId) : undefined,
    options.since ? gte(auditLogs.at, options.since) : undefined,
    options.before ? lt(auditLogs.at, options.before) : undefined,
    options.after
      ? sql`(${auditLogs.at}, ${auditLogs.id}) < (${options.after.at}::timestamptz, ${options.after.id}::uuid)`
      : undefined,
  ];
  return db
    .select({ ...getAuditColumns(), atText: sql<string>`${auditLogs.at}::text` })
    .from(auditLogs)
    .where(tenantScope(ctx, auditLogs, ...conditions))
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(options.limit);
}

function getAuditColumns() {
  return {
    id: auditLogs.id,
    businessId: auditLogs.businessId,
    actorUserId: auditLogs.actorUserId,
    entity: auditLogs.entity,
    entityId: auditLogs.entityId,
    action: auditLogs.action,
    diff: auditLogs.diff,
    ipHash: auditLogs.ipHash,
    at: auditLogs.at,
  };
}

export interface AuditSubjectIds {
  invoices: readonly string[];
  creditNotes: readonly string[];
  customers: readonly string[];
  products: readonly string[];
  payments: readonly string[];
  refunds: readonly string[];
  members: readonly string[];
}

export interface AuditSubjectRows {
  invoices: { id: string; number: string | null }[];
  creditNotes: { id: string; number: string }[];
  customers: { id: string; name: string }[];
  products: { id: string; name: string }[];
  /** customerId is null for a walk-in. */
  payments: { id: string; customerId: string | null }[];
  refunds: { id: string; customerId: string | null }[];
  members: { id: string; userId: string }[];
}

function byIds<T>(ids: readonly string[], query: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? Promise.resolve([]) : query([...new Set(ids)]);
}

/**
 * What a page of audit rows points at, each kind in one query, all inside the business.
 * Something since deleted (a draft) is simply missing.
 */
export async function findAuditSubjects(
  db: Executor,
  ctx: TenantContext,
  ids: AuditSubjectIds,
): Promise<AuditSubjectRows> {
  const [
    invoiceRows,
    creditNoteRows,
    customerRows,
    productRows,
    paymentRows,
    refundRows,
    memberRows,
  ] = await Promise.all([
    byIds(ids.invoices, (list) =>
      db
        .select({ id: invoices.id, number: invoices.number })
        .from(invoices)
        .where(tenantScope(ctx, invoices, inArray(invoices.id, list))),
    ),
    byIds(ids.creditNotes, (list) =>
      db
        .select({ id: creditNotes.id, number: creditNotes.number })
        .from(creditNotes)
        .where(tenantScope(ctx, creditNotes, inArray(creditNotes.id, list))),
    ),
    byIds(ids.customers, (list) =>
      db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(tenantScope(ctx, customers, inArray(customers.id, list))),
    ),
    byIds(ids.products, (list) =>
      db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(tenantScope(ctx, products, inArray(products.id, list))),
    ),
    byIds(ids.payments, (list) =>
      db
        .select({ id: payments.id, customerId: payments.customerId })
        .from(payments)
        .where(tenantScope(ctx, payments, inArray(payments.id, list))),
    ),
    byIds(ids.refunds, (list) =>
      db
        .select({ id: refunds.id, customerId: refunds.customerId })
        .from(refunds)
        .where(tenantScope(ctx, refunds, inArray(refunds.id, list))),
    ),
    byIds(ids.members, (list) =>
      db
        .select({ id: members.id, userId: members.userId })
        .from(members)
        .where(tenantScope(ctx, members, inArray(members.id, list))),
    ),
  ]);
  return {
    invoices: invoiceRows,
    creditNotes: creditNoteRows,
    customers: customerRows,
    products: productRows,
    payments: paymentRows,
    refunds: refundRows,
    members: memberRows,
  };
}

/**
 * Names of the people a page of audit rows mentions (who did it, a removed member). Users aren't
 * a tenant table: pass only ids read from this business's own audit rows and members, as
 * audit.service does, so a page can only ever name people who acted in or belonged to it.
 */
export function findUserNames(
  db: Executor,
  userIds: readonly string[],
): Promise<{ id: string; name: string }[]> {
  return byIds(userIds, (list) =>
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list)),
  );
}
