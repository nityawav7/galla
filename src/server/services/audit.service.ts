import { auditQuerySchema } from "@/lib/validation/audit";
import { JOB_USER_ID, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import {
  type AuditSubjectIds,
  type AuditSubjectRows,
  findAuditSubjects,
  findUserNames,
  listAuditPage,
} from "@/server/db/repos/audit.repo";
import { decodeInstantCursor, encodeInstantCursor } from "@/server/db/repos/cursor";
import { listMembersWithUsers } from "@/server/db/repos/members.repo";
import {
  actionsInCategory,
  type AuditAction,
  type AuditCategory,
  type AuditChange,
  type AuditDetail,
  type AuditSubjectKind,
  type AuditSubjectRef,
  describeAuditRow,
} from "@/server/domain/audit/describe";
import { addDays, istStartOfDay } from "@/server/domain/fy";

export const AUDIT_PAGE_SIZE = 50;

export type AuditActor =
  | { kind: "member"; name: string }
  | { kind: "job" }
  | { kind: "system" }
  /** A user who has since been deleted. */
  | { kind: "unknown" };

/** Where a row links to; the page builds the URL. */
export type AuditLink =
  | { kind: "invoice" | "creditNote" | "customer" | "product"; id: string }
  | { kind: "settings" | "members" };

export interface AuditItem {
  id: string;
  at: Date;
  actor: AuditActor;
  /** Null for an action this version doesn't know. */
  action: AuditAction | null;
  category: AuditCategory | null;
  /**
   * The invoice or credit note number, customer, product or member name, or invitation email.
   * Null when there is none, or it is gone (a deleted draft) or a walk-in.
   */
  subject: string | null;
  link: AuditLink | null;
  changes: AuditChange[];
  details: AuditDetail[];
}

export interface AuditPage {
  items: AuditItem[];
  nextCursor: string | null;
}

export interface AuditFilterOptions {
  members: { userId: string; name: string }[];
}

function subjectIds(refs: readonly (AuditSubjectRef | null)[]): AuditSubjectIds {
  const ids = (kind: AuditSubjectKind, all = false) =>
    refs.flatMap((ref) =>
      ref?.kind === kind && "id" in ref && (all || ref.label === undefined) ? [ref.id] : [],
    );
  return {
    // Numbered invoices and credit notes still need their row: no row, no link.
    invoices: ids("invoice", true),
    creditNotes: ids("creditNote", true),
    customers: ids("customer"),
    products: ids("product"),
    payments: ids("payment"),
    refunds: ids("refund"),
    members: ids("member"),
  };
}

interface Lookups {
  rows: AuditSubjectRows;
  customerNames: Map<string, string>;
  userNames: Map<string, string>;
}

function resolve(
  ref: AuditSubjectRef | null,
  { rows, customerNames, userNames }: Lookups,
): { subject: string | null; link: AuditLink | null } {
  if (!ref) return { subject: null, link: null };
  const customerOf = (customerId: string | null | undefined) =>
    customerId
      ? {
          subject: customerNames.get(customerId) ?? null,
          link: { kind: "customer" as const, id: customerId },
        }
      : { subject: null, link: null };
  switch (ref.kind) {
    case "text":
      return { subject: ref.text, link: null };
    case "invoice": {
      const found = rows.invoices.find((row) => row.id === ref.id);
      return {
        subject: ref.label ?? found?.number ?? null,
        link: found ? { kind: "invoice", id: ref.id } : null,
      };
    }
    case "creditNote": {
      const found = rows.creditNotes.find((row) => row.id === ref.id);
      return {
        subject: ref.label ?? found?.number ?? null,
        link: found ? { kind: "creditNote", id: ref.id } : null,
      };
    }
    case "customer":
      return customerNames.has(ref.id) ? customerOf(ref.id) : { subject: null, link: null };
    case "product": {
      const found = rows.products.find((row) => row.id === ref.id);
      return found
        ? { subject: found.name, link: { kind: "product", id: ref.id } }
        : { subject: null, link: null };
    }
    case "payment":
      return customerOf(rows.payments.find((row) => row.id === ref.id)?.customerId);
    case "refund":
      return customerOf(rows.refunds.find((row) => row.id === ref.id)?.customerId);
    case "member": {
      const userId = rows.members.find((row) => row.id === ref.id)?.userId;
      return { subject: (userId && userNames.get(userId)) ?? null, link: { kind: "members" } };
    }
    case "user":
      return { subject: userNames.get(ref.id) ?? null, link: { kind: "members" } };
  }
}

const CATEGORY_LINKS: Partial<Record<string, AuditLink>> = {
  settings: { kind: "settings" },
  members: { kind: "members" },
};

function actorOf(actorUserId: string | null, userNames: Map<string, string>): AuditActor {
  if (actorUserId === null) return { kind: "system" };
  if (actorUserId === JOB_USER_ID) return { kind: "job" };
  const name = userNames.get(actorUserId);
  return name === undefined ? { kind: "unknown" } : { kind: "member", name };
}

/**
 * The Activity page (SPEC F11): this business's audit log, newest first, 50 at a time, as
 * words. Owners and accountants only. Raw ids, hashes and IPs never leave this function.
 */
export async function listAuditEntries(ctx: TenantContext, query: unknown): Promise<AuditPage> {
  assertCan(ctx, "audit:view");
  const { from, to, category, actor, cursor } = auditQuerySchema.parse(query);
  const db = getDb();
  const rows = await listAuditPage(db, ctx, {
    actions: category ? actionsInCategory(category) : undefined,
    actorUserId: actor,
    since: from ? istStartOfDay(from) : undefined,
    before: to ? istStartOfDay(addDays(to, 1)) : undefined,
    after: decodeInstantCursor(cursor),
    limit: AUDIT_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const described = page.map((row) => ({ row, description: describeAuditRow(row) }));
  const refs = described.map(({ description }) => description.subject);

  const subjects = await findAuditSubjects(db, ctx, subjectIds(refs));
  const customerIds = [
    ...refs.flatMap((ref) => (ref?.kind === "customer" ? [ref.id] : [])),
    ...[...subjects.payments, ...subjects.refunds].flatMap((row) =>
      row.customerId ? [row.customerId] : [],
    ),
  ];
  const userIds = [
    ...page.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
    ...subjects.members.map((row) => row.userId),
    ...refs.flatMap((ref) => (ref?.kind === "user" ? [ref.id] : [])),
  ];
  const [{ customers }, users] = await Promise.all([
    findAuditSubjects(db, ctx, {
      invoices: [],
      creditNotes: [],
      customers: customerIds,
      products: [],
      payments: [],
      refunds: [],
      members: [],
    }),
    findUserNames(db, userIds),
  ]);
  const lookups: Lookups = {
    rows: subjects,
    customerNames: new Map(customers.map((row) => [row.id, row.name])),
    userNames: new Map(users.map((row) => [row.id, row.name])),
  };

  const items = described.map(({ row, description }): AuditItem => {
    const { subject, link } = resolve(description.subject, lookups);
    return {
      id: row.id,
      at: row.at,
      actor: actorOf(row.actorUserId, lookups.userNames),
      action: description.action,
      category: description.category,
      subject,
      link: link ?? CATEGORY_LINKS[description.category ?? ""] ?? null,
      changes: description.changes,
      details: description.details,
    };
  });
  const last = page.at(-1);
  const hasMore = rows.length > AUDIT_PAGE_SIZE && last !== undefined;
  return {
    items,
    nextCursor: hasMore ? encodeInstantCursor({ at: last.atText, id: last.id }) : null,
  };
}

/** The "Who" filter: the business's current members. */
export async function getAuditFilterOptions(ctx: TenantContext): Promise<AuditFilterOptions> {
  assertCan(ctx, "audit:view");
  const members = await listMembersWithUsers(getDb(), ctx);
  return { members: members.map((member) => ({ userId: member.userId, name: member.name })) };
}
