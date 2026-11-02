import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { id } from "./common";

/**
 * Append-only (SPEC F11): repos only insert and read. Written in the same transaction as the
 * change it records. `at` replaces created_at/updated_at; `actor_user_id` replaces created_by.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    /** Null for system actions (jobs, seed). */
    actorUserId: uuid(),
    entity: text().notNull(),
    entityId: uuid().notNull(),
    action: text().notNull(),
    /** `{ before, after }` of the changed fields. Never holds secrets. */
    diff: jsonb().$type<Record<string, unknown>>(),
    /** Salted hash of the client IP, never the IP itself. */
    ipHash: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("audit_logs_entity_not_blank", sql`length(${t.entity}) > 0`),
    check("audit_logs_action_not_blank", sql`length(${t.action}) > 0`),
    index("audit_logs_business_id_at_idx").on(t.businessId, t.at),
    index("audit_logs_business_id_entity_idx").on(t.businessId, t.entity, t.entityId),
  ],
);
