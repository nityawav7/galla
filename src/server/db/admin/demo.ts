import { and, eq, sql } from "drizzle-orm";

import { type Role } from "@/server/authz/context";

import {
  accounts,
  auditLogs,
  businesses,
  creditNoteLines,
  creditNotes,
  customers,
  invitations,
  invoiceLines,
  invoices,
  members,
  numberSequences,
  ownerDigestsSent,
  paymentAllocations,
  payments,
  products,
  refunds,
  remindersSent,
  users,
} from "../schema";
import { type Executor, withTransaction } from "../transaction";

/*
 * The demo business (SPEC F12, ADR 0018). Only the demo reset job uses this (ESLint lets only
 * src/server/jobs import this folder). Everything here is limited to the one business whose
 * slug is the demo slug AND whose is_demo flag is set; a real business is never touched.
 */

export interface DemoBusinessFields {
  slug: string;
  legalName: string;
  tradeName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  pincode: string;
  stateCode: string;
  gstScheme: "REGULAR";
  gstin: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  hsnDigitsRequired: number;
}

/**
 * Creates the demo business, or puts its settings back as they should be. Refuses if the slug
 * belongs to a business that isn't a demo.
 */
export async function ensureDemoBusiness(
  db: Executor,
  fields: DemoBusinessFields,
): Promise<string> {
  const settings = {
    ...fields,
    isDemo: true,
    phoneE164: null,
    email: null,
    upiVpa: null,
    roundOffEnabled: true,
    emailReminders: false,
    ownerDigest: false,
    whatsappTemplateEn: null,
    whatsappTemplateHi: null,
  };
  const [existing] = await db
    .select({ id: businesses.id, isDemo: businesses.isDemo })
    .from(businesses)
    .where(eq(businesses.slug, fields.slug));
  if (existing && !existing.isDemo) {
    throw new Error("The demo slug belongs to a business that is not a demo");
  }
  if (existing) {
    await db.update(businesses).set(settings).where(eq(businesses.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(businesses).values(settings).returning({ id: businesses.id });
  if (!created) throw new Error("insert returned no row");
  return created.id;
}

export interface DemoUserAccount {
  name: string;
  email: string;
  role: Role;
  /** Better Auth's hash of the user's password (the "Try the demo" sign-in uses it). */
  passwordHash: string;
}

/** The demo's own users and their roles in it. Returns their ids by role. */
export async function ensureDemoUsers(
  db: Executor,
  businessId: string,
  demoUsers: readonly DemoUserAccount[],
): Promise<Map<Role, string>> {
  const ids = new Map<Role, string>();
  for (const demoUser of demoUsers) {
    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, demoUser.email));
    const userId =
      found?.id ??
      (
        await db
          .insert(users)
          .values({ name: demoUser.name, email: demoUser.email, emailVerified: true })
          .returning({ id: users.id })
      )[0]?.id;
    if (!userId) throw new Error("insert returned no row");
    // Their sign-in: a credential account, as Better Auth stores one for any password.
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
    if (account) {
      await db
        .update(accounts)
        .set({ password: demoUser.passwordHash })
        .where(eq(accounts.id, account.id));
    } else {
      await db.insert(accounts).values({
        userId,
        providerId: "credential",
        accountId: userId,
        password: demoUser.passwordHash,
      });
    }
    await db
      .insert(members)
      .values({ businessId, userId, role: demoUser.role })
      .onConflictDoUpdate({
        target: [members.businessId, members.userId],
        set: { role: demoUser.role },
      });
    ids.set(demoUser.role, userId);
  }
  // Nobody else belongs to the demo (a member someone added is removed).
  const keep = [...ids.values()];
  await db.delete(members).where(
    and(
      eq(members.businessId, businessId),
      sql`${members.userId} not in (${sql.join(
        keep.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    ),
  );
  return ids;
}

/**
 * Empties the demo business: every invoice, payment, customer, product and log row, in one
 * transaction. Database triggers allow these deletes only because the transaction sets
 * `galla.demo_reset` and the business is a demo (migration 0012).
 */
export async function wipeDemoBusiness(businessId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const [business] = await tx
      .select({ isDemo: businesses.isDemo })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");
    if (!business?.isDemo) throw new Error("Refusing to wipe a business that is not a demo");
    await tx.execute(sql`set local galla.demo_reset = 'on'`);
    // Children before parents (composite foreign keys).
    for (const table of [
      auditLogs,
      remindersSent,
      ownerDigestsSent,
      paymentAllocations,
      refunds,
      payments,
      creditNoteLines,
      creditNotes,
      invoiceLines,
      invoices,
      numberSequences,
      customers,
      products,
    ]) {
      await tx.delete(table).where(eq(table.businessId, businessId));
    }
    await tx.delete(invitations).where(eq(invitations.businessId, businessId));
  });
}
