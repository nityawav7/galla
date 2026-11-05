"use server";

import { type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import {
  archiveCustomer,
  createCustomer,
  importCustomers,
  type ImportReport,
  type ImportResult,
  previewCustomerImport,
  restoreCustomer,
  updateCustomer,
} from "@/server/services/customer.service";

// Thin: membership from the URL's slug; customer.service checks the role and validates.

/** "saved" with the id, or the other customers who already have this phone. */
export type SaveCustomerActionResult =
  | { status: "saved"; id: string }
  | { status: "possibleDuplicate"; matches: { id: string; name: string }[] };

export async function createCustomerAction(
  businessSlug: string,
  values: unknown,
): Promise<ActionResult<SaveCustomerActionResult>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const result = await createCustomer(ctx, values);
    return result.status === "saved" ? { status: "saved", id: result.customer.id } : result;
  });
}

export async function updateCustomerAction(
  businessSlug: string,
  customerId: string,
  values: unknown,
): Promise<ActionResult<SaveCustomerActionResult>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const result = await updateCustomer(ctx, customerId, values);
    return result.status === "saved" ? { status: "saved", id: result.customer.id } : result;
  });
}

export async function archiveCustomerAction(
  businessSlug: string,
  customerId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await archiveCustomer(ctx, customerId);
    return null;
  });
}

export async function restoreCustomerAction(
  businessSlug: string,
  customerId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await restoreCustomer(ctx, customerId);
    return null;
  });
}

export async function previewCustomerImportAction(
  businessSlug: string,
  csvText: unknown,
): Promise<ActionResult<ImportReport>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    return previewCustomerImport(ctx, csvText);
  });
}

export async function importCustomersAction(
  businessSlug: string,
  csvText: unknown,
): Promise<ActionResult<ImportResult>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    return importCustomers(ctx, csvText);
  });
}
