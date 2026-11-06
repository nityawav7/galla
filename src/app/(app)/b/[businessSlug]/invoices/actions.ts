"use server";

import { type ActionResult } from "@/lib/action-result";
import { type CustomerOption, type ProductOption, toCustomerOption } from "@/lib/invoice-options";
import { runAction } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import { formatRupees } from "@/server/domain/money";
import { getCustomer, listCustomers } from "@/server/services/customer.service";
import {
  createDraft,
  deleteDraft,
  issueInvoice,
  updateDraft,
} from "@/server/services/invoice.service";
import { listProducts } from "@/server/services/product.service";

// Thin: membership from the URL's slug; the services check roles, validate and recompute.

export interface SavedDraft {
  id: string;
  version: number;
}

export type IssueActionResult =
  | { status: "issued"; id: string; number: string; grandTotalPaise: string }
  | { status: "needsConfirmation"; warnings: string[] };

export async function createDraftAction(
  businessSlug: string,
  draft: unknown,
): Promise<ActionResult<SavedDraft>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const row = await createDraft(ctx, draft);
    return { id: row.id, version: row.version };
  });
}

export async function updateDraftAction(
  businessSlug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<SavedDraft>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const row = await updateDraft(ctx, invoiceId, input);
    return { id: row.id, version: row.version };
  });
}

export async function deleteDraftAction(
  businessSlug: string,
  invoiceId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await deleteDraft(ctx, invoiceId);
    return null;
  });
}

export async function issueInvoiceAction(
  businessSlug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<IssueActionResult>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const result = await issueInvoice(ctx, invoiceId, input);
    if (result.status === "needsConfirmation") return result;
    return {
      status: "issued",
      id: result.invoice.id,
      number: result.invoice.number ?? "",
      grandTotalPaise: result.invoice.grandTotalPaise.toString(),
    };
  });
}

/** Active customers for the builder's picker (name, phone digits or GSTIN). */
export async function searchCustomersAction(
  businessSlug: string,
  q: unknown,
): Promise<ActionResult<CustomerOption[]>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const page = await listCustomers(ctx, { q });
    return page.items.slice(0, 20).map(toCustomerOption);
  });
}

/** One customer, e.g. right after creating it inline. */
export async function getCustomerOptionAction(
  businessSlug: string,
  customerId: string,
): Promise<ActionResult<CustomerOption>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    return toCustomerOption(await getCustomer(ctx, customerId));
  });
}

/** Active products for "Add item" (name or SKU). Prices travel as rupee strings. */
export async function searchProductsAction(
  businessSlug: string,
  q: unknown,
): Promise<ActionResult<ProductOption[]>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const page = await listProducts(ctx, { q });
    return page.items.slice(0, 20).map((product) => ({
      id: product.id,
      name: product.name,
      hsnSac: product.hsnSac,
      unit: product.unit,
      price: formatRupees(product.pricePaise),
      rateBp: product.rateBp,
      priceIncludesTax: product.priceIncludesTax,
    }));
  });
}
