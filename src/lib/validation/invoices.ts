import { z } from "zod";

import { parseScaled } from "@/server/domain/decimal";
import { isValidIsoDate } from "@/server/domain/fy";
import { ISSUE_WARNINGS } from "@/server/domain/invoice/issue-rules";

import { requiredText } from "./fields";
import { hsnSac, price } from "./products";

/**
 * Invoices (SPEC F4), shared by the invoice builder and invoice.service.
 *
 * A draft is work in progress, so `draftSchema` only bounds sizes and shapes: half-typed lines
 * are kept. The strict rules run per line (`issueLineSchema`) when issuing, and in the builder
 * to mark lines live. **No schema here has a total field**: totals are always recomputed on
 * the server (CLAUDE.md rule 2), and unknown keys are stripped.
 */

export const MAX_INVOICE_LINES = 100;
/** 10 lakh units of anything on one line. */
export const MAX_QTY_MILLI = 1_000_000_000n;

const short = (max: number) => z.string().max(max, { error: "textTooLong" });

const isoDate = z.string().refine(isValidIsoDate, { error: "dueDateInvalid" });

export const draftLineSchema = z.object({
  /** The builder's own key for the line (React list key); not stored meaningfully. */
  key: short(40).default(""),
  productId: z.uuid().nullable().default(null),
  description: short(200).default(""),
  hsnSac: short(8).default(""),
  unit: short(3).default(""),
  qty: short(20).default(""),
  unitPrice: short(20).default(""),
  discount: short(20).default(""),
  rateBp: z.number().int().min(0).max(9_999).default(0),
  priceIncludesTax: z.boolean().default(false),
});

export const draftSchema = z.object({
  /** Null for a walk-in sale. */
  customerId: z.uuid().nullable().default(null),
  walkInName: short(120).default(""),
  /** A state code chosen on the invoice; wins over the customer's address. */
  placeOfSupplyOverride: z
    .string()
    .regex(/^[0-9]{2}$/, { error: "stateRequired" })
    .nullable()
    .default(null),
  dueDate: isoDate.nullable().default(null),
  notes: short(500).default(""),
  lines: z
    .array(draftLineSchema)
    .max(MAX_INVOICE_LINES, { error: "invoiceTooManyLines" })
    .default([]),
});

export type DraftLine = z.output<typeof draftLineSchema>;
/** What is stored in `invoices.draft` and given back to the builder. */
export type InvoiceDraft = z.output<typeof draftSchema>;
export type InvoiceDraftValues = z.input<typeof draftSchema>;

export const EMPTY_DRAFT: InvoiceDraft = draftSchema.parse({});

export const updateDraftSchema = z.object({
  version: z.number().int().min(1),
  draft: draftSchema,
});

export const issueSchema = z.object({
  version: z.number().int().min(1),
  acknowledgedWarnings: z.array(z.enum(ISSUE_WARNINGS)).default([]),
});

export interface LineOptions {
  /** UQC codes from `units`. */
  units: readonly string[];
  /** Active GST rates (basis points) from `tax_rates`. */
  rateBps: readonly number[];
}

function scaled(scale: number, invalid: string) {
  return (value: string, ctx: z.RefinementCtx): bigint => {
    const parsed = parseScaled(value, scale);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: invalid });
      return z.NEVER;
    }
    return parsed;
  };
}

/** The strict rules for one line, as issued. Amounts come out as bigint paise and milli-units. */
export function issueLineSchema({ units, rateBps }: LineOptions) {
  return z
    .object({
      productId: z.uuid().nullable(),
      description: requiredText(200, "lineDescriptionRequired"),
      hsnSac,
      unit: z
        .string()
        .trim()
        .toUpperCase()
        .refine((value) => units.includes(value), { error: "unitRequired" }),
      qty: z
        .string()
        .trim()
        .transform(scaled(3, "qtyInvalid"))
        .refine((milli) => milli > 0n, { error: "qtyPositive" })
        .refine((milli) => milli <= MAX_QTY_MILLI, { error: "qtyTooHigh" }),
      unitPrice: price,
      discount: z
        .string()
        .trim()
        .transform((value) => value || "0")
        .transform(scaled(2, "discountInvalid")),
      rateBp: z.number().refine((rate) => rateBps.includes(rate), { error: "rateRequired" }),
      priceIncludesTax: z.boolean(),
    })
    .transform(({ qty, unitPrice, discount, ...line }) => ({
      ...line,
      qtyMilli: qty,
      unitPricePaise: unitPrice,
      discountPaise: discount,
    }));
}

export type IssueLine = z.output<ReturnType<typeof issueLineSchema>>;

/** Which invoices a list shows. OVERDUE, UNPAID and PAID look at the balance (SPEC §4.8). */
export const INVOICE_LIST_STATUSES = ["DRAFT", "UNPAID", "OVERDUE", "PAID", "CANCELLED"] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];

const optionalIsoDate = z.iso.date().optional().catch(undefined);

/** List filters from the URL. Bad values fall back to "no filter", never an error. */
export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_LIST_STATUSES).optional().catch(undefined),
  from: optionalIsoDate,
  to: optionalIsoDate,
  customer: z.uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value === "" ? undefined : value)),
  cursor: z.string().max(500).optional().catch(undefined),
});

/** Keys of the conflicts invoice.service throws, shown as `invoices.errors.*`. */
export const INVOICE_ERROR_KEYS = [
  "invoiceAlreadyIssued",
  "draftEditedElsewhere",
  "customerArchived",
] as const;
export type InvoiceErrorKey = (typeof INVOICE_ERROR_KEYS)[number];

export function isInvoiceErrorKey(value: unknown): value is InvoiceErrorKey {
  return typeof value === "string" && (INVOICE_ERROR_KEYS as readonly string[]).includes(value);
}
