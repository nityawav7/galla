import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type DraftLine } from "@/lib/validation/invoices";
import { ensureDemoBusiness, ensureDemoUsers, wipeDemoBusiness } from "@/server/db/admin/demo";
import { closeDb, getDb } from "@/server/db/client";
import {
  auditLogs,
  businesses,
  creditNotes,
  customers,
  invoices,
  members,
  numberSequences,
  payments,
  products,
  refunds,
  users,
} from "@/server/db/schema";
import { withTransaction } from "@/server/db/transaction";
import { DEMO_BUSINESS } from "@/server/demo/catalog";
import { DEMO_USERS } from "@/server/demo/users";
import { type DemoResetSummary, runDemoReset } from "@/server/jobs/demo-reset";
import { createDraft, issueInvoice } from "@/server/services/invoice.service";

import { createTenant, type Tenant } from "../support/tenants";
import { createUser } from "../support/users";

const db = () => getDb();
const AT = new Date("2026-11-13T04:00:00+05:30");
const TODAY = "2026-11-13";

/** What a visitor would see, without ids or tokens (which are new on every reset). */
async function shopContents(businessId: string) {
  const rows = await db()
    .select({
      number: invoices.number,
      date: invoices.invoiceDate,
      status: invoices.status,
      total: invoices.grandTotalPaise,
      paid: invoices.amountPaidPaise,
      credited: invoices.amountCreditedPaise,
      interState: invoices.isInterState,
    })
    .from(invoices)
    .where(eq(invoices.businessId, businessId))
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
  return rows.map((row) => ({
    ...row,
    total: row.total.toString(),
    paid: row.paid.toString(),
    credited: row.credited.toString(),
  }));
}

async function count(
  table: typeof payments | typeof creditNotes | typeof refunds,
  businessId: string,
) {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.businessId, businessId));
  return row?.n ?? 0;
}

let first: DemoResetSummary;
let firstContents: Awaited<ReturnType<typeof shopContents>>;
let bystander: Tenant;
let bystanderInvoice: string;

const line: Partial<DraftLine> = {
  productId: null,
  description: "Goods",
  hsnSac: "",
  unit: "NOS",
  qty: "1",
  unitPrice: "100",
  discount: "",
  rateBp: 0,
  priceIncludesTax: false,
};

beforeAll(async () => {
  // A real business with an issued invoice, which the reset must never touch.
  bystander = await createTenant();
  const draft = await createDraft(bystander.ctx, { lines: [line] });
  const issued = await issueInvoice(bystander.ctx, draft.id, { version: draft.version });
  if (issued.status !== "issued") throw new Error("not issued");
  bystanderInvoice = issued.invoice.id;

  first = await runDemoReset(AT);
  firstContents = await shopContents(first.businessId);
}, 240_000);

afterAll(async () => {
  await closeDb();
});

