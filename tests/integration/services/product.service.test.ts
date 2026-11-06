import { afterAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_PRODUCT_FORM, type ProductFormValues } from "@/lib/validation/products";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import {
  findProductById,
  insertProduct,
  insertProducts,
  listProducts as listProductRows,
} from "@/server/db/repos/products.repo";
import {
  archiveProduct,
  createProduct,
  getProduct,
  getProductFormOptions,
  importProducts,
  listProducts,
  previewProductImport,
  PRODUCTS_PAGE_SIZE,
  restoreProduct,
  updateProduct,
} from "@/server/services/product.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

const db = () => getDb();

const cement: ProductFormValues = {
  ...EMPTY_PRODUCT_FORM,
  name: "Cement 50 kg",
  hsnSac: "2523",
  unit: "BAG",
  price: "420",
  rateBp: "1800",
  sku: "CEM-50",
};

const HEADER = "name,hsn_sac,unit,price,gst_rate,price_includes_tax,sku";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

async function tenantAs(role: Role): Promise<Tenant> {
  const owner = await createTenant();
  return { ...owner, ctx: { ...owner.ctx, role } };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function issuesOf(promise: Promise<unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
}

describe("createProduct", () => {
  it.each<Role>(["OWNER", "STAFF"])("lets %s add a product, with its audit row", async (role) => {
    const { ctx } = await tenantAs(role);
    const product = await createProduct(ctx, cement);
    expect(product).toMatchObject({
      businessId: ctx.businessId,
      name: "Cement 50 kg",
      unit: "BAG",
      pricePaise: 42000n,
      rateBp: 1800,
      priceIncludesTax: false,
      sku: "CEM-50",
      createdBy: ctx.userId,
      archivedAt: null,
    });
    const [audit] = await listAuditLogs(db(), ctx, { entityId: product.id });
    expect(audit).toMatchObject({
      action: "product.created",
      entity: "product",
      actorUserId: ctx.userId,
      diff: { after: { name: "Cement 50 kg", pricePaise: "42000", sku: "CEM-50" } },
    });
  });

  it("refuses accountants", async () => {
    const { ctx } = await tenantAs("ACCOUNTANT");
    await expect(createProduct(ctx, cement)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reports invalid fields as message keys and saves nothing", async () => {
    const { ctx } = await createTenant();
    const issues = await issuesOf(
      createProduct(ctx, { ...cement, name: "", price: "abc", rateBp: "1200", unit: "ZZZ" }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "name", message: "productNameRequired" },
        { path: "price", message: "priceInvalid" },
        { path: "rateBp", message: "rateRequired" },
        { path: "unit", message: "unitRequired" },
      ]),
    );
    expect(await listProductRows(db(), ctx)).toEqual([]);
  });

  it("refuses an SKU another active product has, with no audit row", async () => {
    const { ctx } = await createTenant();
    await createProduct(ctx, cement);
    expect(await issuesOf(createProduct(ctx, { ...cement, name: "Other" }))).toEqual([
      { path: "sku", message: "skuTaken" },
    ]);
    expect(await listAuditLogs(db(), ctx)).toHaveLength(1);
  });
});

