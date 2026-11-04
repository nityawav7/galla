import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { insertAuditLog, listAuditLogs } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  findCustomersByPhone,
  insertCustomer,
  listCustomers,
} from "@/server/db/repos/customers.repo";
import {
  archiveProduct,
  findProductById,
  findProductsBySkus,
  insertProduct,
  insertProducts,
  listProducts,
  restoreProduct,
  updateProduct,
} from "@/server/db/repos/products.repo";
import { listStates, listTaxRates, listUnits } from "@/server/db/repos/reference.repo";
import { withTransaction } from "@/server/db/transaction";

import { createTenant, type Tenant } from "../support/tenants";

const db = () => getDb();
let shop: Tenant;

beforeAll(async () => {
  shop = await createTenant();
});

afterAll(async () => {
  await closeDb();
});

describe("products repo", () => {
  it("stamps the tenant and actor from the context, and keeps paise exact", async () => {
    const product = await insertProduct(db(), shop.ctx, {
      name: "Gold coin 10 g",
      unit: "NOS",
      pricePaise: 9_007_199_254_740_993n, // above Number.MAX_SAFE_INTEGER
      rateBp: 300,
    });
    expect(product.businessId).toBe(shop.business.id);
    expect(product.createdBy).toBe(shop.ctx.userId);
    expect((await findProductById(db(), shop.ctx, product.id))?.pricePaise).toBe(
      9_007_199_254_740_993n,
    );
  });

  it("updates, ignoring a businessId smuggled into the patch", async () => {
    const product = await insertProduct(db(), shop.ctx, {
      name: "Tea",
      unit: "PAC",
      pricePaise: 6250n,
      rateBp: 500,
    });
    const other = await createTenant();
    const patch = { pricePaise: 6500n, businessId: other.business.id };
    const updated = await updateProduct(db(), shop.ctx, product.id, patch);
    expect(updated).toMatchObject({ pricePaise: 6500n, businessId: shop.business.id });
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(product.updatedAt.getTime());
  });

  it("finds products by fuzzy name, best match first, and hides archived ones", async () => {
    const tenant = await createTenant();
    const make = (name: string) =>
      insertProduct(db(), tenant.ctx, { name, unit: "KGS", pricePaise: 100n, rateBp: 0 });
    const rice = await make("Basmati Rice 5 kg");
    await make("Brown Rice");
    await make("Sugar");
    const archived = await make("Basmati Rice Old Stock");
    await archiveProduct(db(), tenant.ctx, archived.id);

    const typo = await listProducts(db(), tenant.ctx, { search: "basmti" });
    expect(typo.map((p) => p.name)).toEqual(["Basmati Rice 5 kg"]);

    const rices = await listProducts(db(), tenant.ctx, { search: "rice" });
    expect(rices.map((p) => p.name).sort()).toEqual(["Basmati Rice 5 kg", "Brown Rice"]);

    const all = await listProducts(db(), tenant.ctx, { includeArchived: true });
    expect(all).toHaveLength(4);
    expect(await archiveProduct(db(), tenant.ctx, archived.id)).toBeUndefined();
    expect(rice.archivedAt).toBeNull();
  });

  it("treats % and _ in a search as plain text", async () => {
    const tenant = await createTenant();
    await insertProduct(db(), tenant.ctx, {
      name: "Cashback 10% pack",
      unit: "PAC",
      pricePaise: 100n,
      rateBp: 0,
    });
    await insertProduct(db(), tenant.ctx, {
      name: "Plain pack",
      unit: "PAC",
      pricePaise: 100n,
      rateBp: 0,
    });
    const found = await listProducts(db(), tenant.ctx, { search: "10%" });
    expect(found.map((p) => p.name)).toEqual(["Cashback 10% pack"]);
    expect(await listProducts(db(), tenant.ctx, { search: "_" })).toEqual([]);
  });

  it("pages A–Z after a cursor, breaking name ties by id", async () => {
    const tenant = await createTenant();
    const names = ["Bolt", "Anchor", "Bolt", "Chain", "Anchor"];
    await insertProducts(
      db(),
      tenant.ctx,
      names.map((name) => ({ name, unit: "NOS", pricePaise: 100n, rateBp: 1800 })),
    );
    const seen: string[] = [];
    let after: { name: string; id: string } | undefined;
    for (;;) {
      const page = await listProducts(db(), tenant.ctx, { limit: 2, after });
      if (page.length === 0) break;
      seen.push(...page.map((p) => p.id));
      const last = page.at(-1);
      after = last ? { name: last.name, id: last.id } : undefined;
    }
    const all = await listProducts(db(), tenant.ctx);
    expect(seen).toEqual(all.map((p) => p.id));
    expect(all.map((p) => p.name)).toEqual(["Anchor", "Anchor", "Bolt", "Bolt", "Chain"]);
  });

  it("finds products by SKU prefix, and active SKUs for the import check", async () => {
    const tenant = await createTenant();
    const make = (name: string, sku: string) =>
      insertProduct(db(), tenant.ctx, { name, unit: "NOS", pricePaise: 1n, rateBp: 0, sku });
    await make("Hammer", "HW-100");
    const old = await make("Old hammer", "HW-200");
    await archiveProduct(db(), tenant.ctx, old.id);
    expect((await listProducts(db(), tenant.ctx, { search: "hw-1" })).map((p) => p.name)).toEqual([
      "Hammer",
    ]);
    const taken = await findProductsBySkus(db(), tenant.ctx, ["HW-100", "HW-200", "HW-300"]);
    expect(taken.map((p) => p.sku)).toEqual(["HW-100"]);
    expect(await findProductsBySkus(db(), tenant.ctx, [])).toEqual([]);
  });

  it("restores archived products and lists only archived ones on request", async () => {
    const tenant = await createTenant();
    const product = await insertProduct(db(), tenant.ctx, {
      name: "Nails",
      unit: "KGS",
      pricePaise: 1n,
      rateBp: 0,
    });
    expect(await restoreProduct(db(), tenant.ctx, product.id)).toBeUndefined();
    await archiveProduct(db(), tenant.ctx, product.id);
    expect(await listProducts(db(), tenant.ctx)).toEqual([]);
    expect(await listProducts(db(), tenant.ctx, { archivedOnly: true })).toHaveLength(1);
    expect((await restoreProduct(db(), tenant.ctx, product.id))?.archivedAt).toBeNull();
    expect(await insertProducts(db(), tenant.ctx, [])).toEqual([]);
  });
});