describe("runDemoReset", () => {
  it("builds six months of a hardware shop through the real services", async () => {
    expect(first.date).toBe(TODAY);
    expect(first.invoices).toBeGreaterThan(450);
    expect(first.creditNotes).toBeGreaterThan(5);
    expect(first.payments).toBeGreaterThan(300);
    const [business] = await db()
      .select()
      .from(businesses)
      .where(eq(businesses.id, first.businessId));
    expect(business).toMatchObject({
      slug: DEMO_BUSINESS.slug,
      isDemo: true,
      upiVpa: null,
      emailReminders: false,
      ownerDigest: false,
    });
    const [productCount] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.businessId, first.businessId));
    expect(productCount?.n).toBe(60);
    const [customerCount] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.businessId, first.businessId));
    expect(customerCount?.n).toBe(120);
  });

  it("has every kind of invoice a shop has: paid, part paid, unpaid and overdue, IGST, cancelled", () => {
    const statuses = new Set(firstContents.map((row) => row.status));
    expect(statuses).toEqual(new Set(["PAID", "PARTIALLY_PAID", "ISSUED", "CANCELLED"]));
    expect(firstContents.some((row) => row.interState)).toBe(true);
    expect(firstContents.some((row) => row.credited !== "0")).toBe(true);
    // Overdue is shown, not stored: unpaid with a due date already passed.
    expect(firstContents.every((row) => row.date < TODAY)).toBe(true);
  });

  it("numbers invoices without gaps in each financial year", async () => {
    const byFy = new Map<string, number[]>();
    for (const row of firstContents) {
      const [, fy, serial] = (row.number ?? "").split("/");
      byFy.set(fy ?? "", [...(byFy.get(fy ?? "") ?? []), Number(serial)]);
    }
    for (const serials of byFy.values()) {
      expect(serials.toSorted((a, b) => a - b)).toEqual(serials.map((_, index) => index + 1));
    }
    const sequences = await db()
      .select()
      .from(numberSequences)
      .where(
        and(eq(numberSequences.businessId, first.businessId), eq(numberSequences.series, "INV")),
      );
    for (const sequence of sequences) {
      expect(sequence.nextValue).toBe((byFy.get(sequence.fy)?.length ?? 0) + 1);
    }
  });

  it("refunds walk-in returns at the counter, and logs who did what", async () => {
    expect(await count(refunds, first.businessId)).toBeGreaterThan(0);
    const actors = await db()
      .selectDistinct({ actor: auditLogs.actorUserId })
      .from(auditLogs)
      .where(eq(auditLogs.businessId, first.businessId));
    const demoUsers = await db()
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} in ('demo-owner@galla.invalid', 'demo-staff@galla.invalid')`);
    expect(actors.map((row) => row.actor).toSorted()).toEqual(
      demoUsers.map((row) => row.id).toSorted(),
    );
  });

  it("gives the same shop when run again for the same day, and touches no real business", async () => {
    const again = await runDemoReset(AT);
    expect(again.businessId).toBe(first.businessId);
    expect({ ...again, ms: 0 }).toEqual({ ...first, ms: 0 });
    expect(await shopContents(again.businessId)).toEqual(firstContents);
    // The bystander's invoice is still there, issued.
    const [kept] = await db()
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, bystanderInvoice));
    expect(kept?.status).toBe("ISSUED");
  }, 240_000);
});

describe("demo guard rails", () => {
  it("keeps only the two demo users as members", async () => {
    const stranger = await createUser("Someone Added");
    await db()
      .insert(members)
      .values({ businessId: first.businessId, userId: stranger.id, role: "STAFF" });
    const ids = await ensureDemoUsers(
      db(),
      first.businessId,
      DEMO_USERS.map((user) => ({ ...user, passwordHash: "unused" })),
    );
    const rows = await db()
      .select({ userId: members.userId, role: members.role })
      .from(members)
      .where(eq(members.businessId, first.businessId));
    expect(rows.map((row) => row.userId).toSorted()).toEqual([...ids.values()].toSorted());
  });

  it("refuses to treat a real business as the demo, or to wipe one", async () => {
    await expect(
      ensureDemoBusiness(db(), {
        slug: bystander.business.slug,
        legalName: "x",
        tradeName: "x",
        addressLine1: "x",
        addressLine2: "",
        city: "x",
        pincode: "411001",
        stateCode: "27",
        gstScheme: "REGULAR",
        gstin: "27AAPFU0939F1ZV",
        invoicePrefix: "X",
        creditNotePrefix: "XC",
        hsnDigitsRequired: 4,
      }),
    ).rejects.toThrow("not a demo");
    await expect(wipeDemoBusiness(bystander.business.id)).rejects.toThrow("not a demo");
  });

  it("lets triggers delete issued rows only with the reset flag AND a demo business", async () => {
    const demoInvoice = firstContents[0];
    expect(demoInvoice).toBeDefined();
    const [row] = await db()
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, first.businessId),
          eq(invoices.number, demoInvoice?.number ?? ""),
        ),
      );
    // Demo business, no flag: refused.
    await expect(
      db()
        .delete(invoices)
        .where(eq(invoices.id, row?.id ?? "")),
    ).rejects.toThrow();
    // Real business, with the flag: refused.
    await expect(
      withTransaction(async (tx) => {
        await tx.execute(sql`set local galla.demo_reset = 'on'`);
        await tx.delete(invoices).where(eq(invoices.id, bystanderInvoice));
      }),
    ).rejects.toThrow();
    // Demo payments and credit notes, no flag: refused too.
    await expect(
      db().delete(payments).where(eq(payments.businessId, first.businessId)),
    ).rejects.toThrow();
    await expect(
      db().delete(creditNotes).where(eq(creditNotes.businessId, first.businessId)),
    ).rejects.toThrow();
    expect(await count(payments, first.businessId)).toBeGreaterThan(0);
    const [stillThere] = await db()
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, bystanderInvoice));
    expect(stillThere).toBeDefined();
  });
});
