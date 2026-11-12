"use server";

import { type ActionResult } from "@/lib/action-result";
import { runAction, runMutation } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import {
  archiveProduct,
  createProduct,
  importProducts,
  type ImportReport,
  type ImportResult,
  previewProductImport,
  restoreProduct,
  updateProduct,
} from "@/server/services/product.service";

// Thin: membership from the URL's slug; product.service checks the role and validates.

export async function createProductAction(
  businessSlug: string,
  values: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const { id } = await createProduct(ctx, values);
    return { id };
  });
}

export async function updateProductAction(
  businessSlug: string,
  productId: string,
  values: unknown,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await updateProduct(ctx, productId, values);
    return null;
  });
}

export async function archiveProductAction(
  businessSlug: string,
  productId: string,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await archiveProduct(ctx, productId);
    return null;
  });
}

export async function restoreProductAction(
  businessSlug: string,
  productId: string,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await restoreProduct(ctx, productId);
    return null;
  });
}

export async function previewProductImportAction(
  businessSlug: string,
  csvText: unknown,
): Promise<ActionResult<ImportReport>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    return previewProductImport(ctx, csvText);
  });
}

export async function importProductsAction(
  businessSlug: string,
  csvText: unknown,
): Promise<ActionResult<ImportResult>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    return importProducts(ctx, csvText);
  });
}
