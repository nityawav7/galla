import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { JOB_USER_ID, type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { newId } from "@/server/db/ids";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { insertCustomer } from "@/server/db/repos/customers.repo";
import { insertMember } from "@/server/db/repos/members.repo";
import { insertProduct } from "@/server/db/repos/products.repo";
import { auditLogs, members } from "@/server/db/schema";
import { istDateFromInstant } from "@/server/domain/fy";
import {
  AUDIT_PAGE_SIZE,
  type AuditItem,
  getAuditFilterOptions,
  listAuditEntries,
} from "@/server/services/audit.service";
import { createDraft, deleteDraft, issueInvoice } from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";
import { createUser } from "../support/users";

afterAll(async () => {
  await closeDb();
});

const db = () => getDb();
const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

const line: Partial<DraftLine> = {
  productId: null,
  description: "Goods",
  hsnSac: "",
  unit: "NOS",
  qty: "1",
  unitPrice: "500",
  discount: "",
  rateBp: 0,
  priceIncludesTax: false,
};

/** A business whose owner is a real member with a name, so "who" can be shown. */
async function shopWithOwner(name = "Asha Mehta"): Promise<Tenant> {
  const tenant = await createTenant();
  const user = await createUser(name);
  const ctx = { ...tenant.ctx, userId: user.id };
  await insertMember(db(), ctx, { userId: user.id, role: "OWNER" });
  return { ...tenant, ctx };
}

/** An audit row at a given instant, written as the context's user (or `actor`). */
async function rowAt(
  tenant: Tenant,
  at: Date,
  values: { action: string; entity?: string; entityId?: string; diff?: unknown },
  actor: string | null = tenant.ctx.userId,
): Promise<string> {
  const [row] = await db()
    .insert(auditLogs)
    .values({
      businessId: tenant.business.id,
      actorUserId: actor,
      entity: values.entity ?? "test",
      entityId: values.entityId ?? newId(),
      action: values.action,
      diff: (values.diff ?? null) as Record<string, unknown> | null,
      at,
    })
    .returning({ id: auditLogs.id });
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

function byAction(items: AuditItem[], action: string): AuditItem {
  const item = items.find((entry) => entry.action === action);
  if (!item) throw new Error(`no ${action}`);
  return item;
}

describe("listAuditEntries", () => {
  it("tells who did what to which invoice, payment and customer, newest first", async () => {
    const tenant = await shopWithOwner();
    const customer = await insertCustomer(db(), tenant.ctx, { name: "Mehta Traders" });
    const draft = await createDraft(tenant.ctx, { customerId: customer.id, lines: [line] });
    const issued = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
    if (issued.status !== "issued") throw new Error("not issued");
    await recordPayment(tenant.ctx, {
      customerId: customer.id,
      amount: "200",
      paymentDate: istDateFromInstant(new Date()),
      mode: "UPI",
      allocation: { kind: "AUTO" },
    });

    const { items, nextCursor } = await listAuditEntries(tenant.ctx, {});
    expect(nextCursor).toBeNull();
    expect(items.map((item) => item.action)).toEqual([
      "payment.recorded",
      "invoice.issued",
      "invoice.draftCreated",
    ]);
    for (const item of items) expect(item.actor).toEqual({ kind: "member", name: "Asha Mehta" });

    const payment = byAction(items, "payment.recorded");
    expect(payment.subject).toBe("Mehta Traders");
    expect(payment.link).toEqual({ kind: "customer", id: customer.id });
    expect(payment.details).toContainEqual({
      field: "amountPaise",
      value: { kind: "money", paise: 20_000n },
    });
    expect(payment.details).toContainEqual({
      field: "mode",
      value: { kind: "enum", group: "mode", value: "UPI" },
    });

    const invoice = byAction(items, "invoice.issued");
    expect(invoice.subject).toBe(issued.invoice.number);
    expect(invoice.link).toEqual({ kind: "invoice", id: issued.invoice.id });
    expect(invoice.details).toContainEqual({
      field: "grandTotalPaise",
      value: { kind: "money", paise: 50_000n },
    });
    // The draft is now that issued invoice.
    expect(byAction(items, "invoice.draftCreated").subject).toBe(issued.invoice.number);

    const text = JSON.stringify(items, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(text).not.toContain("ipHash");
    expect(text).not.toContain(tenant.ctx.userId);
  });

  it("shows a deleted draft without a link, and names products, members and invitations", async () => {
    const tenant = await shopWithOwner();
    const draft = await createDraft(tenant.ctx, { lines: [line] });
    await deleteDraft(tenant.ctx, draft.id);
    const product = await insertProduct(db(), tenant.ctx, {
      name: "Cement 50 kg",
      unit: "BAG",
      pricePaise: 42_000n,
      rateBp: 1800,
    });
    await insertAuditLog(db(), tenant.ctx, {
      entity: "product",
      entityId: product.id,
      action: "product.updated",
      diff: { before: { pricePaise: "40000" }, after: { pricePaise: "42000" } },
    });
    const staff = await createUser("Ravi Kumar");
    const memberId = newId();
    await insertMember(db(), tenant.ctx, { userId: staff.id, role: "STAFF" });
    await insertAuditLog(db(), tenant.ctx, {
      entity: "member",
      entityId: memberId,
      action: "member.removed",
      diff: { before: { userId: staff.id, role: "STAFF" } },
    });
    await insertAuditLog(db(), tenant.ctx, {
      entity: "invitation",
      entityId: newId(),
      action: "invitation.created",
      diff: { after: { email: "new@example.com", role: "ACCOUNTANT" } },
    });

    const { items } = await listAuditEntries(tenant.ctx, {});
    const created = byAction(items, "invoice.draftCreated");
    expect(created).toMatchObject({ subject: null, link: null });
    expect(byAction(items, "invoice.draftDeleted")).toMatchObject({ subject: null, link: null });
    expect(byAction(items, "product.updated")).toMatchObject({
      subject: "Cement 50 kg",
      link: { kind: "product", id: product.id },
      changes: [
        {
          field: "pricePaise",
          before: { kind: "money", paise: 40_000n },
          after: { kind: "money", paise: 42_000n },
        },
      ],
    });
    expect(byAction(items, "member.removed")).toMatchObject({
      subject: "Ravi Kumar",
      link: { kind: "members" },
    });
    expect(byAction(items, "invitation.created")).toMatchObject({
      subject: "new@example.com",
      link: { kind: "members" },
    });
  });

  it("names a member whose role changed, and falls back when the subject is gone", async () => {
    const tenant = await shopWithOwner();
    const staff = await createUser("Ravi Kumar");
    await insertMember(db(), tenant.ctx, { userId: staff.id, role: "STAFF" });
    const [member] = await db()
      .select({ id: members.id })
      .from(members)
      .where(eq(members.userId, staff.id));
    if (!member) throw new Error("no member");
    const now = Date.now();
    const at = (seconds: number) => new Date(now - seconds * 1000);
    await rowAt(tenant, at(1), {
      action: "member.role_changed",
      entityId: member.id,
      diff: { before: { role: "STAFF" }, after: { role: "ACCOUNTANT" } },
    });
    // Rows pointing at things this business doesn't have (or a walk-in's payment).
    await rowAt(tenant, at(2), {
      action: "creditNote.issued",
      diff: { after: { number: "CN/26-27/0009" } },
    });
    await rowAt(tenant, at(3), { action: "creditNote.issued" });
    await rowAt(tenant, at(4), { action: "refund.recorded" });
    await rowAt(tenant, at(5), { action: "payment.recorded" });
    await rowAt(tenant, at(6), { action: "customer.archived" });
    await rowAt(tenant, at(7), { action: "product.archived" });
    await rowAt(tenant, at(8), { action: "member.role_changed" });

    const { items } = await listAuditEntries(tenant.ctx, {});
    expect(items.map(({ action, subject, link }) => ({ action, subject, link }))).toEqual([
      { action: "member.role_changed", subject: "Ravi Kumar", link: { kind: "members" } },
      { action: "creditNote.issued", subject: "CN/26-27/0009", link: null },
      { action: "creditNote.issued", subject: null, link: null },
      { action: "refund.recorded", subject: null, link: null },
      { action: "payment.recorded", subject: null, link: null },
      { action: "customer.archived", subject: null, link: null },
      { action: "product.archived", subject: null, link: null },
      { action: "member.role_changed", subject: null, link: { kind: "members" } },
    ]);
    expect(items[0]?.changes).toEqual([
      {
        field: "role",
        before: { kind: "enum", group: "role", value: "STAFF" },
        after: { kind: "enum", group: "role", value: "ACCOUNTANT" },
      },
    ]);
  });

  it("says when the daily job, the system or a deleted user did it", async () => {
    const tenant = await createTenant();
    const now = Date.now();
    await rowAt(tenant, new Date(now - 1000), { action: "business.updated" }, null);
    await rowAt(tenant, new Date(now - 2000), { action: "business.updated" }, JOB_USER_ID);
    await rowAt(tenant, new Date(now - 3000), { action: "something.new" }, newId());

    const { items } = await listAuditEntries(tenant.ctx, {});
    expect(items.map((item) => item.actor)).toEqual([
      { kind: "system" },
      { kind: "job" },
      { kind: "unknown" },
    ]);
    expect(items[0]?.link).toEqual({ kind: "settings" });
    expect(items[2]).toMatchObject({ action: null, subject: null, link: null });
  });

  it("filters by what changed, who and dates (India time)", async () => {
    const tenant = await shopWithOwner();
    const other = await createUser("Ravi Kumar");
    // 11 Nov 23:59 IST and 12 Nov 00:00 IST.
    const lateEleventh = new Date("2026-11-11T18:29:00Z");
    const earlyTwelfth = new Date("2026-11-11T18:30:00Z");
    const payment = await rowAt(tenant, lateEleventh, { action: "payment.recorded" });
    const product = await rowAt(tenant, earlyTwelfth, { action: "product.created" });
    const applied = await rowAt(
      tenant,
      new Date("2026-11-13T05:00:00Z"),
      { action: "payment.applied" },
      other.id,
    );

    const ids = async (query: Record<string, string>) =>
      (await listAuditEntries(tenant.ctx, query)).items.map((item) => item.id);
    expect(await ids({ category: "payments" })).toEqual([applied, payment]);
    expect(await ids({ actor: other.id })).toEqual([applied]);
    expect(await ids({ from: "2026-11-12", to: "2026-11-12" })).toEqual([product]);
    expect(await ids({ to: "2026-11-11" })).toEqual([payment]);
    expect(await ids({ from: "2026-11-12", category: "payments" })).toEqual([applied]);
    // Bad filters mean no filter, never an error.
    expect(await ids({ category: "secrets", actor: "x", from: "yesterday" })).toHaveLength(3);
  });

  it("pages 50 at a time without skipping or repeating rows that share a timestamp", async () => {
    const tenant = await createTenant();
    const shared = new Date("2026-11-10T10:00:00.123Z");
    const total = AUDIT_PAGE_SIZE * 2 + 7;
    const values = Array.from({ length: total }, (_, index) => ({
      businessId: tenant.business.id,
      actorUserId: null,
      entity: "business",
      entityId: tenant.business.id,
      action: "business.updated",
      // Half share one instant; the rest differ by microseconds Postgres keeps and JS doesn't.
      at: index % 2 === 0 ? shared : new Date(shared.getTime() + index),
    }));
    await db().insert(auditLogs).values(values);
    // Some shared rows move by 1 or 2 microseconds: still ties, and differences JS can't hold.
    await db().execute(
      sql`update ${auditLogs} set at = at + floor(random() * 3) * interval '1 microsecond' where ${auditLogs.businessId} = ${tenant.business.id} and ${auditLogs.at} = ${shared.toISOString()}::timestamptz`,
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listAuditEntries(tenant.ctx, { cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    // A cursor from somewhere else starts from the first page.
    expect((await listAuditEntries(tenant.ctx, { cursor: "bm90LWEtY3Vyc29y" })).items[0]?.id).toBe(
      seen[0],
    );
  });

  it("is for owners and accountants", async () => {
    const tenant = await createTenant();
    await expect(listAuditEntries(as(tenant, "ACCOUNTANT").ctx, {})).resolves.toBeDefined();
    await expect(listAuditEntries(as(tenant, "STAFF").ctx, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getAuditFilterOptions(as(tenant, "STAFF").ctx)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("getAuditFilterOptions", () => {
  it("lists the business's members for the Who filter", async () => {
    const tenant = await shopWithOwner("Asha Mehta");
    expect(await getAuditFilterOptions(tenant.ctx)).toEqual({
      members: [{ userId: tenant.ctx.userId, name: "Asha Mehta" }],
    });
  });
});

describe("tenant isolation", () => {
  itIsolatesTenants({
    listAuditEntries: isolationCase({
      arrange: async (owner) => {
        const customer = await insertCustomer(db(), owner.ctx, { name: "Hidden Traders" });
        await insertAuditLog(db(), owner.ctx, {
          entity: "customer",
          entityId: customer.id,
          action: "customer.created",
        });
        return customer;
      },
      act: (intruder) => listAuditEntries(intruder.ctx, {}),
    }),
    "listAuditEntries (filtered by the owner's user)": isolationCase({
      arrange: async (owner) => {
        const id = await rowAt(owner, new Date(), { action: "business.updated" });
        return { id };
      },
      act: (intruder, _arranged, owner) =>
        listAuditEntries(intruder.ctx, { actor: owner.ctx.userId }),
    }),
    getAuditFilterOptions: isolationCase({
      arrange: async (owner) => {
        const user = await createUser("Owner Only");
        await insertMember(db(), owner.ctx, { userId: user.id, role: "OWNER" });
        return { id: user.id };
      },
      act: (intruder) => getAuditFilterOptions(intruder.ctx),
    }),
  });
});
