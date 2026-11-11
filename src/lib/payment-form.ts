import { type FieldIssue, ValidationError } from "@/lib/errors";
import { type PaymentFormOptions } from "@/lib/payment-view";
import {
  OPENING_BALANCE,
  type PaymentMode,
  paymentDateProblem,
  type RecordPaymentValues,
  recordPaymentSchema,
} from "@/lib/validation/payments";
import { parseScaled } from "@/server/domain/decimal";
import {
  type Allocation,
  autoAllocate,
  checkManualAllocation,
  type OpenItem,
} from "@/server/domain/payment/allocation";

/*
 * The record-payment form's logic, kept pure so it is unit-tested and the form stays thin. The
 * live preview runs the same allocation functions as payment.service; the server still decides
 * under its row locks.
 */

/** "INVOICE": the invoice the form was opened from first, the rest on account (decision 4). */
export type AllocationChoice = "INVOICE" | "AUTO" | "MANUAL";

export interface PaymentFormValues {
  amount: string;
  paymentDate: string;
  mode: PaymentMode;
  reference: string;
  notes: string;
  allocationChoice: AllocationChoice;
  /** One amount per open item, in `options.openItems` order; empty = leave it out. */
  manual: { amount: string }[];
}

export function isWalkIn(options: PaymentFormOptions): boolean {
  return options.customer === null;
}

export function defaultPaymentValues(options: PaymentFormOptions): PaymentFormValues {
  const from = options.openItems.find((item) => item.key === options.invoiceId);
  return {
    // From an invoice: what is due on it. Otherwise the customer types it.
    amount: from ? rupees(BigInt(from.balancePaise)) : "",
    paymentDate: options.today,
    mode: "CASH",
    reference: "",
    notes: "",
    allocationChoice: from && !isWalkIn(options) ? "INVOICE" : "AUTO",
    manual: options.openItems.map(() => ({ amount: "" })),
  };
}

/** Paise as a plain rupee string for an input ("1234.5" → "1234.50"; whole rupees stay whole). */
export function rupees(paise: bigint): string {
  const whole = paise / 100n;
  const fraction = paise % 100n;
  return fraction === 0n
    ? whole.toString()
    : `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function paiseOf(text: string): bigint | null {
  return parseScaled(text.trim().replace(/^(₹|rs\.?)\s*/i, ""), 2);
}

function openItems(options: PaymentFormOptions): OpenItem[] {
  return options.openItems.map((item) => ({
    invoiceId: item.key === OPENING_BALANCE ? null : item.key,
    invoiceDate: item.invoiceDate,
    number: item.number,
    balancePaise: BigInt(item.balancePaise),
  }));
}

/** Which form row each MANUAL item came from, to put errors back on the right input. */
function manualItems(values: PaymentFormValues) {
  return values.manual
    .map((item, index) => ({ index, amount: item.amount.trim() }))
    .filter((item) => item.amount !== "");
}

/** The request the form sends: the shared `recordPaymentSchema` input, no totals. */
export function toPaymentInput(
  values: PaymentFormValues,
  options: PaymentFormOptions,
): RecordPaymentValues {
  const base = {
    customerId: options.customer?.id ?? null,
    amount: values.amount,
    paymentDate: values.paymentDate,
    mode: values.mode,
    reference: values.reference,
    notes: values.notes,
  };
  const from = options.openItems.find((item) => item.key === options.invoiceId);
  if (isWalkIn(options)) {
    return {
      ...base,
      allocation: {
        kind: "MANUAL",
        items: options.invoiceId ? [{ invoiceId: options.invoiceId, amount: values.amount }] : [],
      },
    };
  }
  if (values.allocationChoice === "INVOICE" && from) {
    const amount = paiseOf(values.amount);
    const share =
      amount === null
        ? null
        : amount < BigInt(from.balancePaise)
          ? amount
          : BigInt(from.balancePaise);
    return {
      ...base,
      allocation: {
        kind: "MANUAL",
        items: share !== null && share > 0n ? [{ invoiceId: from.key, amount: rupees(share) }] : [],
      },
    };
  }
  if (values.allocationChoice === "MANUAL") {
    return {
      ...base,
      allocation: {
        kind: "MANUAL",
        items: manualItems(values).map(({ index, amount }) => ({
          invoiceId: options.openItems[index]?.key ?? "",
          amount,
        })),
      },
    };
  }
  return { ...base, allocation: { kind: "AUTO" } };
}

/**
 * Field paths of the service and the shared schema (`allocation.items.0.amount`) as form paths
 * (`manual.3.amount`), so server errors land on the inputs that caused them.
 */
export function toFormPath(path: string, values: PaymentFormValues): string {
  const match = /^allocation\.items\.(\d+)\.(amount|invoiceId)$/.exec(path);
  if (match) {
    if (values.allocationChoice !== "MANUAL") return "amount";
    const row = manualItems(values)[Number(match[1])];
    return row ? `manual.${String(row.index)}.amount` : "root.allocation";
  }
  if (path.startsWith("allocation")) return "root.allocation";
  return path;
}

export interface PaymentPreview {
  allocations: Allocation[];
  onAccountPaise: bigint;
}

/** Everything wrong with the form, as form paths and `validation.*` keys. */
export function paymentFormIssues(
  values: PaymentFormValues,
  options: PaymentFormOptions,
): FieldIssue[] {
  const input = toPaymentInput(values, options);
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: toFormPath(issue.path.join("."), values),
      message: issue.message,
    }));
  }
  const dateProblem = paymentDateProblem(parsed.data.paymentDate, options.today);
  if (dateProblem) return [{ path: "paymentDate", message: dateProblem }];
  const preview = paymentPreview(values, options);
  if (preview instanceof ValidationError) {
    return preview.issues.map((issue) => ({
      path: toFormPath(`allocation.${issue.path}`, values),
      message: issue.message,
    }));
  }
  if (isWalkIn(options) && preview !== null && preview.onAccountPaise !== 0n) {
    return [{ path: "amount", message: "walkInPaymentInvalid" }];
  }
  return [];
}

/**
 * What saving would do, with the same functions the server runs: which items get how much, and
 * what stays on account. A ValidationError when the chosen amounts don't fit; null while the
 * amount isn't a valid number yet.
 */
export function paymentPreview(
  values: PaymentFormValues,
  options: PaymentFormOptions,
): PaymentPreview | ValidationError | null {
  const amount = paiseOf(values.amount);
  if (amount === null || amount <= 0n) return null;
  const items = openItems(options);
  const input = toPaymentInput(values, options);
  try {
    if (input.allocation.kind === "AUTO") return autoAllocate(amount, items);
    const requested: Allocation[] = [];
    for (const item of input.allocation.items) {
      const share = paiseOf(item.amount);
      if (share === null) return null;
      requested.push({
        invoiceId: item.invoiceId === OPENING_BALANCE ? null : item.invoiceId,
        amountPaise: share,
      });
    }
    return checkManualAllocation(amount, requested, items);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
}
