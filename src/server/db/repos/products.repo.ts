import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { products } from "../schema";
import { type Executor } from "../transaction";
import { type NameCursor } from "./cursor";
import { escapeLike, FUZZY_MATCH_THRESHOLD, type TenantOwned, tenantScope } from "./tenant";

export type Product = typeof products.$inferSelect;
export type NewProduct = Omit<typeof products.$inferInsert, TenantOwned | "archivedAt">;
export type ProductPatch = Partial<NewProduct>;

export interface ListProductsOptions {
  /** Fuzzy match on the name (pg_trgm) or an SKU prefix, best match first. */
  search?: string;
  includeArchived?: boolean;
  /** Only archived products (the "Archived" view). */
  archivedOnly?: boolean;
  limit?: number;
  /** Keyset pagination (A–Z): rows after this one. Ignored when searching. */
  after?: NameCursor;
}

const DEFAULT_LIMIT = 50;

export async function insertProduct(
  db: Executor,
  ctx: TenantContext,
  input: NewProduct,
): Promise<Product> {
  const [row] = await db
    .insert(products)
    .values({ ...input, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Several products in one statement (CSV import). Pass the import's transaction. */
export async function insertProducts(
  db: Executor,
  ctx: TenantContext,
  inputs: readonly NewProduct[],
): Promise<Product[]> {
  if (inputs.length === 0) return [];
  return db
    .insert(products)
    .values(
      inputs.map((input) => ({ ...input, businessId: ctx.businessId, createdBy: ctx.userId })),
    )
    .returning();
}

export async function findProductById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Product | undefined> {
  const [row] = await db
    .select()
    .from(products)
    .where(tenantScope(ctx, products, eq(products.id, id)));
  return row;
}

export async function updateProduct(
  db: Executor,
  ctx: TenantContext,
  id: string,
  patch: ProductPatch,
): Promise<Product | undefined> {
  const [row] = await db
    .update(products)
    // Re-asserting the tenant keeps a stray `businessId` in the patch from moving the row.
    .set({ ...patch, businessId: ctx.businessId })
    .where(tenantScope(ctx, products, eq(products.id, id)))
    .returning();
  return row;
}

/** Products used on invoices are archived, never deleted (SPEC F2). */
export async function archiveProduct(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Product | undefined> {
  const [row] = await db
    .update(products)
    .set({ archivedAt: new Date() })
    .where(tenantScope(ctx, products, eq(products.id, id), isNull(products.archivedAt)))
    .returning();
  return row;
}

export async function restoreProduct(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Product | undefined> {
  const [row] = await db
    .update(products)
    .set({ archivedAt: null })
    .where(tenantScope(ctx, products, eq(products.id, id), isNotNull(products.archivedAt)))
    .returning();
  return row;
}

/** Active products holding any of these SKUs (import duplicate check). */
export async function findProductsBySkus(
  db: Executor,
  ctx: TenantContext,
  skus: readonly string[],
): Promise<Pick<Product, "id" | "sku">[]> {
  if (skus.length === 0) return [];
  return db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(
      tenantScope(ctx, products, inArray(products.sku, [...skus]), isNull(products.archivedAt)),
    );
}

export async function listProducts(
  db: Executor,
  ctx: TenantContext,
  {
    search,
    includeArchived = false,
    archivedOnly = false,
    limit = DEFAULT_LIMIT,
    after,
  }: ListProductsOptions = {},
): Promise<Product[]> {
  const term = search?.trim();
  const matches = term
    ? or(
        sql`${products.name} ilike ${`%${escapeLike(term)}%`}`,
        sql`word_similarity(${term}, ${products.name}) >= ${FUZZY_MATCH_THRESHOLD}`,
        sql`${products.sku} ilike ${`${escapeLike(term)}%`}`,
      )
    : undefined;
  const page =
    !term && after
      ? sql`(${products.name}, ${products.id}) > (${after.name}, ${after.id}::uuid)`
      : undefined;
  return db
    .select()
    .from(products)
    .where(
      tenantScope(
        ctx,
        products,
        archivedOnly
          ? isNotNull(products.archivedAt)
          : includeArchived
            ? undefined
            : isNull(products.archivedAt),
        and(matches, page),
      ),
    )
    .orderBy(
      ...(term ? [desc(sql`word_similarity(${term}, ${products.name})`)] : []),
      asc(products.name),
      asc(products.id),
    )
    .limit(limit);
}
