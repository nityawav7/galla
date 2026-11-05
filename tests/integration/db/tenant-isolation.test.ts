import { afterAll, describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/errors";
import { getDb, closeDb } from "@/server/db/client";
import { insertAuditLog, listAuditLogs } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  archiveCustomer,
  findCustomerById,
  findCustomersByPhone,
  insertCustomer,
  listCustomers,
  updateCustomer,
} from "@/server/db/repos/customers.repo";
import {
  archiveProduct,
  findProductById,
  findProductsBySkus,
  insertProduct,
  listProducts,
  restoreProduct,
  updateProduct,
} from "@/server/db/repos/products.repo";

import {
  expectTenantIsolation,
  isolationCase,
  itIsolatesTenants,
} from "../support/tenant-isolation";
import { type Tenant } from "../support/tenants";

// Every tenant repo function, run as a user of a different business (SPEC §6.2).

afterAll(async () => {
  await closeDb();
});

const db = () => getDb();

const createProduct = (owner: Tenant) =>
  insertProduct(db(), owner.ctx, {
    name: "Owner's Basmati Rice",
    unit: "KGS",
    pricePaise: 12000n,
    rateBp: 500,
    sku: "OWNER-RICE",
  });

const createArchivedProduct = async (owner: Tenant) => {
  const product = await createProduct(owner);
  await archiveProduct(db(), owner.ctx, product.id);
  return product;
};

const createCustomer = (owner: Tenant) =>
  insertCustomer(db(), owner.ctx, { name: "Owner's Customer", phoneE164: "+919811111111" });

describe("products repo", () => {
  itIsolatesTenants({
    findProductById: isolationCase({
      arrange: createProduct,
      act: (intruder, product) => findProductById(db(), intruder.ctx, product.id),
    }),
    updateProduct: isolationCase({
      arrange: createProduct,
      act: (intruder, product) =>
        updateProduct(db(), intruder.ctx, product.id, { name: "Hijacked", pricePaise: 1n }),
      verify: async (owner, product) => {
        const after = await findProductById(db(), owner.ctx, product.id);
        expect(after).toMatchObject({ name: product.name, pricePaise: product.pricePaise });
      },
    }),
    archiveProduct: isolationCase({
      arrange: createProduct,
      act: (intruder, product) => archiveProduct(db(), intruder.ctx, product.id),
      verify: async (owner, product) => {
        expect((await findProductById(db(), owner.ctx, product.id))?.archivedAt).toBeNull();
      },
    }),
    listProducts: isolationCase({
      arrange: createProduct,
      act: (intruder) => listProducts(db(), intruder.ctx, { includeArchived: true }),
    }),
    "listProducts with search": isolationCase({
      arrange: createProduct,
      act: (intruder) => listProducts(db(), intruder.ctx, { search: "basmati" }),
    }),
    "listProducts archived only": isolationCase({
      arrange: createArchivedProduct,
      act: (intruder) => listProducts(db(), intruder.ctx, { archivedOnly: true }),
    }),
    "listProducts after a cursor": isolationCase({
      arrange: createProduct,
      act: (intruder) =>
        listProducts(db(), intruder.ctx, {
          after: { name: "", id: "00000000-0000-0000-0000-000000000000" },
        }),
    }),
    restoreProduct: isolationCase({
      arrange: createArchivedProduct,
      act: (intruder, product) => restoreProduct(db(), intruder.ctx, product.id),
      verify: async (owner, product) => {
        expect((await findProductById(db(), owner.ctx, product.id))?.archivedAt).not.toBeNull();
      },
    }),
    findProductsBySkus: isolationCase({
      arrange: createProduct,
      act: (intruder) => findProductsBySkus(db(), intruder.ctx, ["OWNER-RICE"]),
    }),
  });
});

describe("customers repo", () => {
  itIsolatesTenants({
    findCustomerById: isolationCase({
      arrange: createCustomer,
      act: (intruder, customer) => findCustomerById(db(), intruder.ctx, customer.id),
    }),
    findCustomersByPhone: isolationCase({
      arrange: createCustomer,
      act: (intruder, customer) =>
        findCustomersByPhone(db(), intruder.ctx, customer.phoneE164 ?? ""),
    }),
    updateCustomer: isolationCase({
      arrange: createCustomer,
      act: (intruder, customer) =>
        updateCustomer(db(), intruder.ctx, customer.id, { name: "Hijacked" }),
      verify: async (owner, customer) => {
        expect((await findCustomerById(db(), owner.ctx, customer.id))?.name).toBe(customer.name);
      },
    }),
    archiveCustomer: isolationCase({
      arrange: createCustomer,
      act: (intruder, customer) => archiveCustomer(db(), intruder.ctx, customer.id),
      verify: async (owner, customer) => {
        expect((await findCustomerById(db(), owner.ctx, customer.id))?.archivedAt).toBeNull();
      },
    }),
    listCustomers: isolationCase({
      arrange: createCustomer,
      act: (intruder) => listCustomers(db(), intruder.ctx, { search: "owner" }),
    }),
  });
});

describe("businesses and audit repos", () => {
  itIsolatesTenants({
    getCurrentBusiness: isolationCase({
      arrange: () => Promise.resolve(undefined),
      act: (intruder) => getCurrentBusiness(db(), intruder.ctx),
    }),
    listAuditLogs: isolationCase({
      arrange: (owner) =>
        insertAuditLog(db(), owner.ctx, {
          entity: "product",
          entityId: owner.business.id,
          action: "create",
        }),
      act: (intruder, entry) =>
        listAuditLogs(db(), intruder.ctx, { entity: entry.entity, entityId: entry.entityId }),
    }),
  });
});

describe("the isolation helper itself", () => {
  it("fails when an operation returns another business's data", async () => {
    await expect(
      expectTenantIsolation({
        arrange: createProduct,
        // Deliberately leaky: reads with the owner's context instead of the intruder's.
        act: (_intruder, product, owner) => findProductById(db(), owner.ctx, product.id),
      }),
    ).rejects.toThrow(/leaked/);
  });

  it("accepts a NotFoundError", async () => {
    await expectTenantIsolation({
      arrange: createProduct,
      act: () => Promise.reject(new NotFoundError("Product")),
    });
  });

  it("does not swallow other errors", async () => {
    await expect(
      expectTenantIsolation({
        arrange: createProduct,
        act: () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
  });
});
