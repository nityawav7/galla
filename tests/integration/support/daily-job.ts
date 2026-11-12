import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { type DraftLine } from "@/lib/validation/invoices";
import { jobContext, type TenantContext } from "@/server/authz/context";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { type NewBusiness } from "@/server/db/repos/businesses.repo";
import { insertMember } from "@/server/db/repos/members.repo";
import { addDays, istDateFromInstant } from "@/server/domain/fy";
import { createCustomer } from "@/server/services/customer.service";
import { createDraft, type Invoice, issueInvoice } from "@/server/services/invoice.service";

import { createTenant, type Tenant, uniqueSlug } from "./tenants";
import { createUser } from "./users";

/** Shared set-up for the daily job's tests (Phase 10b). */

export interface Shop extends Tenant {
  /** The daily job's context in this business. */
  job: TenantContext;
  ownerEmail: string;
}

/** Today's business date plus `days`. Invoices are issued today; the job runs on later days. */
export function day(days: number): string {
  return addDays(istDateFromInstant(now()), days);
}

/** A business with a real owner (for the digest) and email reminders on unless overridden. */
export async function shop(overrides: Partial<NewBusiness> = {}): Promise<Shop> {
  const tenant = await createTenant({
    tradeName: "Sharma Hardware",
    email: "shop@example.com",
    emailReminders: true,
    ...overrides,
  });
  const owner = await createUser("Ramesh Sharma");
  await insertMember(getDb(), tenant.ctx, { userId: owner.id, role: "OWNER" });
  return {
    ...tenant,
    ctx: { ...tenant.ctx, userId: owner.id },
    job: jobContext(tenant.business.id),
    ownerEmail: owner.email,
  };
}

export interface Customer {
  id: string;
  email: string | null;
}

/** A customer with `creditDays` (0 = due on receipt) and, unless null, a unique email. */
export async function customer(
  tenant: Tenant,
  options: { creditDays?: number; email?: string | null; name?: string } = {},
): Promise<Customer> {
  const email = options.email === undefined ? `${uniqueSlug("cust")}@example.com` : options.email;
  const result = await createCustomer(tenant.ctx, {
    ...EMPTY_CUSTOMER_FORM,
    name: options.name ?? "Ramesh Traders",
    email: email ?? "",
    creditDays: options.creditDays ? String(options.creditDays) : "",
  });
  if (result.status !== "saved") throw new Error("customer not saved");
  return { id: result.customer.id, email };
}

const LINE: Partial<DraftLine> = {
  productId: null,
  description: "PVC pipe",
  hsnSac: "3917",
  unit: "NOS",
  qty: "3",
  unitPrice: "100",
  discount: "",
  rateBp: 1800,
  priceIncludesTax: false,
};

/** An issued ₹354.00 invoice (₹300 + 18%) to the customer, dated today. */
export async function invoice(tenant: Tenant, to: Customer | null): Promise<Invoice> {
  const draft = await createDraft(tenant.ctx, { customerId: to?.id ?? null, lines: [LINE] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}
