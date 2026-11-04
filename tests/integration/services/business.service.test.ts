import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { type BusinessFormValues, EMPTY_BUSINESS_FORM } from "@/lib/validation/business";
import { type Role, type TenantContext } from "@/server/authz/context";
import { getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { businesses, members } from "@/server/db/schema";
import {
  createBusiness,
  getBusiness,
  updateBusinessSettings,
} from "@/server/services/business.service";
import { listBusinessesForUser, resolveTenant } from "@/server/services/tenant.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant } from "../support/tenants";
import { createUser } from "../support/users";

/** A unique trade name per test, so slugs and lookups never collide across runs. */
function formFor(name = `Shop ${randomUUID().slice(0, 8)}`): BusinessFormValues {
  return {
    ...EMPTY_BUSINESS_FORM,
    legalName: `${name} Pvt Ltd`,
    tradeName: name,
    addressLine1: "12 Station Road",
    city: "Pune",
    pincode: "411001",
    stateCode: "27",
    phone: "98765 43210",
    gstScheme: "REGULAR",
    gstin: "27AAPFU0939F1ZV",
    invoicePrefix: "SH",
    upiVpa: "Shop@OKSBI",
  };
}

async function ownerOf(name?: string) {
  const user = await createUser();
  const { businessId, slug } = await createBusiness(user.id, formFor(name));
  const ctx: TenantContext = { userId: user.id, businessId, role: "OWNER" };
  return { user, ctx, slug };
}

describe("createBusiness (onboarding)", () => {
  it("creates the business, the OWNER membership and the audit row together", async () => {
    const name = `Sharma ${randomUUID().slice(0, 8)}`;
    const { user, ctx, slug } = await ownerOf(name);

    expect(slug).toBe(name.toLowerCase().replace(" ", "-"));
    const business = await getCurrentBusiness(getDb(), ctx);
    expect(business).toMatchObject({
      slug,
      legalName: `${name} Pvt Ltd`,
      phoneE164: "+919876543210",
      upiVpa: "shop@oksbi",
      invoicePrefix: "SH",
      creditNotePrefix: "CN",
      createdBy: user.id,
    });

    const [membership] = await getDb()
      .select()
      .from(members)
      .where(eq(members.businessId, ctx.businessId));
    expect(membership).toMatchObject({ userId: user.id, role: "OWNER" });

    const [audit] = await listAuditLogs(getDb(), ctx);
    expect(audit).toMatchObject({
      action: "business.created",
      entity: "business",
      entityId: ctx.businessId,
      actorUserId: user.id,
    });
  });

  it("adds a suffix when the slug is taken", async () => {
    const name = `Gupta ${randomUUID().slice(0, 8)}`;
    const first = await ownerOf(name);
    const second = await ownerOf(name);
    expect(second.slug).toMatch(new RegExp(`^${first.slug}-[a-z0-9]{4}$`));
  });

  it("stores no GSTIN for an unregistered shop", async () => {
    const user = await createUser();
    const { businessId } = await createBusiness(user.id, {
      ...formFor(),
      gstScheme: "UNREGISTERED",
    });
    const [row] = await getDb().select().from(businesses).where(eq(businesses.id, businessId));
    expect(row).toMatchObject({ gstScheme: "UNREGISTERED", gstin: null });
  });

  it("rejects invalid input with field errors and writes nothing", async () => {
    const user = await createUser();
    const form = { ...formFor(), gstin: "27AAPFU0939F1ZW" };
    const error = await createBusiness(user.id, form).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([
      { path: "gstin", message: "gstinChecksum" },
    ]);
    expect(await listBusinessesForUser(user.id)).toEqual([]);
  });

  it("rolls the business back if the membership cannot be written", async () => {
    // No such user, so the members → users foreign key fails after the business insert.
    const form = formFor();
    await expect(createBusiness(randomUUID(), form)).rejects.toThrow();
    const rows = await getDb()
      .select()
      .from(businesses)
      .where(eq(businesses.legalName, form.legalName));
    expect(rows).toEqual([]);
  });
});

describe("updateBusinessSettings", () => {
  it("saves the change and audits only the changed fields", async () => {
    const { ctx } = await ownerOf();
    const before = await getBusiness(ctx);
    const updated = await updateBusinessSettings(ctx, {
      ...formFor(before.tradeName ?? ""),
      legalName: before.legalName,
      upiVpa: "new.id@ybl",
      creditNotePrefix: "CR",
    });
    expect(updated).toMatchObject({ upiVpa: "new.id@ybl", creditNotePrefix: "CR" });
    expect(updated.slug).toBe(before.slug);

    const [latest] = await listAuditLogs(getDb(), ctx);
    expect(latest).toMatchObject({
      action: "business.updated",
      diff: {
        before: { upiVpa: "shop@oksbi", creditNotePrefix: "CN" },
        after: { upiVpa: "new.id@ybl", creditNotePrefix: "CR" },
      },
    });
  });

  it("writes no audit row when nothing changed", async () => {
    const { ctx } = await ownerOf();
    const business = await getBusiness(ctx);
    await updateBusinessSettings(ctx, {
      ...formFor(business.tradeName ?? ""),
      legalName: business.legalName,
    });
    const logs = await listAuditLogs(getDb(), ctx);
    expect(logs.map((log) => log.action)).toEqual(["business.created"]);
  });

  it.each(["ACCOUNTANT", "STAFF"] as const)(
    "is owner-only: %s gets ForbiddenError and nothing changes",
    async (role: Role) => {
      const { ctx } = await ownerOf();
      const before = await getBusiness(ctx);
      await expect(
        updateBusinessSettings({ ...ctx, role }, { ...formFor(), legalName: "Hijacked" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await getBusiness(ctx)).toEqual(before);
    },
  );

  it("rejects invalid input before touching the database", async () => {
    const { ctx } = await ownerOf();
    await expect(
      updateBusinessSettings(ctx, { ...formFor(), invoicePrefix: "CN" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("business.service tenant isolation", () => {
  itIsolatesTenants({
    getBusiness: isolationCase({
      arrange: (owner) => Promise.resolve(owner.business.id),
      act: (intruder) => getBusiness(intruder.ctx),
    }),
    updateBusinessSettings: isolationCase({
      arrange: async (owner) => getCurrentBusiness(getDb(), owner.ctx),
      act: async (intruder) => {
        await updateBusinessSettings(intruder.ctx, formFor());
      },
      verify: async (owner, before) => {
        expect(await getCurrentBusiness(getDb(), owner.ctx)).toEqual(before);
      },
    }),
  });
});

describe("resolveTenant", () => {
  it("gives a member their context and role", async () => {
    const { user, ctx, slug } = await ownerOf();
    const resolved = await resolveTenant(user.id, slug);
    expect(resolved?.ctx).toEqual(ctx);
    expect(resolved?.membership).toMatchObject({ slug, role: "OWNER" });
  });

  it("gives nothing for another business's slug: different business → not found", async () => {
    const { slug } = await ownerOf();
    const stranger = await createUser();
    expect(await resolveTenant(stranger.id, slug)).toBeNull();
  });

  it("gives nothing for a slug that does not exist", async () => {
    const user = await createUser();
    expect(await resolveTenant(user.id, `missing-${randomUUID()}`)).toBeNull();
  });

  it("lists only the user's own businesses", async () => {
    const owner = await ownerOf();
    await ownerOf();
    const second = await createBusiness(owner.user.id, formFor());
    const listed = await listBusinessesForUser(owner.user.id);
    expect(listed.map((business) => business.slug).sort()).toEqual(
      [owner.slug, second.slug].sort(),
    );
  });
});

// createTenant-based fixtures have no member rows; make sure they never resolve.
describe("resolveTenant without a membership", () => {
  it("does not resolve a business the user only created via a factory", async () => {
    const tenant = await createTenant();
    expect(await resolveTenant(tenant.ctx.userId, tenant.business.slug)).toBeNull();
  });
});
