/**
 * One evaluation of an invoice draft, run by the server (the source of truth, CLAUDE.md rule 2)
 * and by the invoice builder for live totals (SPEC F4). It is pure: everything it needs is
 * passed in, so both sides compute the same numbers with the same domain code.
 */

import { type FieldIssue, ValidationError } from "@/lib/errors";
import { addDays } from "@/server/domain/fy";
import {
  computeInvoice,
  computeLine,
  type InvoiceTotals,
  type LineAmounts,
} from "@/server/domain/gst/calc";
import {
  determinePlaceOfSupply,
  type DocumentType,
  documentTypeFor,
  type GstScheme,
  type PlaceOfSupply,
  type TaxMode,
} from "@/server/domain/gst/place-of-supply";
import { isActiveStateCode } from "@/server/domain/states";

import {
  type DraftLine,
  type InvoiceDraft,
  type IssueLine,
  issueLineSchema,
  type LineOptions,
} from "./validation/invoices";

export interface EvaluationBusiness {
  stateCode: string;
  gstScheme: GstScheme;
  roundOffEnabled: boolean;
}

export interface EvaluationCustomer {
  billingStateCode: string | null;
  shippingStateCode: string | null;
  creditDays: number;
}

/** What a product line takes from its product, whatever the client sent. */
export interface LineProduct {
  hsnSac: string | null;
  unit: string;
  rateBp: number;
  priceIncludesTax: boolean;
}

export interface EvaluationInput {
  draft: InvoiceDraft;
  business: EvaluationBusiness;
  customer: EvaluationCustomer | null;
  /** The server passes the products of product lines; the builder already copied them in. */
  products?: ReadonlyMap<string, LineProduct>;
  options: LineOptions;
  /** Today in Asia/Kolkata: the invoice date if it is issued now. */
  invoiceDate: string;
}

export interface EvaluatedLine {
  /** Index in `draft.lines`. */
  index: number;
  line: IssueLine;
  amounts: LineAmounts;
}

export interface DraftEvaluation {
  /** `validation.*` keys with paths like `lines.2.qty`; a draft is saved anyway. */
  issues: FieldIssue[];
  /** The lines that passed, in order. Totals count only these. */
  lines: EvaluatedLine[];
  placeOfSupply: PlaceOfSupply | null;
  /** Stored even when the place of supply is invalid (then the business's own state). */
  placeOfSupplyStateCode: string;
  isInterState: boolean;
  taxMode: TaxMode;
  documentType: DocumentType;
  dueDate: string | null;
  totals: InvoiceTotals;
}

/**
 * A product line takes its HSN, unit, GST rate and "price includes tax" from the product, so
 * a client can't change the rate of a catalogue item. Without GST (`NONE`) the rate is 0.
 */
function resolveLine(line: DraftLine, input: EvaluationInput, taxMode: TaxMode) {
  const product = line.productId ? input.products?.get(line.productId) : undefined;
  const resolved = product
    ? {
        ...line,
        hsnSac: product.hsnSac ?? "",
        unit: product.unit,
        rateBp: product.rateBp,
        priceIncludesTax: product.priceIncludesTax,
      }
    : line;
  return taxMode === "NONE" ? { ...resolved, rateBp: 0, priceIncludesTax: false } : resolved;
}

function placeOfSupplyFor(input: EvaluationInput): {
  placeOfSupply: PlaceOfSupply | null;
  issues: FieldIssue[];
} {
  const override = input.draft.placeOfSupplyOverride;
  if (override !== null && !isActiveStateCode(override)) {
    return {
      placeOfSupply: null,
      issues: [{ path: "placeOfSupplyOverride", message: "placeOfSupplyInvalid" }],
    };
  }
  try {
    return {
      placeOfSupply: determinePlaceOfSupply({
        businessStateCode: input.business.stateCode,
        scheme: input.business.gstScheme,
        customerShippingStateCode: input.customer?.shippingStateCode,
        customerBillingStateCode: input.customer?.billingStateCode,
        overrideStateCode: override,
      }),
      issues: [],
    };
  } catch (error) {
    // A composition business billing another state (CGST Act s.10(2)(c)).
    if (error instanceof ValidationError) return { placeOfSupply: null, issues: [...error.issues] };
    throw error;
  }
}

function dueDateFor(input: EvaluationInput): { dueDate: string | null; issues: FieldIssue[] } {
  const chosen =
    input.draft.dueDate ??
    (input.customer ? addDays(input.invoiceDate, input.customer.creditDays) : null);
  if (chosen !== null && chosen < input.invoiceDate) {
    return { dueDate: null, issues: [{ path: "dueDate", message: "dueDateBeforeInvoiceDate" }] };
  }
  return { dueDate: chosen, issues: [] };
}

/** computeLine names fields as LineInput does; the builder's fields are named as typed. */
const DOMAIN_FIELDS: Record<string, string> = {
  qtyMilli: "qty",
  unitPricePaise: "unitPrice",
  discountPaise: "discount",
};

export function evaluateDraft(input: EvaluationInput): DraftEvaluation {
  const pos = placeOfSupplyFor(input);
  const due = dueDateFor(input);
  // Without a valid place of supply the lines are still checked; taxes wait for a valid one.
  const taxMode: TaxMode = pos.placeOfSupply?.taxMode ?? "NONE";
  const schema = issueLineSchema(input.options);

  const issues: FieldIssue[] = [...pos.issues, ...due.issues];
  const lines: EvaluatedLine[] = [];
  input.draft.lines.forEach((draftLine, index) => {
    const path = `lines.${String(index)}`;
    const parsed = schema.safeParse(resolveLine(draftLine, input, taxMode));
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map((issue) => ({
          path: [path, ...issue.path.map(String)].join("."),
          message: issue.message,
        })),
      );
      return;
    }
    try {
      lines.push({ index, line: parsed.data, amounts: computeLine(parsed.data, taxMode) });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(
        ...error.issues.map((issue) => ({
          path: `${path}.${DOMAIN_FIELDS[issue.path] ?? issue.path}`,
          message: issue.message,
        })),
      );
    }
  });

  const { totals } = computeInvoice({
    lines: lines.map(({ line }) => line),
    taxMode,
    roundOff: input.business.roundOffEnabled,
  });
  const placeOfSupplyStateCode = pos.placeOfSupply?.stateCode ?? input.business.stateCode;

  return {
    issues,
    lines,
    placeOfSupply: pos.placeOfSupply,
    placeOfSupplyStateCode,
    isInterState: placeOfSupplyStateCode !== input.business.stateCode,
    taxMode,
    documentType: documentTypeFor(input.business.gstScheme),
    dueDate: due.dueDate,
    totals,
  };
}

/** Issues for one draft line, keyed by field (`qty`, `discount`, …), for the builder. */
export function lineIssues(issues: readonly FieldIssue[], index: number): Record<string, string> {
  const prefix = `lines.${String(index)}.`;
  const byField: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue.path.startsWith(prefix)) continue;
    const field = issue.path.slice(prefix.length);
    byField[field] ??= issue.message;
  }
  return byField;
}
