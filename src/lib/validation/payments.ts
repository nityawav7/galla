import { z } from "zod";

import { PAYMENT_BACKDATE_DAYS, PAYMENT_MAX_PAISE } from "@/lib/config";
import { parseScaled } from "@/server/domain/decimal";
import { addDays, isValidIsoDate } from "@/server/domain/fy";

/**
 * Payments (SPEC F7), shared by the record-payment form and payment.service. **No balance or
 * total field**: the server works out what is due under row locks (CLAUDE.md rule 2), and unknown
 * keys are stripped.
 */

export const PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Stands for the customer's opening balance in a list of allocations. */
export const OPENING_BALANCE = "OPENING";

export const MAX_ALLOCATIONS = 100;

function rupees(invalid: string) {
  return (value: string, ctx: z.RefinementCtx): bigint => {
    const paise = parseScaled(value.replace(/^(₹|rs\.?)\s*/i, ""), 2);
    if (paise === null) {
      ctx.addIssue({ code: "custom", message: invalid });
      return z.NEVER;
    }
    return paise;
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "textTooLong" })
    .default("")
    .transform((value) => (value === "" ? null : value));

const allocationItem = z.object({
  /** An invoice id, or OPENING_BALANCE for the customer's opening balance owed. */
  invoiceId: z.union([z.literal(OPENING_BALANCE), z.uuid({ error: "invoiceNotOpen" })]),
  amount: z.string().trim().transform(rupees("allocationInvalid")),
});

/** "Oldest first" lets the server choose; "MANUAL" names each invoice and amount. */
export const allocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("AUTO") }),
  z.object({
    kind: z.literal("MANUAL"),
    items: z.array(allocationItem).max(MAX_ALLOCATIONS, { error: "allocationTooMany" }),
  }),
]);

const amountSchema = z
  .string()
  .trim()
  .transform(rupees("paymentAmountInvalid"))
  .refine((paise) => paise > 0n, { error: "paymentAmountPositive" })
  .refine((paise) => paise <= PAYMENT_MAX_PAISE, { error: "paymentAmountTooHigh" });

export const recordPaymentSchema = z.object({
  /** Null only to pay a walk-in invoice, with one MANUAL item for the whole amount. */
  customerId: z.uuid({ error: "customerRequired" }).nullable(),
  amount: amountSchema,
  /** Checked against today with `paymentDateProblem` (it depends on the clock). */
  paymentDate: z.string().refine(isValidIsoDate, { error: "paymentDateInvalid" }),
  mode: z.enum(PAYMENT_MODES, { error: "paymentModeRequired" }),
  /** UTR, cheque or card reference. */
  reference: optionalText(50),
  notes: optionalText(200),
  allocation: allocationSchema,
});

export type RecordPaymentValues = z.input<typeof recordPaymentSchema>;
export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type AllocationInput = z.output<typeof allocationSchema>;

/**
 * A payment is dated today or earlier, at most PAYMENT_BACKDATE_DAYS back (decision 13 of the
 * Phase 8 plan). Returns a validation key, or null when the date is fine.
 */
export function paymentDateProblem(
  date: string,
  today: string,
): "paymentDateFuture" | "paymentDateTooOld" | null {
  if (date > today) return "paymentDateFuture";
  if (date < addDays(today, -PAYMENT_BACKDATE_DAYS)) return "paymentDateTooOld";
  return null;
}

/** Quick picks for the void dialog; any other reason can be typed. */
export const VOID_REASONS = ["enteredByMistake", "chequeBounced", "wrongCustomer"] as const;

export const voidPaymentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, { error: "voidReasonRequired" })
    .max(200, { error: "textTooLong" }),
});

/** "Apply advance": money on account to open invoices or the opening balance. */
export const applyCreditSchema = z.object({ allocation: allocationSchema });

const optionalIsoDate = z.iso.date().optional().catch(undefined);

/** Payment list filters from the URL. Bad values fall back to "no filter", never an error. */
export const paymentListQuerySchema = z.object({
  customer: z.uuid().optional().catch(undefined),
  from: optionalIsoDate,
  to: optionalIsoDate,
  cursor: z.string().max(500).optional().catch(undefined),
});

/** Options for the record-payment form and the ledger's "Apply advance". */
export const paymentOptionsQuerySchema = z.object({
  customerId: z.uuid().nullable().default(null),
  invoiceId: z.uuid().nullable().default(null),
});

/** Keys of the conflicts payment.service throws, shown as `payments.errors.*`. */
export const PAYMENT_ERROR_KEYS = [
  "paymentAlreadyVoided",
  "invoiceNotOpen",
  "walkInPaymentInvalid",
  "nothingOnAccount",
  "refundFirst",
  "refundAlreadyVoided",
  "walkInRefundFinal",
] as const;
export type PaymentErrorKey = (typeof PAYMENT_ERROR_KEYS)[number];

export function isPaymentErrorKey(value: unknown): value is PaymentErrorKey {
  return (PAYMENT_ERROR_KEYS as readonly unknown[]).includes(value);
}

/**
 * A refund of money on account (ADR 0011, owner only). The amount is checked against what is on
 * account under the customer's row lock; the date like a payment's (`paymentDateProblem`).
 */
export const refundSchema = z.object({
  amount: amountSchema,
  refundDate: z.string().refine(isValidIsoDate, { error: "paymentDateInvalid" }),
  mode: z.enum(PAYMENT_MODES, { error: "paymentModeRequired" }),
  reference: optionalText(50),
  notes: optionalText(200),
});

export type RefundValues = z.input<typeof refundSchema>;

/** How a walk-in's money was given back at the counter when a credit note releases it. */
export const counterRefundSchema = z.object({
  mode: z.enum(PAYMENT_MODES, { error: "refundModeRequired" }),
  reference: optionalText(50),
});
