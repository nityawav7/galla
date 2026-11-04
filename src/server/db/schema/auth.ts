import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { newId } from "../ids";
import { createdAt, id } from "./common";

/*
 * Better Auth's tables (ADR 0004). Column names follow Better Auth's fields, mapped in
 * src/server/auth/auth.ts: organization → businesses, organizationId → business_id.
 * Better Auth writes these through its Drizzle adapter; our repos only read them.
 */

const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: id(),
  name: text().notNull(),
  /** Better Auth stores emails lower-cased. */
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** Required by the organization plugin but unused: the URL slug picks the business. */
    activeBusinessId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** One row per sign-in method: `credential` (password) or an OAuth provider such as google. */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text().notNull(),
    accountId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    /** Password hash (scrypt) for credential accounts. */
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("accounts_provider_account_unique").on(t.providerId, t.accountId),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

/**
 * Short-lived codes: email OTPs, OAuth state. The id is text, not uuid: Better Auth also
 * looks rows up by ids it derives itself (a hash of the identifier), which are not UUIDs.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: text().primaryKey().$defaultFn(newId),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const members = pgTable(
  "members",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("members_business_id_user_id_unique").on(t.businessId, t.userId),
    index("members_user_id_idx").on(t.userId),
    check("members_role", sql`${t.role} in ('OWNER', 'ACCOUNTANT', 'STAFF')`),
  ],
);

export const INVITATION_STATUSES = ["pending", "accepted", "rejected", "canceled"] as const;

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().notNull(),
    status: text({ enum: INVITATION_STATUSES }).notNull().default("pending"),
    inviterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("invitations_business_id_idx").on(t.businessId),
    index("invitations_email_idx").on(t.email),
    index("invitations_inviter_id_idx").on(t.inviterId),
    check("invitations_role", sql`${t.role} in ('OWNER', 'ACCOUNTANT', 'STAFF')`),
    check(
      "invitations_status",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
  ],
);