describe("customers repo", () => {
  it("finds every active customer sharing a phone number", async () => {
    const tenant = await createTenant();
    const phone = "+919822222222";
    await insertCustomer(db(), tenant.ctx, { name: "Asha", phoneE164: phone });
    await insertCustomer(db(), tenant.ctx, { name: "Ravi", phoneE164: phone });
    const found = await findCustomersByPhone(db(), tenant.ctx, phone);
    expect(found.map((c) => c.name)).toEqual(["Asha", "Ravi"]);
    expect((await listCustomers(db(), tenant.ctx, { search: "rav" })).map((c) => c.name)).toEqual([
      "Ravi",
    ]);
  });
});

describe("businesses repo", () => {
  it("returns the context's own business", async () => {
    expect((await getCurrentBusiness(db(), shop.ctx))?.slug).toBe(shop.business.slug);
  });
});

describe("audit repo and transactions", () => {
  it("records the actor and commits with the change", async () => {
    const tenant = await createTenant();
    await withTransaction(async (tx) => {
      const product = await insertProduct(tx, tenant.ctx, {
        name: "Ghee",
        unit: "LTR",
        pricePaise: 55000n,
        rateBp: 500,
      });
      await insertAuditLog(tx, tenant.ctx, {
        entity: "product",
        entityId: product.id,
        action: "create",
        diff: { after: { name: product.name, pricePaise: product.pricePaise.toString() } },
      });
    });
    const [entry] = await listAuditLogs(db(), tenant.ctx);
    expect(entry).toMatchObject({
      actorUserId: tenant.ctx.userId,
      entity: "product",
      action: "create",
      diff: { after: { name: "Ghee", pricePaise: "55000" } },
    });
  });

  it("rolls back the change and its audit row together", async () => {
    const tenant = await createTenant();
    await expect(
      withTransaction(async (tx) => {
        const product = await insertProduct(tx, tenant.ctx, {
          name: "Paneer",
          unit: "KGS",
          pricePaise: 40000n,
          rateBp: 500,
        });
        await insertAuditLog(tx, tenant.ctx, {
          entity: "product",
          entityId: product.id,
          action: "create",
        });
        throw new Error("something later failed");
      }),
    ).rejects.toThrow("something later failed");
    expect(await listProducts(db(), tenant.ctx, { includeArchived: true })).toEqual([]);
    expect(await listAuditLogs(db(), tenant.ctx)).toEqual([]);
  });

  it("filters the audit log by entity", async () => {
    const tenant = await createTenant();
    const entry = { entityId: tenant.business.id, action: "update" };
    await insertAuditLog(db(), tenant.ctx, { ...entry, entity: "business" });
    await insertAuditLog(db(), tenant.ctx, { ...entry, entity: "product" });
    const rows = await listAuditLogs(db(), tenant.ctx, { entity: "business" });
    expect(rows.map((r) => r.entity)).toEqual(["business"]);
  });
});

describe("reference repo", () => {
  it("lists active states, rates and units", async () => {
    const states = await listStates(db());
    expect(states.map((s) => s.code)).not.toContain("28");
    expect(states.find((s) => s.code === "04")?.isUtWithoutLegislature).toBe(true);
    expect((await listStates(db(), { activeOnly: false })).map((s) => s.code)).toContain("28");

    expect((await listTaxRates(db())).map((r) => r.rateBp)).toEqual([0, 25, 300, 500, 1800, 4000]);
    expect((await listTaxRates(db(), { activeOnly: false })).map((r) => r.rateBp)).toContain(1200);
    expect((await listUnits(db())).map((u) => u.uqcCode)).toContain("KGS");
  });
});