describe("updateProduct", () => {
  it("records only the fields that changed", async () => {
    const { ctx } = await createTenant();
    const product = await createProduct(ctx, cement);
    const updated = await updateProduct(ctx, product.id, { ...cement, price: "450.50" });
    expect(updated.pricePaise).toBe(45050n);
    const [audit] = await listAuditLogs(db(), ctx, { entityId: product.id });
    expect(audit).toMatchObject({
      action: "product.updated",
      diff: { before: { pricePaise: "42000" }, after: { pricePaise: "45050" } },
    });
  });

  it("writes no audit row when nothing changed", async () => {
    const { ctx } = await createTenant();
    const product = await createProduct(ctx, cement);
    await updateProduct(ctx, product.id, cement);
    expect(await listAuditLogs(db(), ctx, { entityId: product.id })).toHaveLength(1);
  });

  it("keeps a retired GST rate the product already has, but offers it to no other", async () => {
    const { ctx } = await createTenant();
    const old = await insertProduct(db(), ctx, {
      name: "Old 12% item",
      unit: "NOS",
      pricePaise: 100n,
      rateBp: 1200,
    });
    const edited = await updateProduct(ctx, old.id, {
      ...EMPTY_PRODUCT_FORM,
      name: "Renamed",
      price: "1",
      rateBp: "1200",
    });
    expect(edited).toMatchObject({ name: "Renamed", rateBp: 1200 });
    const other = await createProduct(ctx, { ...cement, sku: "" });
    expect(
      await issuesOf(updateProduct(ctx, other.id, { ...cement, sku: "", rateBp: "1200" })),
    ).toEqual([{ path: "rateBp", message: "rateRequired" }]);

    const options = await getProductFormOptions(ctx, 1200);
    expect(options.rates.map((rate) => rate.rateBp)).toContain(1200);
    expect((await getProductFormOptions(ctx)).rates.map((rate) => rate.rateBp)).not.toContain(1200);
    expect(options.units).toContainEqual({ code: "BAG", label: "Bags" });
  });

  it("maps an SKU clash to the sku field and rolls back", async () => {
    const { ctx } = await createTenant();
    await createProduct(ctx, cement);
    const other = await createProduct(ctx, { ...cement, sku: "SAND" });
    expect(await issuesOf(updateProduct(ctx, other.id, cement))).toEqual([
      { path: "sku", message: "skuTaken" },
    ]);
    expect((await findProductById(db(), ctx, other.id))?.sku).toBe("SAND");
  });

  it("treats malformed and unknown ids as not found", async () => {
    const { ctx } = await createTenant();
    await expect(updateProduct(ctx, "nope", cement)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateProduct(ctx, "01900000-0000-7000-8000-000000000000", cement),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses accountants", async () => {
    const owner = await createTenant();
    const product = await createProduct(owner.ctx, cement);
    const ctx = { ...owner.ctx, role: "ACCOUNTANT" as const };
    await expect(updateProduct(ctx, product.id, cement)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveProduct(ctx, product.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(restoreProduct(ctx, product.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getProductFormOptions(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("archiveProduct and restoreProduct", () => {
  it("archives and restores once each, auditing both", async () => {
    const { ctx } = await createTenant();
    const product = await createProduct(ctx, cement);
    expect((await archiveProduct(ctx, product.id)).archivedAt).toBeInstanceOf(Date);
    expect((await archiveProduct(ctx, product.id)).archivedAt).toBeInstanceOf(Date);
    expect((await restoreProduct(ctx, product.id)).archivedAt).toBeNull();
    expect((await restoreProduct(ctx, product.id)).archivedAt).toBeNull();
    const actions = (await listAuditLogs(db(), ctx, { entityId: product.id })).map((a) => a.action);
    expect(actions.sort()).toEqual(["product.archived", "product.created", "product.restored"]);
  });

  it("refuses to restore a product whose SKU is now used by another", async () => {
    const { ctx } = await createTenant();
    const product = await createProduct(ctx, cement);
    await archiveProduct(ctx, product.id);
    await createProduct(ctx, { ...cement, name: "New cement" });
    await expect(restoreProduct(ctx, product.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await findProductById(db(), ctx, product.id))?.archivedAt).not.toBeNull();
  });
});

describe("listProducts and getProduct", () => {
  it("walks every page without skipping or repeating a product", async () => {
    const { ctx } = await tenantAs("ACCOUNTANT");
    const total = PRODUCTS_PAGE_SIZE * 2 + 20;
    await insertProducts(
      db(),
      ctx,
      Array.from({ length: total }, (_, i) => ({
        name: `Item ${String(i % 40).padStart(2, "0")}`,
        unit: "NOS",
        pricePaise: 100n,
        rateBp: 1800,
      })),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listProducts(ctx, { cursor });
      ids.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(total);
  });

  it("searches without paging, shows archived products on request, ignores bad cursors", async () => {
    const { ctx } = await createTenant();
    const product = await createProduct(ctx, cement);
    await createProduct(ctx, { ...cement, name: "Sand", sku: "" });
    const found = await listProducts(ctx, { q: "cemnt" });
    expect(found).toEqual({
      items: [expect.objectContaining({ id: product.id })],
      nextCursor: null,
    });
    expect((await listProducts(ctx, { cursor: "garbage" })).items).toHaveLength(2);

    await archiveProduct(ctx, product.id);
    expect((await listProducts(ctx, {})).items.map((p) => p.name)).toEqual(["Sand"]);
    expect((await listProducts(ctx, { archived: "1" })).items.map((p) => p.id)).toEqual([
      product.id,
    ]);
    expect((await getProduct(ctx, product.id)).id).toBe(product.id);
    await expect(getProduct(ctx, "bad-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CSV import", () => {
  const good = (i: number) =>
    `Item ${String(i)},2523,BAG,${String(100 + i)}.50,18%,no,SKU-${String(i)}`;

  it("previews a file, writing nothing", async () => {
    const { ctx } = await createTenant();
    const report = await previewProductImport(
      ctx,
      `\uFEFF${csv(good(1), "Milk,0401,ltr,₹56.50,0,yes,")}\r\n`,
    );
    expect(report).toEqual({
      total: 2,
      valid: 2,
      issueCount: 0,
      issues: [],
      warnings: [],
      sample: [
        { line: 2, name: "Item 1", unit: "BAG", price: "₹101.50", rate: "18%", sku: "SKU-1" },
        { line: 3, name: "Milk", unit: "LTR", price: "₹56.50", rate: "0%", sku: null },
      ],
    });
    expect(await listProductRows(db(), ctx)).toEqual([]);
  });

  it("imports 500 rows in one go, well under 10 seconds, with an audit row each", async () => {
    const { ctx } = await createTenant();
    const text = csv(...Array.from({ length: 500 }, (_, i) => good(i)));
    const started = performance.now();
    const result = await importProducts(ctx, text);
    const elapsed = performance.now() - started;
    expect(result).toEqual({ status: "imported", count: 500 });
    expect(elapsed).toBeLessThan(10_000);
    expect(await listProductRows(db(), ctx, { limit: 1000 })).toHaveLength(500);
    const audits = await listAuditLogs(db(), ctx, { entity: "product", limit: 1000 });
    expect(audits).toHaveLength(500);
    expect(audits[0]?.diff).toMatchObject({ source: "csv" });
  });

  it("saves nothing when one row of 500 is bad, and names its line and column", async () => {
    const { ctx } = await createTenant();
    const rows = Array.from({ length: 500 }, (_, i) => good(i));
    rows[249] = "Broken,401,BAG,12,18,no,";
    const result = await importProducts(ctx, csv(...rows));
    expect(result).toMatchObject({
      status: "invalid",
      report: {
        total: 500,
        valid: 499,
        issueCount: 1,
        issues: [{ line: 251, column: "hsn_sac", key: "hsnLeadingZero" }],
      },
    });
    expect(await listProductRows(db(), ctx)).toEqual([]);
    expect(await listAuditLogs(db(), ctx)).toEqual([]);
  });

  it("flags SKUs repeated in the file or already used in this business", async () => {
    const { ctx } = await createTenant();
    await createProduct(ctx, cement);
    const report = await previewProductImport(
      ctx,
      csv(good(1), good(1), "Cement again,2523,BAG,1,18,no,CEM-50", "Bad rate,,NOS,1,12,maybe,"),
    );
    expect(report.issues).toEqual([
      { line: 3, column: "sku", key: "csvDuplicateInFile" },
      { line: 4, column: "sku", key: "skuTaken" },
      { line: 5, column: "gst_rate", key: "rateRequired" },
      { line: 5, column: "price_includes_tax", key: "yesNoInvalid" },
    ]);
  });

  it("reports problems with the file itself", async () => {
    const { ctx } = await createTenant();
    expect(await previewProductImport(ctx, "name,colour\nA,red")).toMatchObject({
      total: 0,
      issues: [
        { line: null, column: "colour", key: "csvUnknownColumn" },
        { line: null, column: "unit", key: "csvColumnMissing" },
        { line: null, column: "price", key: "csvColumnMissing" },
        { line: null, column: "gst_rate", key: "csvColumnMissing" },
      ],
    });
    expect(await importProducts(ctx, HEADER)).toMatchObject({
      status: "invalid",
      report: { issues: [{ key: "csvEmpty" }] },
    });
    await expect(previewProductImport(ctx, 42)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses accountants", async () => {
    const { ctx } = await tenantAs("ACCOUNTANT");
    await expect(previewProductImport(ctx, csv(good(1)))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importProducts(ctx, csv(good(1)))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("product.service isolation", () => {
  const arrange = (owner: Tenant) => createProduct(owner.ctx, cement);
  const unchanged = async (owner: Tenant, product: { id: string; archivedAt: Date | null }) => {
    const after = await findProductById(db(), owner.ctx, product.id);
    expect(after).toMatchObject({ name: cement.name, archivedAt: product.archivedAt });
  };

  itIsolatesTenants({
    listProducts: isolationCase({ arrange, act: (intruder) => listProducts(intruder.ctx, {}) }),
    "listProducts search": isolationCase({
      arrange,
      act: (intruder) => listProducts(intruder.ctx, { q: "cement" }),
    }),
    getProduct: isolationCase({
      arrange,
      act: (intruder, product) => getProduct(intruder.ctx, product.id),
    }),
    getProductFormOptions: isolationCase({
      arrange,
      act: (intruder) => getProductFormOptions(intruder.ctx),
    }),
    createProduct: isolationCase({
      arrange,
      // Same SKU in another business is fine: the clash check never looks outside the tenant.
      act: (intruder) => createProduct(intruder.ctx, cement),
      verify: async (owner) => {
        expect((await listProducts(owner.ctx, {})).items).toHaveLength(1);
      },
    }),
    updateProduct: isolationCase({
      arrange,
      act: (intruder, product) => updateProduct(intruder.ctx, product.id, { ...cement, name: "X" }),
      verify: unchanged,
    }),
    archiveProduct: isolationCase({
      arrange,
      act: (intruder, product) => archiveProduct(intruder.ctx, product.id),
      verify: unchanged,
    }),
    restoreProduct: isolationCase({
      arrange: async (owner) => archiveProduct(owner.ctx, (await arrange(owner)).id),
      act: (intruder, product) => restoreProduct(intruder.ctx, product.id),
      verify: unchanged,
    }),
    previewProductImport: isolationCase({
      arrange,
      act: async (intruder) => {
        const report = await previewProductImport(
          intruder.ctx,
          csv("Cement,2523,BAG,1,18,no,CEM-50"),
        );
        // The owner's SKU must not count as taken here.
        expect(report.issueCount).toBe(0);
        return report;
      },
    }),
    importProducts: isolationCase({
      arrange,
      act: async (intruder) => {
        const result = await importProducts(intruder.ctx, csv("Cement,2523,BAG,1,18,no,CEM-50"));
        expect(result).toEqual({ status: "imported", count: 1 });
        return result;
      },
      verify: async (owner) => {
        expect((await listProducts(owner.ctx, {})).items).toHaveLength(1);
      },
    }),
  });
});
