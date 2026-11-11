"use server";

import { type ActionResult } from "@/lib/action-result";
import { type RecordedPayment } from "@/lib/payment-view";
import { runAction } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import { recordPayment, voidPayment } from "@/server/services/payment.service";

// Thin: membership from the URL's slug; payment.service checks roles, validates and allocates
// under row locks. Paise go back as strings.

export async function recordPaymentAction(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<RecordedPayment>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const result = await recordPayment(ctx, input);
    return {
      paymentId: result.payment.id,
      onAccountPaise: result.onAccountPaise.toString(),
      invoices: result.invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        balancePaise: invoice.balancePaise.toString(),
      })),
    };
  });
}

export async function voidPaymentAction(
  businessSlug: string,
  paymentId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await voidPayment(ctx, paymentId, input);
    return null;
  });
}
