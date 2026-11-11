import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { paymentDateProblem, refundSchema, voidPaymentSchema } from "@/lib/validation/payments";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { findCustomerById, lockCustomer } from "@/server/db/repos/customers.repo";
import { customerCreditSums } from "@/server/db/repos/payments.repo";
import {
  findRefundById,
  insertRefund,
  listCustomerRefunds,
  lockRefund,
  markRefundVoided,
  type Refund,
} from "@/server/db/repos/refunds.repo";
import { withTransaction } from "@/server/db/transaction";
import { istDateFromInstant } from "@/server/domain/fy";
import { customerCredit } from "@/server/domain/ledger/customer-credit";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * Refunds (ADR 0011, decision 13 of the Phase 8 plan): the owner pays back money a customer has
 * on account, in cash, UPI and so on. Never more than is on account (checked under the customer
 * lock, and again by a database trigger at commit). Never edited or deleted: voided, with a
 * reason, like a payment. Both write an audit row in the same transaction.
 */

export type { Refund };

function invalid(path: string, message: string): ValidationError {
  return new ValidationError("Some fields need attention", [{ path, message }]);
}

export async function refundCredit(
  ctx: TenantContext,
  customerId: string,
  input: unknown,
): Promise<Refund> {
  assertCan(ctx, "payment:void");
  const id = requireId(customerId, "Customer");
  const values = parseInput(refundSchema, input);
  const dateProblem = paymentDateProblem(values.refundDate, istDateFromInstant(now()));
  if (dateProblem) throw invalid("refundDate", dateProblem);

  return withTransaction(async (tx) => {
    const customer = await lockCustomer(tx, ctx, id);
    if (!customer) throw new NotFoundError("Customer");
    const sums = await customerCreditSums(tx, ctx, customer.id);
    const credit = customerCredit({ openingBalancePaise: customer.openingBalancePaise, ...sums });
    if (values.amount > credit.onAccountPaise) throw invalid("amount", "refundExceedsOnAccount");

    const refund = await insertRefund(tx, ctx, {
      customerId: customer.id,
      creditNoteId: null,
      refundDate: values.refundDate,
      amountPaise: values.amount,
      mode: values.mode,
      reference: values.reference,
      notes: values.notes,
    });
    await insertAuditLog(tx, ctx, {
      entity: "refund",
      entityId: refund.id,
      action: "refund.recorded",
      diff: {
        after: {
          customerId: customer.id,
          amountPaise: refund.amountPaise.toString(),
          mode: refund.mode,
          refundDate: refund.refundDate,
          onAccountPaise: (credit.onAccountPaise - refund.amountPaise).toString(),
        },
      },
    });
    return refund;
  });
}

/**
 * Voids a refund (owner only): the money counts as on account again. A walk-in's counter refund
 * belongs to its credit note and stays (there is no account to put the money back on).
 */
export async function voidRefund(ctx: TenantContext, id: string, input: unknown): Promise<Refund> {
  assertCan(ctx, "payment:void");
  const refundId = requireId(id, "Refund");
  const { reason } = parseInput(voidPaymentSchema, input);

  return withTransaction(async (tx) => {
    const found = await findRefundById(tx, ctx, refundId);
    if (!found) throw new NotFoundError("Refund");
    if (found.customerId === null) throw new ConflictError("walkInRefundFinal");
    await lockCustomer(tx, ctx, found.customerId);
    const refund = await lockRefund(tx, ctx, refundId);
    if (!refund) throw new NotFoundError("Refund");
    if (refund.voidedAt !== null) throw new ConflictError("refundAlreadyVoided");
    const voided = await markRefundVoided(tx, ctx, refund.id, {
      voidedAt: now(),
      voidReason: reason,
    });
    if (!voided) throw new Error("locked refund changed while voiding");
    await insertAuditLog(tx, ctx, {
      entity: "refund",
      entityId: refund.id,
      action: "refund.voided",
      diff: {
        before: { voided: false },
        after: { voided: true, reason, amountPaise: refund.amountPaise.toString() },
      },
    });
    return voided;
  });
}

/** A customer's refunds, newest first, voided ones too (the customer page). */
export async function listRefunds(ctx: TenantContext, customerId: string): Promise<Refund[]> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const customer = await findCustomerById(db, ctx, requireId(customerId, "Customer"));
  if (!customer) throw new NotFoundError("Customer");
  return listCustomerRefunds(db, ctx, customer.id);
}
